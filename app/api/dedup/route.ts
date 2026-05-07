import { NextResponse } from "next/server";
import {
  canonicalizeStoreNames,
  detectDuplicatesAndPairs,
} from "@/lib/ai";
import {
  bulkUpdateReceipts,
  ensureSpreadsheet,
  getAllReceipts,
  requireAccessToken,
  writeAllStores,
} from "@/lib/google";
import { looksUnresolved, resolveStoreName } from "@/lib/places";
import type { Receipt, Store } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function roundAmount(n: number | null): number | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round(Math.abs(n) * 100) / 100;
}

function isReceiptType(t: Receipt["documentType"]): boolean {
  return t === "קבלה" || t === "חשבונית מס" || t === "ספח אשראי" || t === "לא ידוע";
}

export async function POST() {
  try {
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    const receipts = await getAllReceipts(token, spreadsheetId);

    if (receipts.length === 0) {
      return NextResponse.json({ ok: true, message: "אין קבלות לעיבוד" });
    }

    // ---- Step 1: canonicalize store names across all receipts ----
    const namesInput = receipts
      .map((r) => r.storeName)
      .filter((n): n is string => Boolean(n) && n !== "לא ידוע");

    const canonicalGroups = await canonicalizeStoreNames(namesInput);

    // ---- Places API: verify suspicious canonical names against Google ----
    let placesResolutions = 0;
    for (const g of canonicalGroups) {
      if (!looksUnresolved(g.canonical)) continue;
      const resolved = await resolveStoreName(g.canonical);
      if (resolved && resolved !== g.canonical) {
        g.canonical = resolved;
        placesResolutions++;
      }
    }

    const variantToCanonical = new Map<string, string>();
    for (const g of canonicalGroups) {
      for (const v of g.variants) variantToCanonical.set(v, g.canonical);
    }

    const storePatches: Array<Partial<Receipt> & { id: string }> = [];
    for (const r of receipts) {
      if (!r.storeName) continue;
      const canonical = variantToCanonical.get(r.storeName);
      if (canonical && canonical !== r.storeName) {
        storePatches.push({ id: r.id, storeName: canonical });
        r.storeName = canonical; // mutate in-memory for subsequent steps
      }
    }
    if (storePatches.length > 0) {
      await bulkUpdateReceipts(token, spreadsheetId, storePatches);
    }

    // Rebuild stores tab from canonical groups
    const newStores: Store[] = canonicalGroups.map((g) => ({
      canonical: g.canonical,
      count: receipts.filter((r) => r.storeName === g.canonical).length,
      variants: g.variants.filter((v) => v !== g.canonical),
    }));
    await writeAllStores(token, spreadsheetId, newStores);

    // ---- Step 2: deterministic dedup by (amount, date) ----
    type Group = { key: string; rows: Receipt[] };
    const groups = new Map<string, Receipt[]>();
    for (const r of receipts) {
      if (!isReceiptType(r.documentType)) continue;
      const amt = roundAmount(r.amount);
      if (amt === null || !r.date) continue;
      const key = `${amt}|${r.date}`;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }

    const dedupPatches: Array<Partial<Receipt> & { id: string }> = [];
    let dupCount = 0;
    let slipCount = 0;

    for (const [_key, arr] of groups) {
      if (arr.length < 2) continue;

      // Sort: tax_invoice > receipt > credit_slip > unknown, then by id stable
      const priority: Record<string, number> = {
        "חשבונית מס": 4,
        "קבלה": 3,
        "לא ידוע": 2,
        "ספח אשראי": 1,
      };
      const sorted = [...arr].sort(
        (a, b) =>
          (priority[b.documentType] ?? 0) - (priority[a.documentType] ?? 0),
      );
      const primary = sorted[0];
      const rest = sorted.slice(1);

      for (const r of rest) {
        if (r.documentType === "ספח אשראי") {
          dedupPatches.push({
            id: r.id,
            documentType: "ספח אשראי",
            linkedTo: primary.id,
            notes: `ספח אשראי של ${primary.fileName}`,
          });
          slipCount++;
        } else {
          dedupPatches.push({
            id: r.id,
            documentType: "כפילות",
            linkedTo: primary.id,
            notes: `כפילות של ${primary.fileName}`,
          });
          dupCount++;
        }
      }

      // Promote primary if it was unknown
      if (primary.documentType === "לא ידוע") {
        dedupPatches.push({
          id: primary.id,
          documentType: "קבלה",
        });
      }
    }

    // ---- Step 3: fuzzy duplicate / receipt-slip pair detection via LLM ----
    const groups3 = await detectDuplicatesAndPairs(
      receipts.map((r) => ({
        id: r.id,
        storeName: r.storeName,
        amount: r.amount,
        date: r.date,
        documentType: r.documentType,
      })),
    );

    for (const g of groups3) {
      if (g.receipt_ids.length < 2) continue;
      const [primaryId, ...rest] = g.receipt_ids;
      if (g.kind === "duplicate") {
        for (const id of rest) {
          dedupPatches.push({
            id,
            documentType: "כפילות",
            linkedTo: primaryId,
            notes: g.reason,
          });
          dupCount++;
        }
      } else if (g.kind === "receipt_slip_pair") {
        for (const id of rest) {
          dedupPatches.push({
            id,
            linkedTo: primaryId,
            notes: g.reason,
          });
          slipCount++;
        }
      }
    }

    if (dedupPatches.length > 0) {
      // Merge patches by id (later wins)
      const byId = new Map<string, Partial<Receipt> & { id: string }>();
      for (const p of dedupPatches) {
        const existing = byId.get(p.id) ?? { id: p.id };
        byId.set(p.id, { ...existing, ...p });
      }
      await bulkUpdateReceipts(token, spreadsheetId, Array.from(byId.values()));
    }

    return NextResponse.json({
      ok: true,
      summary: {
        canonicalGroups: canonicalGroups.length,
        nameUpdates: storePatches.length,
        placesResolutions,
        duplicates: dupCount,
        creditSlips: slipCount,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
