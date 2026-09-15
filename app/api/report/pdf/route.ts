import { NextResponse } from "next/server";
import {
  errorStatus,
  ForbiddenError,
  requireCapability,
  UnauthenticatedError,
} from "@/lib/accounts";
import { buildReportPdfBundle } from "@/lib/report/pdf";
import type {
  PdfExportArgs,
  PdfProgress,
  PdfTelemetry,
  PersonalDetails,
} from "@/lib/report/pdf";
import type { ReportFolders } from "@/lib/report/period";
import { CAPABILITY, type ReportPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const PDF_FAILURE_MESSAGE = "הנפקת ה-PDF נכשלה";
const SENSITIVE_PHASE_CAP_MS = 90_000;
const SENSITIVE_PHASE_HANDLER_CUTOFF_MS = 240_000;

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
  const handlerStartedAt = Date.now();
  const elapsedMs = () => Date.now() - handlerStartedAt;
  const logEvent = (event: {
    stage?: PdfProgress["stage"] | PdfTelemetry["stage"];
    done?: number;
    total?: number;
    elapsedMs: number;
    outcome?: "start" | "success" | "error" | "client_disconnect";
    category?: string;
    status?: number;
  }) => console.info("[report-pdf]", event);
  const safeErrorCategory = (err: unknown): string => {
    if (err instanceof UnauthenticatedError) return "unauthenticated";
    if (err instanceof ForbiddenError) return "forbidden";
    if (err instanceof Error && err.name === "AbortError") return "deadline";
    return "operation";
  };

  let body: Partial<PdfBody>;
  try {
    body = (await req.json()) as Partial<PdfBody>;
  } catch {
    logEvent({ elapsedMs: elapsedMs(), outcome: "error", category: "invalid_body", status: 400 });
    return NextResponse.json({ error: "חסרים פרטים להנפקה" }, { status: 400 });
  }
  const { period, folders, reportId, personal, signaturePngBase64 } = body;
  if (
    !period?.year || !folders?.periodId || !reportId ||
    !personal?.name || !signaturePngBase64
  ) {
    logEvent({ elapsedMs: elapsedMs(), outcome: "error", category: "invalid_body", status: 400 });
    return NextResponse.json({ error: "חסרים פרטים להנפקה" }, { status: 400 });
  }
  const attachedReceiptFileNames = body.attachedReceiptFileNames ?? [];
  const date = personal.date ? personal.date : todayDDMMYYYY();

  // Gate BEFORE the stream starts, so a 403 rides the HTTP status as plain
  // JSON instead of being buried in an NDJSON line after a 200 is committed.
  let token: string;
  let spreadsheetId: string;
  try {
    ({ token, spreadsheetId } = await requireCapability(CAPABILITY.ReportExport, {
      ensure: false,
    }));
  } catch (err) {
    const status = errorStatus(err);
    logEvent({
      elapsedMs: elapsedMs(),
      outcome: "error",
      category: safeErrorCategory(err),
      status,
    });
    return NextResponse.json(
      {
        error:
          err instanceof UnauthenticatedError || err instanceof ForbiddenError
            ? err.message
            : PDF_FAILURE_MESSAGE,
      },
      { status },
    );
  }

  const sensitiveDeadlineAt = Math.min(
    Date.now() + SENSITIVE_PHASE_CAP_MS,
    handlerStartedAt + SENSITIVE_PHASE_HANDLER_CUTOFF_MS,
  );

  // NDJSON stream: {"progress":…} lines, then one final verdict line
  // ({"ok":…} or {"error":…}). HTTP status is committed at 200 once the
  // stream starts, so failures ride the final line, not the status.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let disconnected = false;
      let latestStage: PdfProgress["stage"] | undefined;
      const recordDisconnect = () => {
        if (disconnected) return;
        disconnected = true;
        logEvent({
          stage: latestStage,
          elapsedMs: elapsedMs(),
          outcome: "client_disconnect",
        });
      };
      if (req.signal.aborted) recordDisconnect();
      else req.signal.addEventListener("abort", recordDisconnect, { once: true });
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
          recordDisconnect();
        }
      };
      try {
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
        const result = await buildReportPdfBundle(
          token,
          args,
          {
            sensitiveDeadlineAt,
            onTelemetry(event: PdfTelemetry) {
              logEvent({
                stage: event.stage,
                elapsedMs: elapsedMs(),
                outcome: event.outcome,
                category: event.category,
              });
            },
          },
          (progress: PdfProgress) => {
            latestStage = progress.stage;
            logEvent({
              stage: progress.stage,
              done: progress.done,
              total: progress.total,
              elapsedMs: elapsedMs(),
            });
            send({ progress });
          },
        );
        send({ ok: true, ...result });
        logEvent({
          stage: latestStage,
          elapsedMs: elapsedMs(),
          outcome: "success",
        });
      } catch (err) {
        send({ error: PDF_FAILURE_MESSAGE });
        logEvent({
          stage: latestStage,
          elapsedMs: elapsedMs(),
          outcome: "error",
          category: safeErrorCategory(err),
          status: errorStatus(err),
        });
      } finally {
        req.signal.removeEventListener("abort", recordDisconnect);
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
