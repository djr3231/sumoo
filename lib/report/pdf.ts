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
import { PDFDocument } from "pdf-lib";
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
}
export interface PdfExportResult {
  pdf: { id: string; url: string };
  skippedFiles: string[]; // names that failed to append (e.g. encrypted PDFs)
}

// Progress event for the streaming route: stage + loop counters ONLY —
// never file names, never personal values (privacy hard rule).
export interface PdfProgress {
  stage: "prepare" | "export" | "sources" | "receipts" | "move" | "upload";
  done?: number; // 1-based, present inside the three file loops
  total?: number;
}

// Approved Hebrew strings (reconstructed locally — see task brief "Names").
const REPORT_FILE_PREFIX = "דוח דו-חודשי";
const DOCS_SUBFOLDER = "מסמכים";

// Ground-truth anchor labels (write targets on the TEMP copy only — NOT the
// generate.ts block-list). Write columns are fixed constants per the task's
// anchor table; rows are scanned per-report since layout may shift.
const ANCHOR = {
  name: 'בעניין: היחיד/ה',
  caseNumber: "מס' תיק ממונה",
  address: "כתובת עדכנית",
  // Exact label (matches PERSONAL_DETAIL_LABELS): bare "טלפון" also matches an
  // earlier cell higher in the form, so anchor on the specific phone label.
  phone: "טלפון היחיד/ה",
  signature: "חתימת היחיד/ה",
} as const;
const COL = { name: 2, caseNumber: 6, address: 2, phone: 6, date: 2, signatureLeft: 6, signatureRight: 7 } as const; // C/G/C/G/C, G:H

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const PAGE_MARGIN_PT = 18; // 0.25in, matching exportSheetTabPdf's margins

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
const rangeFor = (tab: string, row0: number, col0: number) => `'${tab}'!${colA1(col0)}${row0 + 1}`;

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
async function appendFileAsPages(doc: PDFDocument, buffer: Buffer, mimeType: string): Promise<void> {
  if (mimeType === "application/pdf") {
    const src = await PDFDocument.load(buffer);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => doc.addPage(p));
    return;
  }
  const image = isPng(buffer) ? await doc.embedPng(buffer) : await doc.embedJpg(buffer);
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

