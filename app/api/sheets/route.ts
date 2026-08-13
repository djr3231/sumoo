import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import {
  appendReceipts,
  getAllReceipts,
  updateReceiptById,
} from "@/lib/google";
import { CAPABILITY, type Receipt } from "@/lib/types";

export const runtime = "nodejs";

function describe(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { data?: { error?: { message?: string; status?: string } } };
    errors?: Array<{ message?: string }>;
  };
  const apiMsg = e?.response?.data?.error?.message;
  const arrMsg = e?.errors?.[0]?.message;
  const msg = apiMsg || arrMsg || e?.message || "Unknown error";
  if (apiMsg) console.error("[sheets] Google API error:", e.response?.data);
  else console.error("[sheets] error:", err);
  return msg;
}

// GET /api/sheets
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  restrict to a reporting period
//   ?ids=1                          only the Drive file ids (import dedup)
//
// The date filter runs here, after the read: Sheets cannot filter by cell
// value on values.get, and rows are appended in scan order rather than by
// date, so the read itself is still O(all rows). What this saves is response
// payload, JSON parse, and every bit of client-side work over those rows —
// which is where the user-visible seconds actually are.
export async function GET(req: Request) {
  try {
    const { token, spreadsheetId } = await requireCapability(CAPABILITY.ViewReceipts, { ensure: false });
    const all = await getAllReceipts(token, spreadsheetId);

    const url = new URL(req.url);
    if (url.searchParams.get("ids") === "1") {
      const driveFileIds = all
        .map((r) => r.driveFileId)
        .filter((id): id is string => Boolean(id));
      return NextResponse.json({ spreadsheetId, driveFileIds });
    }

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const receipts =
      from && to
        ? all.filter(
            // A receipt whose date the OCR could not read must stay visible in
            // every period, or it becomes unreachable for correction.
            (r) => !r.date || (r.date >= from && r.date <= to),
          )
        : all;

    return NextResponse.json({ spreadsheetId, receipts, total: all.length });
  } catch (err) {
    return NextResponse.json({ error: describe(err) }, { status: errorStatus(err) });
  }
}

export async function POST(req: Request) {
  try {
    const { token, spreadsheetId } = await requireCapability(CAPABILITY.AppendReceipts, { ensure: false });
    const body = (await req.json()) as { receipts: Receipt[] };
    await appendReceipts(token, spreadsheetId, body.receipts || []);
    return NextResponse.json({ ok: true, spreadsheetId });
  } catch (err) {
    return NextResponse.json({ error: describe(err) }, { status: errorStatus(err) });
  }
}

export async function PATCH(req: Request) {
  try {
    const { token, spreadsheetId } = await requireCapability(CAPABILITY.EditReceipts, { ensure: false });
    const body = (await req.json()) as Partial<Receipt> & { id: string };
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await updateReceiptById(token, spreadsheetId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: describe(err) }, { status: errorStatus(err) });
  }
}
