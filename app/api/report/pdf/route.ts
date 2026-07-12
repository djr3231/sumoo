import { NextResponse } from "next/server";
import { requireAccessToken, resolveSpreadsheetId } from "@/lib/google";
import { buildReportPdfBundle } from "@/lib/report/pdf";
import type { PersonalDetails, PdfExportArgs } from "@/lib/report/pdf";
import type { ReportFolders } from "@/lib/report/period";
import type { ReportPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface PdfBody {
  period: ReportPeriod;
  folders: ReportFolders;
  reportId: string;
  personal: PersonalDetails;
  signaturePngBase64: string;
  attachedReceiptFileNames: string[];
}

// Today formatted DD/MM/YYYY (zero-padded), used only when the client sends
// an empty `personal.date` — matches the dialog's own default convention.
function todayDDMMYYYY(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<PdfBody>;
    const { period, folders, reportId, personal, signaturePngBase64 } = body;
    if (
      !period?.year || !folders?.periodId || !reportId ||
      !personal?.name || !signaturePngBase64
    ) {
      return NextResponse.json(
        { error: "חסרים פרטים להנפקה" },
        { status: 400 },
      );
    }
    const attachedReceiptFileNames = body.attachedReceiptFileNames ?? [];
    const date = personal.date ? personal.date : todayDDMMYYYY();

    const token = await requireAccessToken();
    const spreadsheetId = await resolveSpreadsheetId(token);

    const args: PdfExportArgs = {
      period,
      folders,
      reportId,
      spreadsheetId,
      personal: { ...personal, date },
      signaturePngBase64,
      attachedReceiptFileNames,
    };
    const result = await buildReportPdfBundle(token, args);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
