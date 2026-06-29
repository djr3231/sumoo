import { NextResponse } from "next/server";
import { requireAccessToken } from "@/lib/google";
import { processPeriodDocuments, type SourceFile } from "@/lib/report/process";
import type { ReportPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

async function toSourceFile(f: File): Promise<SourceFile> {
  return {
    name: f.name,
    buffer: Buffer.from(await f.arrayBuffer()),
    mimeType: f.type || "application/octet-stream",
  };
}

export async function POST(req: Request) {
  try {
    const token = await requireAccessToken();
    const form = await req.formData();

    const periodRaw = form.get("period");
    const sourceFolderId = form.get("sourceFolderId");
    if (typeof periodRaw !== "string" || typeof sourceFolderId !== "string") {
      return NextResponse.json(
        { error: "period and sourceFolderId are required" },
        { status: 400 },
      );
    }
    const period = JSON.parse(periodRaw) as ReportPeriod;

    const checking = form.getAll("checking").filter((x): x is File => x instanceof File);
    const direct = form.getAll("direct").filter((x): x is File => x instanceof File);
    const salaries = form.getAll("salary").filter((x): x is File => x instanceof File);

    const result = await processPeriodDocuments({
      accessToken: token,
      period,
      sourceFolderId,
      checking: await Promise.all(checking.map(toSourceFile)),
      direct: await Promise.all(direct.map(toSourceFile)),
      salaries: await Promise.all(salaries.map(toSourceFile)),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
