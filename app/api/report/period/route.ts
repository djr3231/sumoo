import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import { buildReportPeriod, ensureReportFolder } from "@/lib/report/period";
import { CAPABILITY } from "@/lib/types";

export const runtime = "nodejs";

function isValidMonth(m: number): boolean {
  return Number.isInteger(m) && m >= 1 && m <= 12;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const year = Number(body?.year);
    const month1 = Number(body?.month1);
    const month2 = Number(body?.month2);
    if (!Number.isInteger(year) || !isValidMonth(month1) || !isValidMonth(month2)) {
      return NextResponse.json(
        { error: "year, month1, month2 are required (months 1-12)" },
        { status: 400 },
      );
    }
    const { token } = await requireCapability(CAPABILITY.ReportBuild, {
      spreadsheet: false,
    });
    const period = buildReportPeriod(year, month1, month2);
    const folders = await ensureReportFolder(token, period);
    return NextResponse.json({ ok: true, folderName: period.folderName, folders });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: errorStatus(e) });
  }
}
