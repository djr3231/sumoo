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
    const body = await req.json() as {
      myCardsLast4?: unknown; householdSize?: unknown; reportTemplate?: unknown;
    };
    const raw = Array.isArray(body.myCardsLast4) ? body.myCardsLast4 : [];
    const myCardsLast4 = (raw as unknown[])
      .filter((v): v is string => typeof v === "string" && /^\d{4}$/.test(v));
    const hs = Number(body.householdSize);
    const householdSize = Number.isInteger(hs) && hs >= 1 && hs <= 20 ? hs : null;
    const rt = body.reportTemplate as { id?: unknown; name?: unknown } | null | undefined;
    const reportTemplate =
      rt && typeof rt.id === "string" && rt.id && typeof rt.name === "string"
        ? { id: rt.id, name: rt.name }
        : null;

    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    // The settings form doesn't know about familyMembers — preserve the
    // stored registry across rewrites (writeUserSettings clears A2:B).
    const current = await getUserSettings(token, spreadsheetId);
    await writeUserSettings(token, spreadsheetId, {
      myCardsLast4,
      householdSize,
      reportTemplate,
      familyMembers: current.familyMembers,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
