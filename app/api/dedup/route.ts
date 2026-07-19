import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import {
  canonicalizeStoreNames,
  detectDuplicatesAndPairs,
} from "@/lib/ai";
import {
  bulkUpdateReceipts,
  getAllReceipts,
  getAllStores,
  writeAllStores,
} from "@/lib/google";
import { looksUnresolved, resolveStoreName } from "@/lib/places";
import { CAPABILITY, DEFAULT_STORE_NAME, DOCUMENT_TYPE } from "@/lib/types";
import type { Receipt, Store } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// Per-LLM-step budget. A slow/hung Gemini call must not eat the whole
// function budget and end as an opaque 504 — race it and degrade to a
// partial (but successful) run instead.
const CANON_TIMEOUT_MS = 75_000;
const FUZZY_TIMEOUT_MS = 90_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function roundAmount(n: number | null): number | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round(Math.abs(n) * 100) / 100;
}

function isReceiptType(t: Receipt["documentType"]): boolean {
  return (
    t === DOCUMENT_TYPE.Receipt ||
    t === DOCUMENT_TYPE.TaxInvoice ||
    t === DOCUMENT_TYPE.CreditSlip ||
    t === DOCUMENT_TYPE.Unknown
  );
}

export async function POST() {
  try {
    const { token, spreadsheetId } = await requireCapability(CAPABILITY.Maintain);
    const receipts = await getAllReceipts(token, spreadsheetId);

    if (receipts.length === 0) {
      return NextResponse.json({ ok: true, message: "אין קבלות לעיבוד" });
    }

    // Rows already resolved by a previous run don't need re-processing.
    const activeReceipts = receipts.filter(
      (r) => r.documentType !== DOCUMENT_TYPE.Duplicate && !r.linkedTo,
    );

    // ---- Step 1: canonicalize store names across all receipts ----
    // Names that are already a canonical in the stores tab were settled by
    // a previous run — sending them to the LLM again made every re-run as
    // slow as the first (part of the 504s). Only new/unknown names go out.
    const knownStores = await getAllStores(token, spreadsheetId).catch(
      () => [] as Store[],
    );
    const knownCanonicals = new Set(knownStores.map((s) => s.canonical));

    const namesInput = Array.from(
      new Set(
        activeReceipts
          .map((r) => r.storeName)
          .filter((n): n is string => Boolean(n) && n !== DEFAULT_STORE_NAME),
      ),
    ).filter((n) => !knownCanonicals.has(n));

    // On timeout: skip grouping this run (names stay unknown and are
    // retried next run). Identity-fallback would be wrong here — it would
    // enshrine every raw name as canonical and block future grouping.
    const canonResult =
      namesInput.length > 0
        ? await withTimeout(canonicalizeStoreNames(namesInput), CANON_TIMEOUT_MS)
        : [];
    const canonSkipped = canonResult === null;
    const canonicalGroups = canonResult ?? [];

    // ---- Places API: verify suspicious canonical names against Google ----
    // Independent lookups — run them concurrently (they were sequential).
    let placesResolutions = 0;
    const placesChanges: Array<{ from: string; to: string }> = [];
    const unresolvedGroups = canonicalGroups.filter((g) =>
      looksUnresolved(g.canonical),
    );
    const placesResults = await Promise.all(
      unresolvedGroups.map(async (g) => ({
        g,
        resolved: await resolveStoreName(g.canonical),
      })),
    );
    for (const { g, resolved } of placesResults) {
      if (resolved && resolved !== g.canonical) {
        placesChanges.push({ from: g.canonical, to: resolved });
        g.canonical = resolved;
        placesResolutions++;
      }
    }

    const variantToCanonical = new Map<string, string>();
    // Known stores' variant mappings stay in force across runs.
    for (const s of knownStores) {
      for (const v of s.variants) variantToCanonical.set(v, s.canonical);
    }
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

    // Rebuild stores tab: known stores merged with this run's new groups.
    // (Rebuilding from canonicalGroups alone would clobber the tab now that
    // already-known names are excluded from the LLM input.)
    const mergedStores = new Map<string, Set<string>>();
    for (const s of knownStores) {
      mergedStores.set(s.canonical, new Set(s.variants));
    }
    for (const g of canonicalGroups) {
      const variants = mergedStores.get(g.canonical) ?? new Set<string>();
      for (const v of g.variants) if (v !== g.canonical) variants.add(v);
      mergedStores.set(g.canonical, variants);
    }
    const newStores: Store[] = Array.from(mergedStores, ([canonical, variants]) => ({
      canonical,
      count: receipts.filter((r) => r.storeName === canonical).length,
      variants: Array.from(variants),
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
        [DOCUMENT_TYPE.TaxInvoice]: 4,
        [DOCUMENT_TYPE.Receipt]:    3,
        [DOCUMENT_TYPE.Unknown]:    2,
        [DOCUMENT_TYPE.CreditSlip]: 1,
      };
      const sorted = [...arr].sort(
        (a, b) =>
          (priority[b.documentType] ?? 0) - (priority[a.documentType] ?? 0),
      );
      const primary = sorted[0];
      const rest = sorted.slice(1);

      for (const r of rest) {
        if (r.documentType === DOCUMENT_TYPE.CreditSlip) {
          dedupPatches.push({
            id: r.id,
            documentType: DOCUMENT_TYPE.CreditSlip,
            linkedTo: primary.id,
            notes: `ספח אשראי של ${primary.fileName}`,
          });
          slipCount++;
        } else {
          dedupPatches.push({
            id: r.id,
            documentType: DOCUMENT_TYPE.Duplicate,
            linkedTo: primary.id,
            notes: `כפילות של ${primary.fileName}`,
          });
          dupCount++;
        }
      }

      // Promote primary if it was unknown
      if (primary.documentType === DOCUMENT_TYPE.Unknown) {
        dedupPatches.push({
          id: primary.id,
          documentType: DOCUMENT_TYPE.Receipt,
        });
      }
    }

    // ---- Step 3: fuzzy duplicate / receipt-slip pair detection via LLM ----
    // Sending every receipt made this call grow with the dataset until it
    // blew the function budget. A duplicate/slip pair must have nearly the
    // same amount (±0.5% per the prompt), so only rows with an amount
    // neighbor within 1% are plausible candidates — typically a small
    // fraction of the sheet.
    const withAmount = activeReceipts
      .filter((r) => isReceiptType(r.documentType))
      .map((r) => ({ r, a: roundAmount(r.amount) }))
      .filter((x): x is { r: Receipt; a: number } => x.a !== null)
      .sort((x, y) => x.a - y.a);
    const candidateIds = new Set<string>();
    for (let i = 1; i < withAmount.length; i++) {
      const prev = withAmount[i - 1];
      const cur = withAmount[i];
      if (cur.a - prev.a <= Math.max(0.01, cur.a * 0.01)) {
        candidateIds.add(prev.r.id);
        candidateIds.add(cur.r.id);
      }
    }
    const fuzzyCandidates = activeReceipts.filter((r) => candidateIds.has(r.id));

    const fuzzyResult =
      fuzzyCandidates.length >= 2
        ? await withTimeout(
            detectDuplicatesAndPairs(
              fuzzyCandidates.map((r) => ({
                id: r.id,
                storeName: r.storeName,
                amount: r.amount,
                date: r.date,
                documentType: r.documentType,
              })),
            ),
            FUZZY_TIMEOUT_MS,
          )
        : [];
    const fuzzySkipped = fuzzyResult === null;
    const groups3 = fuzzyResult ?? [];

    for (const g of groups3) {
      if (g.receipt_ids.length < 2) continue;
      const [primaryId, ...rest] = g.receipt_ids;
      if (g.kind === "duplicate") {
        for (const id of rest) {
          dedupPatches.push({
            id,
            documentType: DOCUMENT_TYPE.Duplicate,
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
        placesChanges,
        duplicates: dupCount,
        creditSlips: slipCount,
        fuzzyCandidates: fuzzyCandidates.length,
        // Partial-run flags: an LLM step that exceeded its time budget was
        // skipped; everything else still ran and was written. Re-running
        // picks up where this run left off.
        canonSkipped,
        fuzzySkipped,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
}
