# Report PDF Timeout and Cleanup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production-sized signed PDF issuance finish within the existing 300-second Vercel budget, remove the personalized temporary Sheet before long attachment work, and report interrupted streams truthfully inside the dialog.

**Architecture:** Export the personalized report page inside a narrowly scoped temporary-Sheet helper whose cleanup completes before attachment processing. Download attachment batches concurrently but append them sequentially to preserve order, move receipts with bounded concurrency, and keep the NDJSON route while treating its final line—not HTTP 200—as the operation verdict.

**Tech Stack:** Next.js 16 App Router on the Node runtime, TypeScript strict, googleapis Drive v3 and Sheets v4, pdf-lib, Jimp, React 19, existing shadcn primitives. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-report-pdf-timeout-design.md`

## Global Constraints

- Branch: `feat/report-pdf-timeout`, base commit `b96a60f` from `dev`.
- Keep `export const maxDuration = 300`; do not depend on a paid Vercel duration limit.
- Personal details and signature data may exist only in request-local memory, the short-lived temporary Sheet, exported PDF bytes, and the user-initiated final PDF.
- Never log file names, Drive ids, folder ids, spreadsheet ids, personal values, signature data, or raw production exception messages.
- Preserve page order: report page, source documents in current order, attached receipts in the supplied order.
- Preserve per-file skip behavior and best-effort receipt moves.
- Keep PDFDocument mutations sequential; parallelize only independent I/O.
- Add no packages and no automated tests. The repository's declared testing gap overrides the generic TDD skill for this plan.
- Do not run a dev server or visual verification. Runtime E2E belongs to the user after the final commit.
- Approved new Hebrew string: `החיבור לשרת הסתיים לפני שהנפקת ה-PDF הושלמה.`
- Reused approved generic Hebrew string: `הנפקת ה-PDF נכשלה`.
- The route derives an absolute sensitive deadline as the earlier of 90 seconds
  from authorization completion and 240 seconds from handler entry. Refuse to
  create the temporary copy when no allowance remains.
- Application-owned cancellation: every sensitive Google request has the
  absolute phase signal combined with a 30-second per-request signal; cleanup
  has an independent 15-second signal. Clear every timer in `finally`.
- Do not pass Gaxios `timeout` or `retryConfig.totalTimeout`; installed Gaxios
  does not make either the required absolute cancellation boundary.
- Sensitive requests disable SDK retries. Cleanup has one retry owner: the
  Google SDK receives `retry: true` with `retryConfig.retry = 1`; no manual
  delete retry is allowed.

---

### Task 1: Shorten the personalized temporary-Sheet lifecycle

**Files:**
- Modify: `app/api/report/pdf/route.ts:31-110`
- Modify: `lib/google.ts:778-1228`
- Modify: `lib/report/pdf.ts:209-487`

**Interfaces:**
- `lib/google.ts` gains an exported structural `GoogleRequestOptions` type and optional request-options parameters on the existing helpers used by the sensitive phase: `copyDriveFileAsSheet`, `listSheetTabs`, `getSheetGrid`, `batchWriteCells`, `getSheetTabMetrics`, `exportSheetTabPdf`, and `deleteDriveFile`.
- Produces a private `exportPersonalizedReportPage(...)` helper returning exported report bytes plus numeric signature placement.
- `buildReportPdfBundle(...)` consumes that result only after the helper's cleanup has completed.
- No existing result shape or HTTP contract changes.

- [x] **Step 1: Add bounded Google request options**

In `lib/google.ts`, define:

```ts
export interface GoogleRequestOptions {
  signal?: AbortSignal;
  retry?: boolean;
  retryConfig?: { retry?: number };
}
```

Pass the optional object as the generated Google API method's second argument.
For `exportSheetTabPdf`, pass only `signal` to raw `fetch`; its caller owns the
combined deadline. Existing callers omit the parameter and retain their
behavior. Do not expose `timeout` because the installed Gaxios implementation
can replace an already-aborted signal when that option is present.

- [x] **Step 2: Define phase and cleanup policies**

In the route, record handler entry before request parsing. After authorization,
derive `sensitiveDeadlineAt` as:

```ts
Math.min(Date.now() + 90_000, handlerStartedAt + 240_000)
```

Pass that absolute timestamp into `buildReportPdfBundle`. Add private constants
`SENSITIVE_REQUEST_TIMEOUT_MS = 30_000` and
`CLEANUP_TIMEOUT_MS = 15_000`. Add a private result shape containing
`reportPdfBuffer`, `boxXPt`, `boxYTopPt`, `boxWPt`, and `boxHPt`.

Before copy creation, fail if `sensitiveDeadlineAt <= Date.now()`. Create an
application-owned phase controller whose timer expires at that absolute
deadline. For each preparation/export operation, create a 30-second request
controller, combine its signal with the phase signal outside Gaxios, pass
`{ signal, retry: false }`, and clear the request timer in `finally`. Clear the
phase timer in the helper's outer `finally` before cleanup. Cleanup must use a
fresh application-owned controller/timer with no phase signal:

```ts
{
  signal: cleanupController.signal,
  retry: true,
  retryConfig: { retry: 1 },
}
```

Abort cleanup after 15 seconds with an `AbortError`, then clear its timer in
`finally`. Do not pass SDK `timeout` or `retryConfig.totalTimeout`, and do not
add a manual retry loop. A thrown 404 is not success. Cleanup failure blocks
continuation and takes precedence over a simultaneous preparation failure;
logs and responses remain generic.

- [x] **Step 3: Isolate and minimize personalized Sheet work**

Move temporary-copy creation, field writes, grid/metric reads, geometry calculation, and `exportSheetTabPdf` into `exportPersonalizedReportPage`. Use `let tempId: string | null = null` and this lifecycle:

```ts
try {
  tempId = await copyDriveFileAsSheet(...);
  // fill, measure, export
  return { reportPdfBuffer, boxXPt, boxYTopPt, boxWPt, boxHPt };
} finally {
  if (tempId) await deleteTemporaryReportCopy(accessToken, tempId);
}
```

The final `buildReportPdfBundle` must not retain a broad temporary-copy `finally` around source documents, receipts, moves, save, or upload.

List tabs, read the grid, resolve anchors, read metrics, and calculate geometry
before writing any personal field. Only then perform the two writes and export.
Every Google call receives fresh combined phase/request options. The `finally`
deletion uses the independent cleanup signal and retry options.

- [x] **Step 4: Stamp only after cleanup**

In `buildReportPdfBundle`, await `exportPersonalizedReportPage`, then load the returned bytes, decode/embed/draw the signature, and preserve the current preview behavior. Verify by code inspection that attachment processing is reachable only after temp deletion resolves.

- [x] **Step 5: Run focused static checks**

Run:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js app/api/report/pdf/route.ts lib/google.ts lib/report/pdf.ts
git diff --check
```

