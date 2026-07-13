# Insolvency Report — "נפק PDF" (Signed PDF Bundle Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

Wizard step 6 already generates two anonymous Google-Sheet artifacts (working sheet + government report) per `docs/superpowers/plans/2026-07-09-insolvency-report-step6.md`. The government form must ultimately be **submitted as a signed PDF containing the filer's personal details** (name, case number, address, phone, date, signature) plus **all supporting documents** — details the app deliberately never stores (see memory `project_report_anonymity`).

This feature adds a **"נפק PDF"** button beside "הפק דוח": a dialog collects the personal details **one-time** (transient component state, never persisted, never logged), the server fills them into a **temporary copy** of the report Sheet, exports the דו"ח tab to PDF, **stamps the signature image** over the signature cell area, appends the period's source documents and the attached receipts, saves the merged PDF to the period's Drive folder (user-approved: personal details may persist **only** in this output file, nowhere else), and **permanently deletes the temp copy**.

**Key feasibility fact (verified 2026-07-12):** Sheets API v4 has **no request type for inserting a floating/over-grid image** — signature insertion into the Sheet itself is impossible. The signature is therefore stamped onto the **exported PDF** with pdf-lib, positioned exactly by computing the target cell box from the sheet's row/column pixel metadata.

**Decisions locked with the user (2026-07-12):**
1. PDF page order: (1) דו"ח tab with personal details + signature, (2) source documents (bank/card statements, payslips), (3) **only** receipts attached to an expense line or added as cash — all other receipts filtered out. The פירוטים tab is NOT included.
2. Output saved to the period's Drive folder (link shown in UI). Personal details in the user's own Drive = user's accepted choice.
3. New dependency **pdf-lib** approved (pure JS, no native code). No other new deps. Signature canvas = plain `<canvas>` + pointer events (no dep).
4. Field → cell mapping (merged cells): שם → C13:D13, מס' תיק ממונה → G13:H13, כתובת עדכנית → C40:D40, טלפון → G40:H40, תאריך (default today) → C46:D46, חתימה → image **over** G46:H46.
5. A dedicated documents subfolder inside the period folder; the attached-receipt files are **moved** into it (they currently live in the general upload folder).

