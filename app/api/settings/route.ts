import { NextResponse } from "next/server";
import {
  ensureSpreadsheet,
  getUserSettings,
  requireAccessToken,
  writeUserSettings,
} from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    const settings = await getUserSettings(token, spreadsheetId);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { myCardsLast4?: unknown };
    const raw = Array.isArray(body.myCardsLast4) ? body.myCardsLast4 : [];
    const myCardsLast4 = (raw as unknown[])
      .filter((v): v is string => typeof v === "string" && /^\d{4}$/.test(v));

    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    await writeUserSettings(token, spreadsheetId, { myCardsLast4 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