Expected: all commands exit 0.

---

### Task 2: Bound and reduce Drive work while preserving page order

**Files:**
- Modify: `lib/google.ts:778-792`
- Modify: `lib/report/pdf.ts:157-207,392-456`

**Interfaces:**
- Change `downloadDriveFile(accessToken, fileId)` to `downloadDriveFile(accessToken, fileId, knownMimeType?)` without breaking existing callers.
- Add private constants `ATTACHMENT_DOWNLOAD_CONCURRENCY = 3` and `RECEIPT_MOVE_CONCURRENCY = 4`.
- Add private ordered-batch helpers; do not export a new generic concurrency API.

- [x] **Step 1: Remove redundant source metadata calls**

Update `downloadDriveFile` so it skips `drive.files.get({ fields: "mimeType" })` when `knownMimeType` is supplied and returns that supplied type with the media buffer. Existing two-argument callers keep current behavior.

- [x] **Step 2: Add ordered download batches**

Create a private helper in `lib/report/pdf.ts` that slices inputs into batches of three. Each download promise catches its own failure and resolves to an explicit success/failure result before `Promise.all`; never catch only around the whole batch. Append each result sequentially in original input order, record skips, and advance progress after each item. Release one batch before starting the next.

Source inputs pass the MIME type returned by `listDriveFolderImages`; receipt inputs omit it. Emit progress using a completed-item counter after each item has either appended or been skipped.

Document that this bounds outstanding attachment buffers by three files, not
by bytes; the accumulated PDF and final serialization still scale with total
input size. Preserve the existing Drive-returned source order without adding
`orderBy`.

- [x] **Step 3: Add bounded receipt moves**

Move receipts in batches of four with `Promise.all`. Keep per-file try/catch and best-effort semantics. Increment and emit the completed counter in each settled worker; never log or expose the file name. Preserve moving every resolved receipt, including one whose attachment append failed, and correct the existing inaccurate "successfully-attached" comment.

Record the request-count change accurately: for `S` source files and `R`
resolved receipts, the repair removes exactly `S` per-file metadata requests.
Do not claim that per-invocation concurrency is a global quota guarantee;
fixed operations, pagination, batch metadata reads, conditional parent
updates, and retries remain separate contributors.

- [x] **Step 4: Run focused static checks**

