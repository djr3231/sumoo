import { NextResponse } from "next/server";
import { ensureSpreadsheet, requireAccessToken } from "@/lib/google";
import { googleSheetProgressStore } from "@/lib/report/progress-store";
import type { ReportProgress } from "@/lib/report/progress";

export const runtime = "nodejs";
export const maxDuration = 60;

// Canonical period folderName format, e.g. "5-6_2026" (lib/report/period.ts).
const PERIOD_RE = /^\d{1,2}-\d{1,2}_\d{4}$/;

// Thin HTTP layer over the swappable ProgressStore (lib/report/progress-store.ts):
// GET reads a period's saved wizard progress, POST persists it. No wizard
// wiring here — that's Tasks 4-5.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period");
    if (!period || !PERIOD_RE.test(period)) {
      return NextResponse.json({ error: "Invalid or missing period" }, { status: 400 });
    }
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    const progress = await googleSheetProgressStore(token, spreadsheetId).load(period);
    return NextResponse.json({ ok: true, progress });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { period?: string; progress?: ReportProgress };
    const { period, progress } = body;
    if (!period || !PERIOD_RE.test(period)) {
      return NextResponse.json({ error: "Invalid or missing period" }, { status: 400 });
    }
    if (!progress || typeof progress !== "object" || progress.schemaVersion !== 1) {
      return NextResponse.json({ error: "Invalid or missing progress" }, { status: 400 });
    }
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    await googleSheetProgressStore(token, spreadsheetId).save(period, progress);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
