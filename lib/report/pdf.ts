// Server module for wizard step 6's "נפק PDF" (issue PDF) action: builds the
// single signed PDF bundle that gets submitted to the trustee — a filled
// government-report page (from a throwaway Sheets copy, stamped with the
// hand-drawn signature image) followed by every source document (bank
// statements / salary slips) and every attached receipt.
//
// PRIVACY (hard rule — see task brief): `args.personal` and the decoded
// signature image exist ONLY as: function args → local variables → cells on
// the TEMP Sheet copy (always deleted in `finally`) → bytes embedded in the
// final PDF. They are never logged (console.*), never included in a thrown
// error message, and the signature bytes are never uploaded to Drive as a
// standalone file — only merged into the PDF via pdf-lib.
import { PDFDocument, type PDFImage } from "pdf-lib";
import { Jimp, JimpMime } from "jimp";
import {
  batchWriteCells,
  copyDriveFileAsSheet,
  deleteDriveFile,
  downloadDriveFile,
  ensureDriveFolder,
  exportSheetTabPdf,
  getAllReceipts,
  getSheetGrid,
  getSheetTabMetrics,
  listDriveFolderImages,
  listSheetTabs,
  moveDriveFile,
  uploadFileToDrive,
  type GoogleRequestOptions,
} from "@/lib/google";
import { pickReportTab } from "@/lib/report/generate";
import type { ReportPeriod } from "@/lib/types";
import type { ReportFolders } from "@/lib/report/period";

export interface PersonalDetails {
  name: string;
  caseNumber: string;
  address: string;
  phone: string;
  date: string; // DD/MM/YYYY (dialog default = today)
}
export interface PdfExportArgs {
  period: ReportPeriod;
  folders: ReportFolders;
  reportId: string; // the generated report Sheet id
  spreadsheetId: string; // main app spreadsheet (for getAllReceipts) — ambiguity resolution #1
  personal: PersonalDetails;
  signaturePngBase64: string; // data-URL or bare base64 (PNG or JPEG)
  attachedReceiptFileNames: string[]; // ordered; server resolves driveFileIds
  // Calibration aid: stop after the signature stamp (stages 2-5), skip all
  // attachments/moves/upload, and return the one-page PDF inline instead.
  previewOnly?: boolean;
}
export interface PdfExportResult {
  pdf: { id: string; url: string } | null; // null on previewOnly runs
  skippedFiles: string[]; // names that failed to append (e.g. encrypted PDFs)
  previewPdfBase64?: string; // previewOnly: the stamped report page, base64
}

// Progress event for the streaming route: stage + loop counters ONLY —
// never file names, never personal values (privacy hard rule).
export interface PdfProgress {
  stage: "prepare" | "export" | "sources" | "receipts" | "move" | "upload";
  done?: number; // 1-based, present inside the three file loops
  total?: number;
}

export interface PdfTelemetry {
  stage: "cleanup";
  outcome: "start" | "success" | "error";
  category?: "deadline" | "delete";
}

export interface PdfBuildOptions {
  sensitiveDeadlineAt: number;
  onTelemetry?: (event: PdfTelemetry) => void;
}

// Approved Hebrew strings (reconstructed locally — see task brief "Names").
const REPORT_FILE_PREFIX = "דוח דו-חודשי";
const DOCS_SUBFOLDER = "מסמכים";

// Ground-truth anchor labels (write targets on the TEMP copy only — NOT the
// generate.ts block-list). Write columns are fixed constants per the task's
// anchor table; rows are scanned per-report since layout may shift.
const ANCHOR = {
  name: "בעניין: היחיד/ה",
  caseNumber: "מס' תיק ממונה",
  address: "כתובת עדכנית",
  // Exact label (matches PERSONAL_DETAIL_LABELS): bare "טלפון" also matches an
  // earlier cell higher in the form, so anchor on the specific phone label.
  phone: "טלפון היחיד/ה",
  signature: "חתימת היחיד/ה",
} as const;
const COL = {
  name: 2,
  caseNumber: 6,
  address: 2,
  phone: 6,
  date: 2,
  signatureLeft: 6,
  signatureRight: 7,
} as const; // C/G/C/G/C, G:H

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const PAGE_MARGIN_PT = 18; // 0.25in, matching exportSheetTabPdf's margins