Run:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js lib/google.ts lib/report/pdf.ts
git diff --check
```

Expected: all commands exit 0.

---

### Task 3: Make route outcomes observable and client failures truthful

**Files:**
- Modify: `app/api/report/pdf/route.ts:31-110`
- Modify: `lib/report/pdf.ts:35-487`
- Modify: `components/ReportWizard.tsx:1022-1111,2742-2754`
- Modify: `components/PdfExportDialog.tsx:19-29,63-74,135-190`

**Interfaces:**
- `PdfExportDialogProps` gains `error: string | null`.
- `pdfError` stores a complete user-facing message.
- The NDJSON success shape remains unchanged.

- [x] **Step 1: Add privacy-safe route telemetry**

Track time from handler entry and the latest stage. Emit each stage before its first operation, then emit again when a listing/read makes its total available. For every client progress event, send the existing NDJSON object and log only `{ stage, done, total, elapsedMs }`. Add an internal telemetry callback for cleanup start/success/error without adding `cleanup` to `PdfProgress`. Log final success/error with outcome, latest stage, elapsed time, and at most a stable error category plus numeric HTTP status. Never serialize or log a caught exception message, raw exception object, Google request URL, or request body in any environment. The builder treats telemetry callback failures as no-ops so logging cannot prevent cleanup, mask its outcome, or turn success into failure.

Observe `req.signal` and log a transport-disconnect outcome once. Remove the
listener when processing finishes. Do not cancel the bundle: preserve the
existing behavior in which server work can finish after the client goes away.

On an unexpected streamed exception, send:

```ts
{ error: "הנפקת ה-PDF נכשלה" }
```

For the pre-stream `requireCapability` catch, retain `errorStatus(err)`.
Return the stable existing message only for local `UnauthenticatedError` and
`ForbiddenError` instances. Raw Google authentication errors and every
unexpected error receive the approved generic public message. Apply the same
production logging allowlist to this catch.

- [x] **Step 2: Replace the `HTTP 200` fallback**

Handle every terminal path around the reader:

```ts
if (!res.body) throw new Error(PDF_STREAM_INTERRUPTED);
// Catch reader.read() rejection at the read site. If no terminal verdict has
// arrived, map it to PDF_STREAM_INTERRUPTED; otherwise retain the verdict.
// Parse complete lines separately: malformed/truncated NDJSON maps to the
// generic PDF failure, not the transport-interruption message.
// Always reader.releaseLock() in finally.
```

After clean EOF, parse a non-empty decoder/buffer tail as one final line. Missing
verdict uses the interruption message. A final success without either
`previewPdfBase64` or `pdf` uses the generic failure. Keep pre-stream JSON errors
on their existing path. Do not infer a timeout specifically because a network
cut produces the same observable client state. Once a valid terminal verdict
exists, a later read rejection must not replace it.

- [x] **Step 3: Render failure inside the open dialog**

Pass `pdfError` into `PdfExportDialog`. Render a `text-sm text-destructive` paragraph inside the dialog while retaining the existing post-dialog error location. Both locations display the complete message without prepending a second failure label.

- [x] **Step 4: Run focused static checks**

Run:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js app/api/report/pdf/route.ts components/ReportWizard.tsx components/PdfExportDialog.tsx
git diff --check
```

Expected: all commands exit 0.

---

### Task 4: Full verification, Astra implementation review, and final commit gate

**Files:**
- Modify: `docs/superpowers/plans/2026-09-15-report-pdf-timeout.md` (checkbox ledger only)

- [x] **Step 1: Run repository verification**

Run:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js . --ignore-pattern .superpowers/worktrees/**
node node_modules/next/dist/bin/next build
git diff --check
```

Expected: typecheck and build exit 0. Full lint may contain only the accepted pre-existing `components/UploadZone.tsx:93` error; any new error blocks completion.

- [x] **Step 2: Inspect scope and privacy**

Compare the branch against `b96a60f`. Confirm no dependency changes, no report-content changes, no personal/file identifiers in new logs, unchanged `maxDuration = 300`, preserved current Drive-returned source order, deterministic receipt order, and temp cleanup before attachment processing. Confirm each sensitive Google request receives the application-owned combined phase/per-request signal with SDK retries disabled, while cleanup receives its independent application deadline and bounded SDK retry policy.

- [x] **Step 3: Request the second Astra review**

Give Astra the spec, this plan, base SHA, full implementation diff, and verification output. Require explicit findings by severity and an assessment of timeout reduction, cleanup safety, ordering, memory bounds, error semantics, privacy, and conformance with the declared no-test constraint.

- [x] **Step 4: Address review findings and re-run affected verification**

Fix every Critical or Important finding. Re-run focused checks and then the full verification commands. Re-request clarification from Astra if a finding is technically unsupported.

- [x] **Step 5: Stage and stop before the final commit**

Stage the implementation and ledger update. Present the staged diff summary, fresh verification evidence, Astra review, any addressed findings, and proposed commit:

```text
fix(report): harden PDF export timeout and cleanup
```

Do not create this final implementation commit until the user approves it.

---

### User Runtime Gate After the Final Commit

- [ ] Issue the same production-sized PDF and confirm it completes below 300 seconds.
- [ ] Open the PDF and confirm report/source/receipt order and content are unchanged.
- [ ] Confirm the period folder contains no temporary personalized Sheet.
- [ ] Confirm the Vercel logs contain stage/count/timing fields and no personal or file-identifying data.
- [ ] Interrupt one export and confirm the approved message is visible inside the still-open dialog.
- [ ] Cover both a clean EOF without a verdict and a rejected stream read.
- [ ] Inspect the successful production invocation's duration and memory; batching bounds concurrent file count, not total PDF bytes.