export async function buildReportPdfBundle(
  accessToken: string,
  args: PdfExportArgs,
  onProgress?: (p: PdfProgress) => void,
): Promise<PdfExportResult> {
  // A throwing progress listener must never break the bundle.
  const emit = (p: PdfProgress) => {
    try {
      onProgress?.(p);
    } catch {
      /* ignore */
    }
  };
  const skippedFiles: string[] = [];

  // Stage 2: temp copy of the generated report Sheet — everything below runs
  // in try/finally so the temp copy is always cleaned up, even on failure.
  const reportName = `${REPORT_FILE_PREFIX} ${args.period.folderName}`;
  const tempName = `${reportName} (זמני)`;
  emit({ stage: "prepare" });
  const tempId = await copyDriveFileAsSheet(accessToken, args.reportId, tempName, args.folders.periodId);

  try {
    // Stage 3: fill personal fields on the TEMP copy only.
    const tabs = await listSheetTabs(accessToken, tempId);
    const reportTab = pickReportTab(tabs);
    const grid = await getSheetGrid(accessToken, tempId, reportTab);

    const nameRow = findAnchorRow(grid, ANCHOR.name);
    if (nameRow === -1) throw new Error(`Missing anchor: "${ANCHOR.name}"`);
    const caseNumberRow = findAnchorRow(grid, ANCHOR.caseNumber);
    if (caseNumberRow === -1) throw new Error(`Missing anchor: "${ANCHOR.caseNumber}"`);
    const addressRow = findAnchorRow(grid, ANCHOR.address);
    if (addressRow === -1) throw new Error(`Missing anchor: "${ANCHOR.address}"`);
    const phoneRow = findAnchorRow(grid, ANCHOR.phone);
    if (phoneRow === -1) throw new Error(`Missing anchor: "${ANCHOR.phone}"`);
    // Signature row anchors the footer; date shares that footer row. Scanning
    // for "תאריך:" starting at/after the signature row keeps the anchor
    // robust against any earlier, unrelated "תאריך" cell higher in the sheet
    // (kept simple per the brief — do not change the written value/column).
    const signatureRow = findAnchorRow(grid, ANCHOR.signature);
    if (signatureRow === -1) throw new Error(`Missing anchor: "${ANCHOR.signature}"`);
    const dateRow = findAnchorRow(grid, "תאריך:", signatureRow);
    if (dateRow === -1) throw new Error('Missing anchor: "תאריך:"');

    await batchWriteCells(accessToken, tempId, [
      { range: rangeFor(reportTab, nameRow, COL.name), values: [[args.personal.name]] },
      { range: rangeFor(reportTab, caseNumberRow, COL.caseNumber), values: [[args.personal.caseNumber]] },
      { range: rangeFor(reportTab, addressRow, COL.address), values: [[args.personal.address]] },
      { range: rangeFor(reportTab, phoneRow, COL.phone), values: [[args.personal.phone]] }, // RAW preserves leading 0
    ]);
    // Real date value (USER_ENTERED), not RAW text — matches the b7ea971 convention.
    await batchWriteCells(
      accessToken,
      tempId,
      [{ range: rangeFor(reportTab, dateRow, COL.date), values: [[args.personal.date]] }],
      "USER_ENTERED",
    );

    // Stage 4: signature box geometry (pixels → PDF points, under fit-to-page).
    // rowPx/colPx are 0-based arrays; the scanned row indexes them directly.
    const metrics = await getSheetTabMetrics(accessToken, tempId, reportTab);
    const gid = metrics.sheetId;
    const sumPx = (arr: number[], count: number) => arr.slice(0, count).reduce((s, n) => s + n, 0);

    // Content extent = the VALUE extent of the already-fetched grid. Trailing
    // formatting-only rows/cols would extend the real print extent — accepted
    // risk; calibrated at E2E via the ALIGN_* constants below.
    const usedRows = grid.length;
    const usedCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const contentWpx = sumPx(metrics.colPx, usedCols);
    const contentHpx = sumPx(metrics.rowPx, usedRows);

    let xPx = sumPx(metrics.colPx, COL.signatureLeft); // Σ colPx[0..5]
    const wPx = (metrics.colPx[COL.signatureLeft] ?? 0) + (metrics.colPx[COL.signatureRight] ?? 0);
    const yPx = sumPx(metrics.rowPx, signatureRow); // Σ rowPx[0..row-1]
    const hPx = metrics.rowPx[signatureRow] ?? 0;

    // RTL mirror REMOVED (E2E 2026-07-13): mirroring pushed x negative when the
    // value-grid width under-measured the form → signature landed off-page and
    // vanished. The earlier "looked correct" observation was a manually-embedded
    // test image in the sheet, not our stamp. x stays measured-from-left (on
    // page); re-add a mirror only if E2E shows the stamp on the wrong side.
    // metrics.rightToLeft is still available if that calibration is needed.

    // scale=4 (fit-to-page) shrinks content by a computable factor:
    // px→pt is 0.75 at 100% (96dpi→72pt); printable area = A4 − 0.25in margins.
    const PX_TO_PT = 0.75;
    const printableW = A4_WIDTH_PT - 2 * PAGE_MARGIN_PT;
    const printableH = A4_HEIGHT_PT - 2 * PAGE_MARGIN_PT;
    const s = Math.min(printableW / (contentWpx * PX_TO_PT), printableH / (contentHpx * PX_TO_PT));

    // Slack-axis alignment (does Sheets center the axis that doesn't bind?) is
    // undocumented. These are the E2E calibration constants — if the stamp
    // shows a uniform offset, adjust ONLY these two (default 0 = top-left).
    const ALIGN_X_PT = 0;
    const ALIGN_Y_PT = 0;
    const boxXPt = PAGE_MARGIN_PT + ALIGN_X_PT + xPx * PX_TO_PT * s;
    const boxYTopPt = PAGE_MARGIN_PT + ALIGN_Y_PT + yPx * PX_TO_PT * s;
    const boxWPt = wPx * PX_TO_PT * s;
    const boxHPt = hPx * PX_TO_PT * s;

    // Stage 5: export the temp copy's report tab to PDF and stamp the signature.
    emit({ stage: "export" });
    const reportPdfBuffer = await exportSheetTabPdf(accessToken, tempId, gid);
    const doc = await PDFDocument.load(reportPdfBuffer);
    const page = doc.getPage(0);
    const sigBuffer = decodeSignature(args.signaturePngBase64);
    const sigImage = isPng(sigBuffer) ? await doc.embedPng(sigBuffer) : await doc.embedJpg(sigBuffer);
    const fit = fitCentered(sigImage.width, sigImage.height, boxWPt, boxHPt);
    // pdf-lib's origin is bottom-left; boxYTopPt is measured from the page
    // TOP, so convert: y = pageHeight - boxYTopPt - boxHeight (+ centering offset).
    const pageY = page.getHeight() - boxYTopPt - boxHPt + fit.dy;
    page.drawImage(sigImage, {
      x: boxXPt + fit.dx,
      y: pageY,
      width: fit.w,
      height: fit.h,
    });

    // Stage 6: append source documents (bank statements / salary slips).
    const sourceFiles = await listDriveFolderImages(accessToken, args.folders.sourceId);
    emit({ stage: "sources", total: sourceFiles.length });
    for (let i = 0; i < sourceFiles.length; i++) {
      const f = sourceFiles[i];
      emit({ stage: "sources", done: i + 1, total: sourceFiles.length });
      try {
        const { buffer, mimeType } = await downloadDriveFile(accessToken, f.id);
        await appendFileAsPages(doc, buffer, mimeType);
      } catch {
        skippedFiles.push(f.name); // one bad/encrypted file must never fail the whole bundle
      }
    }

    // Stage 7: append attached receipts, preserving the given order.
    const allReceipts = await getAllReceipts(accessToken, args.spreadsheetId);
    const byFileName = new Map(allReceipts.map((r) => [r.fileName, r.driveFileId ?? null] as const));
    const resolvedReceipts: Array<{ fileName: string; driveFileId: string }> = [];
    for (const fileName of args.attachedReceiptFileNames) {
      const driveFileId = byFileName.get(fileName);
      if (!driveFileId) {
        skippedFiles.push(fileName);
        continue;
      }
      resolvedReceipts.push({ fileName, driveFileId });
    }
    emit({ stage: "receipts", total: resolvedReceipts.length });
    for (let i = 0; i < resolvedReceipts.length; i++) {
      const r = resolvedReceipts[i];
      emit({ stage: "receipts", done: i + 1, total: resolvedReceipts.length });
      try {
        const { buffer, mimeType } = await downloadDriveFile(accessToken, r.driveFileId);
        await appendFileAsPages(doc, buffer, mimeType);
      } catch {
        skippedFiles.push(r.fileName);
      }
    }

    // Stage 8: move successfully-attached receipts to the docs subfolder.
    // Runs AFTER the PDF bytes are assembled; per-file try/catch (a failed
    // move must not fail the bundle).
    const docsFolderId = await ensureDriveFolder(accessToken, DOCS_SUBFOLDER, args.folders.periodId);
    emit({ stage: "move", total: resolvedReceipts.length });
    for (let i = 0; i < resolvedReceipts.length; i++) {
      const r = resolvedReceipts[i];
      emit({ stage: "move", done: i + 1, total: resolvedReceipts.length });
      try {
        await moveDriveFile(accessToken, r.driveFileId, docsFolderId);
      } catch {
        // best-effort — the PDF already has the receipt embedded
      }
    }

    // Stage 9: save + upload (overwrite semantics).
    emit({ stage: "upload" });
    const pdfBytes = await doc.save();
    const pdfBuffer = Buffer.from(pdfBytes);
    // Every issued version is kept (no overwrite): the filename is prefixed with
    // the filer's name. Strip path separators the name must not contain in a
    // Drive filename; a same-named file just co-exists as a distinct Drive id.
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
      pdf: { id: uploaded.id, url: `https://drive.google.com/file/d/${uploaded.id}/view` },
      skippedFiles,
    };
  } finally {
    // Temp copy must die even on failure — it's the only place personal
    // details/signature ever touch a Sheet.
    await deleteDriveFile(accessToken, tempId);
  }
}