// Bundle-size fix: receipt/statement images are downscaled + re-encoded
// before embedding (full-resolution photos were bloating the PDF to ~105MB).
const IMAGE_MAX_DIMENSION_PX = 1500;
const IMAGE_JPEG_QUALITY = 70;
const SENSITIVE_REQUEST_TIMEOUT_MS = 30_000;
const CLEANUP_TIMEOUT_MS = 15_000;
const ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;
const RECEIPT_MOVE_CONCURRENCY = 4;

// Same 0-based A1-range helpers as generate.ts (that file exports only
// `pickReportTab`, so this is intentionally duplicated per the task brief).
function colA1(col: number): string {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const rangeFor = (tab: string, row0: number, col0: number) =>
  `'${tab}'!${colA1(col0)}${row0 + 1}`;

// Find the row of the first cell (top-down) whose trimmed text includes
// `needle`, optionally starting the scan at `from`. Returns -1 if not found.
function findAnchorRow(grid: string[][], needle: string, from = 0): number {
  for (let r = from; r < grid.length; r++) {
    if (grid[r].some((c) => c.trim().includes(needle))) return r;
  }
  return -1;
}

// Fit `srcW`x`srcH` into `boxW`x`boxH` preserving aspect ratio; returns the
// drawn size plus the (x,y) offset (within the box) that centers it.
function fitCentered(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { w: number; h: number; dx: number; dy: number } {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { w, h, dx: (boxW - w) / 2, dy: (boxH - h) / 2 };
}

// PNG sniff: 8-byte magic number. Anything else is treated as JPEG (matches
// the two formats the signature pad can produce, per the brief).
function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function decodeSignature(base64OrDataUrl: string): Buffer {
  const stripped = base64OrDataUrl.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(stripped, "base64");
}

// Append one source/receipt file (image or PDF) to `doc` as new page(s).
// Per the brief, callers wrap this in a try/catch so one bad file (e.g. an
// encrypted PDF) never fails the whole bundle.
async function appendFileAsPages(
  doc: PDFDocument,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  if (mimeType === "application/pdf") {
    const src = await PDFDocument.load(buffer);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => doc.addPage(p));
    return;
  }
  let image: PDFImage;
  try {
    // Downscale + re-encode as JPEG before embedding — compression always
    // wins here (a smaller bundle) even for already-small images, so no
    // "skip if small enough" branch; only the resize step is conditional.
    const jimpImage = await Jimp.fromBuffer(buffer);
    const maxSide = Math.max(jimpImage.width, jimpImage.height);
    if (maxSide > IMAGE_MAX_DIMENSION_PX) {
      // Resize with a single dimension auto-preserves aspect ratio (jimp v1).
      if (jimpImage.width >= jimpImage.height) {
        jimpImage.resize({ w: IMAGE_MAX_DIMENSION_PX });
      } else {
        jimpImage.resize({ h: IMAGE_MAX_DIMENSION_PX });
      }
    }
    const compressed = await jimpImage.getBuffer(JimpMime.jpeg, {
      quality: IMAGE_JPEG_QUALITY,
    });
    image = await doc.embedJpg(compressed);
  } catch {
    // A bad/unsupported image must never lose the receipt — fall back to
    // embedding the original bytes as-is.
    image = isPng(buffer)
      ? await doc.embedPng(buffer)
      : await doc.embedJpg(buffer);
  }
  const page = doc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
  const boxW = A4_WIDTH_PT - 2 * PAGE_MARGIN_PT;
  const boxH = A4_HEIGHT_PT - 2 * PAGE_MARGIN_PT;
  const fit = fitCentered(image.width, image.height, boxW, boxH);
  page.drawImage(image, {
    x: PAGE_MARGIN_PT + fit.dx,
    y: PAGE_MARGIN_PT + fit.dy,
    width: fit.w,
    height: fit.h,
  });
}

interface PersonalizedReportPage {
  reportPdfBuffer: Buffer;
  boxXPt: number;
  boxYTopPt: number;
  boxWPt: number;
  boxHPt: number;
}

interface AttachmentInput {
  name: string;
  driveFileId: string;
  mimeType?: string;
}

type AttachmentDownload =
  | { ok: true; input: AttachmentInput; buffer: Buffer; mimeType: string }
  | { ok: false; input: AttachmentInput };

function abortForDeadline(controller: AbortController): void {
  controller.abort(new DOMException("Operation deadline exceeded", "AbortError"));
}

async function runSensitiveRequest<T>(
  phaseSignal: AbortSignal,
  operation: (requestOptions: GoogleRequestOptions) => Promise<T>,
): Promise<T> {
  const requestController = new AbortController();
  const requestTimer = setTimeout(
    () => abortForDeadline(requestController),
    SENSITIVE_REQUEST_TIMEOUT_MS,
  );
  try {
    return await operation({
      signal: AbortSignal.any([phaseSignal, requestController.signal]),
      retry: false,
    });
  } finally {
    clearTimeout(requestTimer);
  }
}

async function deleteTemporaryReportCopy(
  accessToken: string,
  tempId: string,
  emitTelemetry: (event: PdfTelemetry) => void,
): Promise<void> {
  const cleanupController = new AbortController();
  const cleanupTimer = setTimeout(
    () => abortForDeadline(cleanupController),
    CLEANUP_TIMEOUT_MS,
  );
  emitTelemetry({ stage: "cleanup", outcome: "start" });
  try {
    await deleteDriveFile(accessToken, tempId, {
      signal: cleanupController.signal,
      retry: true,
      retryConfig: { retry: 1 },
    });
    emitTelemetry({ stage: "cleanup", outcome: "success" });
  } catch {
    emitTelemetry({
      stage: "cleanup",
      outcome: "error",
      category: cleanupController.signal.aborted ? "deadline" : "delete",
    });
    throw new Error("Temporary report cleanup failed");
  } finally {
    clearTimeout(cleanupTimer);
  }
}

async function exportPersonalizedReportPage(
  accessToken: string,
  args: PdfExportArgs,
  tempName: string,
  sensitiveDeadlineAt: number,
  emitProgress: (progress: PdfProgress) => void,
  emitTelemetry: (event: PdfTelemetry) => void,
): Promise<PersonalizedReportPage> {
  const phaseRemainingMs = sensitiveDeadlineAt - Date.now();
  if (phaseRemainingMs <= 0) {
    throw new Error("Sensitive report phase deadline exceeded");
  }

  const phaseController = new AbortController();
  const phaseTimer = setTimeout(
    () => abortForDeadline(phaseController),
    phaseRemainingMs,
  );
  let tempId: string | null = null;
  try {
    tempId = await runSensitiveRequest(phaseController.signal, (requestOptions) =>
      copyDriveFileAsSheet(
        accessToken,
        args.reportId,
        tempName,
        args.folders.periodId,
        requestOptions,
      ),
    );

    const tabs = await runSensitiveRequest(phaseController.signal, (requestOptions) =>
      listSheetTabs(accessToken, tempId as string, requestOptions),
    );
    const reportTab = pickReportTab(tabs);
    const grid = await runSensitiveRequest(phaseController.signal, (requestOptions) =>
      getSheetGrid(accessToken, tempId as string, reportTab, false, requestOptions),
    );

    const nameRow = findAnchorRow(grid, ANCHOR.name);
    if (nameRow === -1) throw new Error(`Missing anchor: "${ANCHOR.name}"`);
    const caseNumberRow = findAnchorRow(grid, ANCHOR.caseNumber);
    if (caseNumberRow === -1)
      throw new Error(`Missing anchor: "${ANCHOR.caseNumber}"`);
    const addressRow = findAnchorRow(grid, ANCHOR.address);
    if (addressRow === -1)
      throw new Error(`Missing anchor: "${ANCHOR.address}"`);
    const phoneRow = findAnchorRow(grid, ANCHOR.phone);
    if (phoneRow === -1) throw new Error(`Missing anchor: "${ANCHOR.phone}"`);
    const signatureRow = findAnchorRow(grid, ANCHOR.signature);
    if (signatureRow === -1)
      throw new Error(`Missing anchor: "${ANCHOR.signature}"`);
    const dateRow = findAnchorRow(grid, "תאריך:", signatureRow);
    if (dateRow === -1) throw new Error('Missing anchor: "תאריך:"');

    // Resolve geometry before writing personal fields to minimize the time
    // that the temporary Sheet contains them.
    const metrics = await runSensitiveRequest(phaseController.signal, (requestOptions) =>
      getSheetTabMetrics(accessToken, tempId as string, reportTab, requestOptions),
    );
    const gid = metrics.sheetId;
    const sumPx = (arr: number[], count: number) =>
      arr.slice(0, count).reduce((sum, value) => sum + value, 0);

    // Content extent follows the fetched value grid but must include the
    // signature row and both columns of its merged G:H cell. The right half of
    // a merged cell has no value and would otherwise be omitted, which once
    // pushed the mirrored RTL coordinate off-page.
    const usedRows = Math.max(grid.length, signatureRow + 1);
    const usedCols = Math.max(
      grid.reduce((max, row) => Math.max(max, row.length), 0),
      COL.signatureRight + 1,
    );
    const contentWpx = sumPx(metrics.colPx, usedCols);
    const contentHpx = sumPx(metrics.rowPx, usedRows);
    let xPx = sumPx(metrics.colPx, COL.signatureLeft);
    const wPx =
      (metrics.colPx[COL.signatureLeft] ?? 0) +
      (metrics.colPx[COL.signatureRight] ?? 0);
    const yPx = sumPx(metrics.rowPx, signatureRow);
    const hPx = metrics.rowPx[signatureRow] ?? 0;

    // Sheets exports RTL tabs mirrored, with column A at the right edge. The
    // signature target therefore needs a mirrored from-left coordinate.
    if (metrics.rightToLeft) xPx = contentWpx - (xPx + wPx);

    const PX_TO_PT = 0.75;
    const printableW = A4_WIDTH_PT - 2 * PAGE_MARGIN_PT;
    const printableH = A4_HEIGHT_PT - 2 * PAGE_MARGIN_PT;
    const scale = Math.min(
      printableW / (contentWpx * PX_TO_PT),
      printableH / (contentHpx * PX_TO_PT),
    );

    // Measured in the 2026-07-13 visual calibration. If the stamp develops a
    // uniform offset, adjust only these two values and re-run that runtime gate.
    const ALIGN_X_PT = 72;
    const ALIGN_Y_PT = 12;
    const boxXPt = PAGE_MARGIN_PT + ALIGN_X_PT + xPx * PX_TO_PT * scale;
    const boxYTopPt = PAGE_MARGIN_PT + ALIGN_Y_PT + yPx * PX_TO_PT * scale;
    const boxWPt = wPx * PX_TO_PT * scale;
    const boxHPt = hPx * PX_TO_PT * scale;

    await runSensitiveRequest(phaseController.signal, (requestOptions) =>
      batchWriteCells(
        accessToken,
        tempId as string,
        [
          {
            range: rangeFor(reportTab, nameRow, COL.name),
            values: [[args.personal.name]],
          },
          {
            range: rangeFor(reportTab, caseNumberRow, COL.caseNumber),
            values: [[args.personal.caseNumber]],
          },
          {
            range: rangeFor(reportTab, addressRow, COL.address),
            values: [[args.personal.address]],
          },
          {
            range: rangeFor(reportTab, phoneRow, COL.phone),
            values: [[args.personal.phone]],
          },
        ],
        "RAW",
        requestOptions,
      ),
    );
    await runSensitiveRequest(phaseController.signal, (requestOptions) =>
      batchWriteCells(
        accessToken,
        tempId as string,
        [
          {
            range: rangeFor(reportTab, dateRow, COL.date),
            values: [[args.personal.date]],
          },
        ],
        "USER_ENTERED",
        requestOptions,
      ),
    );

    emitProgress({ stage: "export" });
    const reportPdfBuffer = await runSensitiveRequest(
      phaseController.signal,
      (requestOptions) =>
        exportSheetTabPdf(
          accessToken,
          tempId as string,
          gid,
          requestOptions,
        ),
    );
    return { reportPdfBuffer, boxXPt, boxYTopPt, boxWPt, boxHPt };
  } finally {
    clearTimeout(phaseTimer);
    if (tempId) {
      await deleteTemporaryReportCopy(accessToken, tempId, emitTelemetry);
    }
  }
}

async function appendAttachmentsInOrder(
  doc: PDFDocument,
  accessToken: string,
  inputs: AttachmentInput[],
  onCompleted: (completed: number) => void,
): Promise<string[]> {
  const skippedFiles: string[] = [];
  let completed = 0;
  // Hold at most three downloaded attachment buffers at once. PDFDocument and
  // final serialization memory still scale with the complete bundle size.
  for (let offset = 0; offset < inputs.length; offset += ATTACHMENT_DOWNLOAD_CONCURRENCY) {
    const batch = inputs.slice(offset, offset + ATTACHMENT_DOWNLOAD_CONCURRENCY);
    const downloads: AttachmentDownload[] = await Promise.all(
      batch.map(async (input): Promise<AttachmentDownload> => {
        try {
          const { buffer, mimeType } = await downloadDriveFile(
            accessToken,
            input.driveFileId,
            input.mimeType,
          );
          return { ok: true, input, buffer, mimeType };
        } catch {
          return { ok: false, input };
        }
      }),
    );
    for (const download of downloads) {
      if (download.ok) {
        try {
          await appendFileAsPages(doc, download.buffer, download.mimeType);
        } catch {
          skippedFiles.push(download.input.name);
        }
      } else {
        skippedFiles.push(download.input.name);
      }
      completed += 1;
      onCompleted(completed);
    }
  }
  return skippedFiles;
}

export async function buildReportPdfBundle(
  accessToken: string,
  args: PdfExportArgs,
  options: PdfBuildOptions,
  onProgress?: (progress: PdfProgress) => void,
): Promise<PdfExportResult> {
  const emitProgress = (progress: PdfProgress) => {
    try {
      onProgress?.(progress);
    } catch {
      // Progress must never change the export outcome.
    }
  };
  const emitTelemetry = (event: PdfTelemetry) => {
    try {
      options.onTelemetry?.(event);
    } catch {
      // Telemetry must never prevent cleanup or change the export outcome.
    }
  };
  const skippedFiles: string[] = [];
  const reportName = `${REPORT_FILE_PREFIX} ${args.period.folderName}`;
  const tempName = `${reportName} (זמני)`;

  emitProgress({ stage: "prepare" });
  const personalizedPage = await exportPersonalizedReportPage(
    accessToken,
    args,
    tempName,
    options.sensitiveDeadlineAt,
    emitProgress,
    emitTelemetry,
  );

  // The personalized temporary Sheet is already deleted before local stamping
  // or any attachment, move, save, and upload work begins.
  const doc = await PDFDocument.load(personalizedPage.reportPdfBuffer);
  const page = doc.getPage(0);
  const sigBuffer = decodeSignature(args.signaturePngBase64);
  const sigImage = isPng(sigBuffer)
    ? await doc.embedPng(sigBuffer)
    : await doc.embedJpg(sigBuffer);

  // The signature is intentionally drawn at the calibrated fixed height; its
  // width retains the source aspect ratio. This makes it straddle the line
  // instead of shrinking into the single-row target cell.
  const SIG_HEIGHT_PT = 60;
  const sigWPt = SIG_HEIGHT_PT * (sigImage.width / sigImage.height);
  const sigX = personalizedPage.boxXPt + (personalizedPage.boxWPt - sigWPt) / 2;
  const pageY =
    page.getHeight() -
    (personalizedPage.boxYTopPt + personalizedPage.boxHPt);
  page.drawImage(sigImage, {
    x: sigX,
    y: pageY,
    width: sigWPt,
    height: SIG_HEIGHT_PT,
  });

  if (args.previewOnly) {
    const previewBytes = await doc.save();
    return {
      pdf: null,
      skippedFiles,
      previewPdfBase64: Buffer.from(previewBytes).toString("base64"),
    };
  }

  emitProgress({ stage: "sources" });
  const sourceFiles = await listDriveFolderImages(
    accessToken,
    args.folders.sourceId,
  );
  emitProgress({ stage: "sources", total: sourceFiles.length });
  skippedFiles.push(
    ...(await appendAttachmentsInOrder(
      doc,
      accessToken,
      // Preserve the current order returned by Drive; do not introduce a new
      // cross-export ordering contract here.
      sourceFiles.map((file) => ({
        name: file.name,
        driveFileId: file.id,
        mimeType: file.mimeType,
      })),
      (done) => emitProgress({ stage: "sources", done, total: sourceFiles.length }),
    )),
  );

  emitProgress({ stage: "receipts" });
  const allReceipts = await getAllReceipts(accessToken, args.spreadsheetId);
  const byFileName = new Map(
    allReceipts.map((receipt) => [receipt.fileName, receipt.driveFileId ?? null] as const),
  );
  const resolvedReceipts: AttachmentInput[] = [];
  for (const fileName of args.attachedReceiptFileNames) {
    const driveFileId = byFileName.get(fileName);
    if (!driveFileId) {
      skippedFiles.push(fileName);
      continue;
    }
    resolvedReceipts.push({ name: fileName, driveFileId });
  }
  emitProgress({ stage: "receipts", total: resolvedReceipts.length });
  skippedFiles.push(
    ...(await appendAttachmentsInOrder(
      doc,
      accessToken,
      resolvedReceipts,
      (done) =>
        emitProgress({ stage: "receipts", done, total: resolvedReceipts.length }),
    )),
  );

  // Preserve the existing product behavior: move every resolved receipt,
  // including one whose attachment append failed.
  emitProgress({ stage: "move" });
  const docsFolderId = await ensureDriveFolder(
    accessToken,
    DOCS_SUBFOLDER,
    args.folders.periodId,
  );
  emitProgress({ stage: "move", total: resolvedReceipts.length });
  let moved = 0;
  for (
    let offset = 0;
    offset < resolvedReceipts.length;
    offset += RECEIPT_MOVE_CONCURRENCY
  ) {
    const batch = resolvedReceipts.slice(
      offset,
      offset + RECEIPT_MOVE_CONCURRENCY,
    );
    await Promise.all(
      batch.map(async (receipt) => {
        try {
          await moveDriveFile(accessToken, receipt.driveFileId, docsFolderId);
        } catch {
          // Best effort: move failure must not fail the completed PDF bundle.
        } finally {
          moved += 1;
          emitProgress({ stage: "move", done: moved, total: resolvedReceipts.length });
        }
      }),
    );
  }

  emitProgress({ stage: "upload" });
  const pdfBytes = await doc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  const safeName = args.personal.name.replace(/[\\/]/g, " ").trim();
  const pdfName = `${safeName}- ${reportName}.pdf`;
  const uploaded = await uploadFileToDrive(
    accessToken,
    args.folders.periodId,
    pdfName,
    pdfBuffer,
    "application/pdf",
  );

  return {
    pdf: {
      id: uploaded.id,
      url: `https://drive.google.com/file/d/${uploaded.id}/view`,
    },
    skippedFiles,
  };
}
