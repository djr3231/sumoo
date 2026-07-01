import { NextResponse } from "next/server";
import { ensureSpreadsheet, getAllReceipts, requireAccessToken } from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 60;

// Returns all OCR'd receipts from the "Receipts – sumoo" sheet, for matching
// against the period's expense lines. Body-less GET.
export async function GET() {
  try {
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    const receipts = await getAllReceipts(token, spreadsheetId);
    return NextResponse.json({ ok: true, receipts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
