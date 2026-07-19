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

export async function GET() {
  try {
    const { token, spreadsheetId } = await requireCapability(CAPABILITY.ViewReceipts);
    const receipts = await getAllReceipts(token, spreadsheetId);
    return NextResponse.json({ spreadsheetId, receipts });
  } catch (err) {
    return NextResponse.json({ error: describe(err) }, { status: errorStatus(err) });
  }
}

export async function POST(req: Request) {
  try {
    const { token, spreadsheetId } = await requireCapability(CAPABILITY.AppendReceipts);
    const body = (await req.json()) as { receipts: Receipt[] };
    await appendReceipts(token, spreadsheetId, body.receipts || []);
    return NextResponse.json({ ok: true, spreadsheetId });
  } catch (err) {
    return NextResponse.json({ error: describe(err) }, { status: errorStatus(err) });
  }
}

export async function PATCH(req: Request) {
  try {
    const { token, spreadsheetId } = await requireCapability(CAPABILITY.EditReceipts);
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
