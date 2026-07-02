import { NextResponse } from "next/server";
import {
  ensureSpreadsheet,
  getAllStores,
  getUserSettings,
  requireAccessToken,
} from "@/lib/google";

export const runtime = "nodejs";

// Batch-invariant context for a scan run: the known store names (to help
// Gemini canonicalize) and the user's own card last-4s (to classify card
// ownership). Fetched ONCE per batch by the client and passed into each
// /api/ocr call, so a 49-file batch does these Sheets reads once instead
// of 49 times — which is what was blowing the 60-reads/min/user quota.
export async function GET() {
  try {
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    const [stores, settings] = await Promise.all([
      getAllStores(token, spreadsheetId).catch(() => []),
      getUserSettings(token, spreadsheetId).catch(
        () => ({ myCardsLast4: [] as string[] }),
      ),
    ]);
    return NextResponse.json({
      knownStores: stores.map((s) => s.canonical),
      userCards: settings.myCardsLast4,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
