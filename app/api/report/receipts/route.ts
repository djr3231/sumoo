import { NextResponse } from "next/server";
import { resolveActingContext } from "@/lib/accounts";
import { getAllReceipts } from "@/lib/google";
import { DOCUMENT_TYPE } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Returns the OCR'd receipts from the "Receipts – sumoo" sheet, for matching
// against the period's expense lines. Rows the dedup pipeline flagged as
// duplicates, and credit slips (whose parent receipt is the evidence), are
// not receipts-as-evidence — they must never compete for an expense line.
export async function GET() {
  try {
    const { token, spreadsheetId } = await resolveActingContext();
    const receipts = (await getAllReceipts(token, spreadsheetId)).filter(
      (r) =>
        r.documentType !== DOCUMENT_TYPE.Duplicate &&
        r.documentType !== DOCUMENT_TYPE.CreditSlip,
    );
    return NextResponse.json({ ok: true, receipts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
