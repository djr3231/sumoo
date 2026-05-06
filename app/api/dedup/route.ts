import { NextResponse } from "next/server";
import { detectDuplicatesAndCredits } from "@/lib/claude";
import {
  ensureSpreadsheet,
  getAllReceipts,
  requireAccessToken,
  updateReceiptById,
} from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    const receipts = await getAllReceipts(token, spreadsheetId);
    const groups = await detectDuplicatesAndCredits(
      receipts.map((r) => ({
        id: r.id,
        storeName: r.storeName,
        amount: r.amount,
        date: r.date,
        documentType: r.documentType,
      })),
    );

    let updates = 0;
    for (const g of groups) {
      if (g.kind === "duplicate" && g.receipt_ids.length > 1) {
        for (let i = 1; i < g.receipt_ids.length; i++) {
          await updateReceiptById(token, spreadsheetId, {
            id: g.receipt_ids[i],
            documentType: "כפילות",
            linkedTo: g.receipt_ids[0],
            notes: g.reason,
          });
          updates++;
        }
      } else if (g.kind === "credit_match" && g.receipt_ids.length >= 2) {
        const [primary, ...rest] = g.receipt_ids;
        for (const id of rest) {
          await updateReceiptById(token, spreadsheetId, {
            id,
            documentType: "זיכוי",
            linkedTo: primary,
            notes: g.reason,
          });
          updates++;
        }
      } else if (g.kind === "orphan_credit") {
        for (const id of g.receipt_ids) {
          await updateReceiptById(token, spreadsheetId, {
            id,
            documentType: "זיכוי-יתום",
            notes: g.reason,
          });
          updates++;
        }
      }
    }

    return NextResponse.json({ ok: true, groups, updates });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