**Execution protocol (same as the step-6 plan):** this document was authored by Fable 5 (planning). A **fresh session on Opus 4.8** orchestrates via `superpowers:subagent-driven-development`: one task per **Sonnet 5 subagent** (Agent tool, `model: "sonnet"`), orchestrator reviews each report AND diff, runs `npm run typecheck` itself before accepting, commits, proceeds. Any ambiguity, template surprise, or new Hebrew string not in the approved list → **STOP-and-ASK**. Subagents MUST call context7 (with WebSearch fallback for REST semantics — context7's googleapis coverage is client-README only, verified during step-6 execution) before coding against Drive/Sheets/pdf-lib.

## Architecture

One server module (`lib/report/pdf.ts`) orchestrates the whole bundle build on top of four new generic `lib/google.ts` helpers (delete, move, tab pixel-metrics, tab→PDF export). One API route (`app/api/report/pdf/route.ts`). UI: a `PdfExportDialog` component (form + `SignatureField` canvas/upload) wired into the step-6 block of `ReportWizard.tsx`. The personal payload's only egress is the POST body; the persistent report Sheet is never touched (all writes go to a temp copy deleted in `finally`).

**Tech:** Next.js 16 App Router (Node runtime), TS strict, googleapis (Drive v3 + Sheets v4), pdf-lib, shadcn primitives already in the repo.

## Global Constraints

- Branch: `feat/report-pdf` off `dev`. **Precondition: `feat/report-generate` must already be merged into `dev`** (this plan builds on its modules). If it isn't, STOP and ask.
- Conventional commits; one logical change per commit; `npm run typecheck` passes before every commit; `npm run lint` clean for changed files (pre-existing `UploadZone.tsx:138` error is accepted).
- New dependency: **pdf-lib only** (approved). Nothing else.
- All Google API access via `lib/google.ts` only. The export-URL helper is the codebase's **first raw `fetch`** to a Google endpoint — it still lives in `lib/google.ts` (the rule is about the file boundary, not the SDK).
- API route contract: `runtime = "nodejs"`, `requireAccessToken()`, whole handler in try/catch, `{ ok: true, ... }` / `{ error }` + 4xx/5xx.
- shadcn primitives only; never `rounded-*`; no `alert()`. TS strict; no `any` without a comment.
- Label-anchored cell writes (scan for label text, never blind A1) with the fixed columns from the ground-truth table below; missing anchor → throw naming the label.
- Do NOT run `npm run dev` or visually verify — hand off to the user.
- **Privacy (hard rules):**
  - Personal values + signature live ONLY in: dialog local state → POST body → server locals → temp Sheet copy (deleted in `finally`) → the final PDF. NOWHERE else.
  - They must NOT appear in: the progress state object / `serializeProgress` (verify untouched), settings, the receipts tab, any `console.log`/error message, code, comments, or docs (use placeholders like `<שם>`).
  - The signature is never uploaded to Drive as a standalone file — it goes from the request buffer straight into pdf-lib.
  - `lib/report/generate.ts` and its anonymity guard are NOT modified (except exporting one existing function, Task 2).
- Quota: Sheets calls in this flow ≈ 4 (copy-adjacent reads/writes) — trivial. Drive calls scale with file count (downloads + 2-per-receipt moves) — Drive quota is per-100s and generous; do not add per-cell/per-row Sheets calls.

## Ground truth — personal-details cells (clean template, tab דו"ח)

| Field | Anchor label (find its row by scanning) | Write target (merged cell top-left) |
|---|---|---|
| שם | `בעניין: היחיד/ה` | C{row} (merged C:D) — expected row 13 |
| מס' תיק ממונה | `מס' תיק ממונה` | G{row} (merged G:H) — expected row 13 |
| כתובת עדכנית | `כתובת עדכנית` | C{row} (merged C:D) — expected row 40 |
| טלפון | `טלפון` | G{row} (merged G:H) — expected row 40 |
| תאריך | `תאריך` (footer row) | C{row} (merged C:D) — expected row 46 |
| חתימה (image) | `חתימת היחיד/ה` | **box over** G{row}:H{row} — expected row 46 |

Row = scanned; column = fixed constant from this table (cols C=2, G=6, H=7 zero-based). Writing to a merged range = write its top-left cell. Note: these are the same 5 labels as `PERSONAL_DETAIL_LABELS` in `lib/report/generate.ts` (there a write-BLOCK list; here, on the temp copy only, the write TARGETS).

## Approved strings (complete list — anything else → STOP-and-ASK)

| Purpose | String |
|---|---|
| Export button | `נפק PDF` |
| Dialog title | `פרטים להנפקת ה-PDF` |
| Dialog description | `הפרטים ישמשו להנפקה חד-פעמית ולא יישמרו במערכת.` |
| Field labels | `שם`, `מס' תיק ממונה`, `כתובת עדכנית`, `טלפון`, `תאריך`, `חתימה` |
| Signature controls | `צייר חתימה`, `העלאת תמונה`, `נקה` |
| Dialog actions | `הנפק`, `ביטול` |
| Busy label | `מנפיק…` |
| Success + link | `ה-PDF הופק בהצלחה`, `קובץ ה-PDF` |
| Failure | `הנפקת ה-PDF נכשלה` |
| Skipped files note | `קבצים שלא צורפו:` |
| Route 400 | `חסרים פרטים להנפקה` |
| Docs subfolder name | `מסמכים` |
| PDF file name | `דוח דו-חודשי <folderName>.pdf` (e.g. `דוח דו-חודשי 5-6_2026.pdf`) |
| Temp copy name | `<report file name> (זמני)` |

## Existing infrastructure to reuse (verified file:line, 2026-07-12)

- `lib/google.ts`: `driveClient`/`sheetsClient` (:37-43), `downloadDriveFile` (:695, → `{buffer, mimeType}`), `uploadFileToDrive` (:888), `copyDriveFileAsSheet` (:786), `batchWriteCells` (:866, optional `valueInputOption`), `getSheetGrid` (:844), `listSheetTabs` (:826), `findDriveFileInFolder` (:766), `ensureDriveFolder` (:737), `listDriveFolderImages` (:639 — image/*+pdf files in a folder), `getAllReceipts` (:472).
- `lib/report/generate.ts`: label-anchor helpers (`findCell`/`findRow`/`colA1`/`rangeFor`), `pickReportTab` (private — Task 2 exports it), `sheetUrl`, `PERSONAL_DETAIL_LABELS`.
- `Receipt.driveFileId` (lib/types.ts:216-232); receipts-tab column 12 = `drive_file_id`.
- `ReportFolders { rootId, periodId, sourceId, cashId }` (lib/report/period.ts:25-44); source docs live in `sourceId`; receipt files live in the general upload folder (NOT the period tree) — hence the move step.
- Wizard: attached receipts = expense lines with `e.receipt` (fileName) — covers matched AND cash-added; `allReceipts`/`attachments` state exists but the server should re-resolve driveFileIds from the receipts tab by fileName (state may be stale after resume).
- Step-6 UI block: `ReportWizard.tsx:2465-2499` (`space-y-3` div: הפק דוח button + links). POST pattern: `generateReport` (:977-1014). Dialog usage pattern: `UploadZone.tsx:348-372`.
- shadcn `Dialog` exists (`components/ui/dialog.tsx`), plus Input/Label/Button/Textarea.

---

### Task 0: Branch, plan doc, memory (orchestrator itself — no subagent)

**Steps:**
- [ ] Verify `feat/report-generate` is merged into `dev` (`git log dev --oneline | head` should show the step-6 commits). If not merged → STOP and ask the user.
- [ ] `git checkout dev && git pull && git checkout -b feat/report-pdf`
- [ ] Copy this plan file to `docs/superpowers/plans/2026-07-12-report-pdf-export.md`.
- [ ] Update memory `project_report_anonymity.md`: add — "Boundary refined (user decision 2026-07-12): a user-initiated PDF export MAY carry personal details in the OUTPUT FILE ONLY (saved to the user's own Drive). App state, Sheets tabs, progress JSON, settings, logs, and code stay 100% clean; the export uses a temp Sheet copy deleted in `finally`."
- [ ] Commit: `docs: add report-PDF-export plan`

### Task 1: Generic Drive/Sheets helpers in `lib/google.ts`

**Files:** modify `lib/google.ts`.

**Interfaces (produces, consumed by Task 2):**
```ts
export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void>;
// files.delete — permanent, bypasses trash (that is the point: the temp copy must not linger).

export async function moveDriveFile(accessToken: string, fileId: string, targetFolderId: string): Promise<void>;
// files.get(fields:"parents") → files.update({ fileId, addParents: target, removeParents: current.join(",") , fields:"id"}).
// No-op (skip the update) if already parented at target.

export async function getSheetTabMetrics(accessToken: string, spreadsheetId: string, tabTitle: string):
  Promise<{ sheetId: number; rowPx: number[]; colPx: number[] }>;
// spreadsheets.get with fields:
//   "sheets(properties(sheetId,title),data(rowMetadata(pixelSize),columnMetadata(pixelSize)))"
// Find the sheet by title; missing pixelSize defaults: rows 21px, cols 100px (Sheets defaults).

export async function exportSheetTabPdf(accessToken: string, spreadsheetId: string, gid: number): Promise<Buffer>;
// Raw fetch (first in this codebase — keep inside lib/google.ts):
//   https://docs.google.com/spreadsheets/d/{id}/export?format=pdf&gid={gid}
//     &size=A4&portrait=true&scale=1&sheetnames=false&printtitle=false&pagenum=false&gridlines=false
//     &top_margin=0.25&bottom_margin=0.25&left_margin=0.25&right_margin=0.25
//   headers: { Authorization: `Bearer ${accessToken}` } → res.arrayBuffer() → Buffer.
// scale=1 means 100% (needed for deterministic geometry). Throw with res.status text on !res.ok.
```

**Steps:**
- [ ] **context7 first** (googleapis): confirm `files.delete` semantics (permanent for owned files), `files.update` addParents/removeParents. For the export-URL parameters context7 will NOT cover it (verified limitation) → WebSearch "google sheets export url parameters pdf gid scale margins" and record the reference used in the task report.
- [ ] Implement the four helpers following the file's existing style (client factories, `fields` scoping, one API call each — `moveDriveFile` is 2, documented).
- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(google): drive delete/move, sheet tab pixel metrics, tab-to-PDF export helpers`

### Task 2: Server module — `lib/report/pdf.ts` (+ pdf-lib dep)

**Files:** create `lib/report/pdf.ts`; modify `lib/report/generate.ts` (ONLY to `export` the existing `pickReportTab`); `package.json` (+pdf-lib).

**Interfaces (produces, consumed by Task 3):**
```ts
export interface PersonalDetails {
  name: string; caseNumber: string; address: string; phone: string;
  date: string;               // DD/MM/YYYY (dialog default = today)
}
export interface PdfExportArgs {
  period: ReportPeriod;
  folders: ReportFolders;
  reportId: string;                    // the generated report Sheet id
  personal: PersonalDetails;
  signaturePngBase64: string;          // data-URL or bare base64 (PNG or JPEG)
  attachedReceiptFileNames: string[];  // ordered; server resolves driveFileIds
}
export interface PdfExportResult {
  pdf: { id: string; url: string };
  skippedFiles: string[];              // names that failed to append (e.g. encrypted PDFs)
}
export async function buildReportPdfBundle(accessToken: string, args: PdfExportArgs): Promise<PdfExportResult>;
```

**Implementation spec (comment each stage; ≤ ~350 lines):**

1. **context7 first**: resolve `pdf-lib`, query "load PDF copyPages merge documents" + "embedPng drawImage position scale page". Confirm `PDFDocument.load(buffer)`, `doc.copyPages(src, indices)` + `addPage`, `embedPng`/`embedJpg`, `page.drawImage(img, {x,y,width,height})` (origin bottom-left), `PDFDocument.create()`, `doc.save()`.
2. **Temp copy:** `copyDriveFileAsSheet(token, reportId, tempName, folders.periodId)` (native→native copy is fine) where `tempName = <report name> (זמני)`. Everything from here runs in `try { … } finally { await deleteDriveFile(token, tempId) }` — the temp copy must die even on failure.
3. **Fill personal fields (temp copy only):** `listSheetTabs` → `pickReportTab` → `getSheetGrid`. For each field in the ground-truth table: scan for the anchor label (trimmed `includes`); missing → `throw new Error('Missing anchor: "<label>"')`. One `batchWriteCells` RAW for name/caseNumber/address/phone (phone RAW preserves leading 0), one 1-cell `batchWriteCells` USER_ENTERED for the date (real date value, per the b7ea971 convention).
4. **Signature geometry:** `getSheetTabMetrics` on the temp copy's report tab. Signature row = the scanned `חתימת היחיד/ה` row. Box (px): `x = Σ colPx[0..5]`, `w = colPx[6]+colPx[7]`, `y = Σ rowPx[0..row-1]`, `h = rowPx[row]`. Convert to PDF points: `pt = px * 0.75` (96dpi→72pt at scale=1). Page placement: `pageX = leftMarginPt + x*0.75`, `pageYtop = topMarginPt + y*0.75` → pdf-lib (bottom-left origin): `y = pageHeight - pageYtop - hPt`. Margins = the 0.25in values passed in the export URL (0.25in = 18pt). **Comment this math**; it is the E2E calibration point — if the E2E shows an offset, adjust ONLY the margin constants.
5. **Export + stamp:** `exportSheetTabPdf(token, tempId, gid)` → `PDFDocument.load`. Decode the signature (strip `data:image/...;base64,` prefix if present; PNG via `embedPng`, JPEG via `embedJpg` — sniff bytes). Fit into the box preserving aspect ratio, centered; `drawImage` on page 0.
6. **Append source documents:** `listDriveFolderImages(token, folders.sourceId)` → for each file `downloadDriveFile`; PDF → `copyPages(all)` and add; image → new A4 page (595.28×841.89pt), draw fitted+centered. **Per-file try/catch**: on failure (encrypted/corrupt) push `name` to `skippedFiles` and continue — never fail the bundle for one attachment.
7. **Append receipts:** `getAllReceipts(token, spreadsheetId)` → resolve `args.attachedReceiptFileNames` (preserve the given order) to `driveFileId`s (skip + record names without an id); same download/append loop as stage 6. NOTE: route passes `spreadsheetId` (from `resolveSpreadsheetId`) into the module — add it to `PdfExportArgs` if cleaner.
8. **Move receipts to the docs subfolder:** `ensureDriveFolder(token, "מסמכים", folders.periodId)` → for each resolved receipt file `moveDriveFile`. Per-file try/catch (a failed move must not fail the bundle). Runs AFTER the PDF bytes are assembled.
9. **Save:** `doc.save()` → Buffer. Overwrite semantics: `findDriveFileInFolder(token, folders.periodId, pdfName)` → if found `deleteDriveFile` first → `uploadFileToDrive(token, folders.periodId, pdfName, buffer, "application/pdf")`. Return `{ pdf: { id, url: sheetUrl-style Drive link (`https://drive.google.com/file/d/<id>/view`) }, skippedFiles }`.
10. **Privacy self-check in code review terms:** no personal value ever passed to `console.*`, never written to any Sheet other than the temp copy, signature buffer never uploaded.

**Steps:**
- [ ] `npm install pdf-lib` → commit `chore(deps): add pdf-lib for PDF bundle export (user-approved)`.
- [ ] Implement per spec; export `pickReportTab` from generate.ts (no other change there).
- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(report): PDF bundle builder — fill temp copy, stamp signature, merge documents`

### Task 3: API route — `app/api/report/pdf/route.ts`

**Files:** create `app/api/report/pdf/route.ts`.

**Contract:** `POST /api/report/pdf`, body `{ period, folders, reportId, personal, signaturePngBase64, attachedReceiptFileNames }` → `{ ok: true, pdf: {id,url}, skippedFiles }` | `{ error }`.

**Steps:**
- [ ] Mirror `app/api/report/generate/route.ts` structure exactly: `runtime="nodejs"`, `maxDuration = 300` (many downloads), 400 guard `{ error: "חסרים פרטים להנפקה" }` when `!period?.year || !folders?.periodId || !reportId || !personal?.name || !signaturePngBase64` (empty strings for the other personal fields are allowed — write them as given; an empty date defaults server-side to today), `requireAccessToken`, `resolveSpreadsheetId`, call `buildReportPdfBundle`, return result. **No logging of `personal` or the signature anywhere, including the catch path** (the catch returns `(err as Error).message` only).
- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(report): PDF export API route`

### Task 4: `components/SignatureField.tsx`

**Interfaces (produces):** `<SignatureField value onChange />` where `value: string | null` (PNG data-URL) — controlled, no internal persistence.

**Steps:**
- [ ] Plain `<canvas>` (e.g. 400×150 logical px, `dir`-agnostic) with pointer events (`pointerdown/move/up`, `setPointerCapture`) drawing black strokes on transparent bg; `נקה` button clears; on stroke end → `canvas.toDataURL("image/png")` → `onChange`. Plus `העלאת תמונה`: hidden `<input type="file" accept="image/png,image/jpeg">` → FileReader → data-URL → `onChange` (and paint preview onto the canvas). Two mode buttons `צייר חתימה` / `העלאת תמונה` (shadcn `Button variant="outline"`).
- [ ] Client component, TS strict, no new deps, approved strings only, no `rounded-*`.
- [ ] `npm run typecheck` + lint clean → Commit: `feat(report): signature draw/upload field`

### Task 5: `components/PdfExportDialog.tsx` + ReportWizard wiring

**Files:** create `components/PdfExportDialog.tsx`; modify `components/ReportWizard.tsx`.

**Steps:**
- [ ] **PdfExportDialog** (client): shadcn `Dialog` (pattern: `UploadZone.tsx:348-372`). Title `פרטים להנפקת ה-PDF`, description `הפרטים ישמשו להנפקה חד-פעמית ולא יישמרו במערכת.`. Fields (Label+Input): שם, מס' תיק ממונה, כתובת עדכנית, טלפון, תאריך (`<Input type="text">` prefilled DD/MM/YYYY today), `<SignatureField/>`. Footer: `ביטול` (DialogClose) + `הנפק` (disabled unless name+signature present, busy label `מנפיק…`). Props: `open/onOpenChange/busy/onSubmit(payload)`. **All field state lives inside this component and is reset (`useState` initial) on close** — nothing lifts to wizard state.
- [ ] **ReportWizard.tsx** (step-6 block, `:2465` area): add `נפק PDF` button (`variant="outline"`, rendered only when `generated !== null`) + dialog `open` state + `pdfResult` **transient** state `{ url: string; skippedFiles: string[] } | null` (NOT added to the progress object — verify `serializeProgress`/`progressState` untouched). onSubmit: POST `/api/report/pdf` with `{ period, folders: created.folders, reportId: generated.reportId, personal, signaturePngBase64, attachedReceiptFileNames }` where `attachedReceiptFileNames = expenses.filter(e => isExpenseIncluded-semantics && e.receipt).sort(by date).map(e => e.receipt)` deduplicated (reuse the wizard's existing included-check pattern). Success: `ה-PDF הופק בהצלחה` + link `קובץ ה-PDF` (`<a target="_blank" rel="noreferrer">`), plus `קבצים שלא צורפו: <names>` muted line when `skippedFiles.length > 0`. Failure: destructive `הנפקת ה-PDF נכשלה` + message.
- [ ] `npm run typecheck` + `npm run lint` → PASS.
- [ ] Commit: `feat(report): step-6 PDF export dialog and wiring`

### Task 6: Full verification + handoff (orchestrator)

- [ ] `npm run typecheck` && `npm run lint` && `npm run build` — pass.
- [ ] Greps on the diff vs dev: no `rounded-*`/`alert(` added; **no `console.log` in the new files**; `serializeProgress` diff-free; `PERSONAL_DETAIL_LABELS` guard in generate.ts unchanged; only `package.json`/lockfile dep = pdf-lib.
- [ ] Privacy checklist re-verified against the diff (Global Constraints → Privacy).
- [ ] **Hand off to user E2E** (do NOT run the app): (a) dialog collects details, generates, link appears; (b) PDF page 1 = the report with the 5 values in the right cells and the signature positioned over G46:H46 at a sensible size — if offset, report the offset direction/magnitude (calibration = margin constants in Task 2 stage 4); (c) pages then show source docs, then ONLY attached/cash receipts, in order; (d) `skippedFiles` names encrypted PDFs if any; (e) the temp Sheet copy does NOT exist in Drive (search "(זמני)"); (f) the persistent report Sheet is still anonymous; (g) receipts moved into the `מסמכים` subfolder; (h) the progress JSON (autosave doc) contains no personal field; (i) re-export overwrites the PDF (no duplicates).
- [ ] After user confirmation: PR `feat/report-pdf` → `dev` via `mcp__github__*` (never `gh`).

## Risks

- **Signature position calibration** — the export-URL margin/scale behavior is semi-documented; the geometry math is deterministic but the margins may need one E2E calibration pass (fixed constants, Task 2 stage 4). Fail mode is cosmetic (offset stamp), not data corruption.
- **Encrypted/odd PDFs** (bank statements) may fail `PDFDocument.load` → by design skipped + reported, never fatal.
- **Large bundles** are held in memory (Buffers); dozens of files is fine, hundreds would not be — out of scope.
- **files.delete is permanent** — it is only ever called on (1) the temp copy created in the same request, (2) the previous export PDF being overwritten by name match in the period folder. Both intended.
