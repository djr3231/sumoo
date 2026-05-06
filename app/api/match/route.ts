import { NextResponse } from "next/server";
import {
  appendTxns,
  ensureSpreadsheet,
  getAllReceipts,
  requireAccessToken,
} from "@/lib/google";
import { matchTxnsToReceipts } from "@/lib/match";
import type { BankTxn } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { txns: BankTxn[]; saveToSheet?: boolean };
    if (!Array.isArray(body.txns)) {
      return NextResponse.json({ error: "txns required" }, { status: 400 });
    }

    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    const receipts = await getAllReceipts(token, spreadsheetId);

    const result = matchTxnsToReceipts(body.txns, receipts);

    if (body.saveToSheet) {
      const all: BankTxn[] = [
        ...result.matched.map((m) => m.txn),
        ...result.missingReceipts,
      ];
      await appendTxns(token, spreadsheetId, all);
    }

    return NextResponse.json({
      ok: true,
      matched: result.matched.map((m) => ({ receiptId: m.receipt.id, txn: m.txn })),
      missingReceipts: result.missingReceipts,
      unmatchedReceipts: result.unmatchedReceipts.map((r) => r.id),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
