import { NextResponse } from "next/server";
import { requireAccessToken, resolveSpreadsheetId } from "@/lib/google";
import { buildReportPdfBundle } from "@/lib/report/pdf";
import type { PersonalDetails, PdfExportArgs, PdfProgress } from "@/lib/report/pdf";
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
  previewOnly?: boolean;
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
  let body: Partial<PdfBody>;
  try {
    body = (await req.json()) as Partial<PdfBody>;
  } catch {
    return NextResponse.json({ error: "חסרים פרטים להנפקה" }, { status: 400 });
  }
  const { period, folders, reportId, personal, signaturePngBase64 } = body;
  if (
    !period?.year || !folders?.periodId || !reportId ||
    !personal?.name || !signaturePngBase64
  ) {
    return NextResponse.json({ error: "חסרים פרטים להנפקה" }, { status: 400 });
  }
  const attachedReceiptFileNames = body.attachedReceiptFileNames ?? [];
  const date = personal.date ? personal.date : todayDDMMYYYY();

  // NDJSON stream: {"progress":…} lines, then one final verdict line
  // ({"ok":…} or {"error":…}). HTTP status is committed at 200 once the
  // stream starts, so failures ride the final line, not the status.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true; // client went away — keep the bundle running silently
        }
      };
      try {
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
          previewOnly: body.previewOnly === true,
        };
        const result = await buildReportPdfBundle(token, args, (p: PdfProgress) =>
          send({ progress: p }),
        );
        send({ ok: true, ...result });
      } catch (err) {
        // Message only — no personal field ever serialized here.
        send({ error: (err as Error).message });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
