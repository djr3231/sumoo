import { NextResponse } from "next/server";
import {
  getUserSettings,
  requireAccessToken,
  resolveSpreadsheetId,
} from "@/lib/google";
import { buildReportRollup } from "@/lib/report/rollup";
import {
  generateReportArtifacts,
  resolveTemplateId,
} from "@/lib/report/generate";
import { DEFAULT_HOUSEHOLD_SIZE } from "@/lib/types";
import type { ReportFolders } from "@/lib/report/period";
import type { RollupInput } from "@/lib/report/rollup";
import type { ReportPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface GenerateBody {
  period: ReportPeriod;
  folders: ReportFolders;
  rollupInput: Omit<RollupInput, "months" | "householdSize">;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<GenerateBody>;
    const { period, folders, rollupInput } = body;
    if (
      !period?.year || !period.month1 || !period.month2 ||
      !folders?.periodId || !rollupInput
    ) {
      return NextResponse.json({ error: "חסרים נתוני תקופה" }, { status: 400 });
    }
    const token = await requireAccessToken();
    const spreadsheetId = await resolveSpreadsheetId(token);
    const settings = await getUserSettings(token, spreadsheetId);
    const householdSize = settings.householdSize ?? DEFAULT_HOUSEHOLD_SIZE;
    const rollup = buildReportRollup({
      ...rollupInput,
      months: [period.month1, period.month2],
      householdSize,
    });
    const result = await generateReportArtifacts(token, {
      period,
      folders,
      rollup,
      templateId: resolveTemplateId(settings),
    });
    return NextResponse.json({ ok: true, ...result, householdSize });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
