import { NextResponse } from "next/server";
import { resolveActingContext } from "@/lib/accounts";
import { appendTxns, getAllReceipts } from "@/lib/google";
import { matchTxnsToReceipts } from "@/lib/match";
import { PAYMENT_METHOD, type BankTxn } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { txns: BankTxn[]; saveToSheet?: boolean };
    if (!Array.isArray(body.txns)) {
      return NextResponse.json({ error: "txns required" }, { status: 400 });
    }

    const { token, spreadsheetId } = await resolveActingContext();
    const receipts = await getAllReceipts(token, spreadsheetId);

    // Foreign-card receipts can't correspond to the user's own bank/card
    // charges; with the greedy ±0.5% matcher they could steal a match from
    // a real receipt, so they are excluded from matching entirely.
    const candidates = receipts.filter(
      (r) => r.paymentMethod !== PAYMENT_METHOD.ForeignCard,
    );

    const result = matchTxnsToReceipts(body.txns, candidates);

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
