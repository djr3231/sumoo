# Report PDF Timeout and Cleanup Hardening — Design

Approved by the user on 2026-09-15. Applies to branch
`feat/report-pdf-timeout`, based on `b96a60f` (`dev`).

## Problem

Production PDF issuance exceeded the route's explicit 300-second Vercel
Function duration. Vercel terminated the invocation, the NDJSON stream ended
without a final verdict, and the client displayed the misleading fallback
`HTTP 200` because the streaming response had already committed status 200.

The terminated invocation also left personalized temporary report Sheets in
Drive. This proves that process termination can bypass the current broad
`finally` cleanup window. The failure is therefore both a performance defect
and a privacy/lifecycle defect.

## Goals

1. Keep the existing synchronous, dependency-free PDF issuance architecture
   within the current 300-second route budget for the production-sized report.
2. Remove the personalized temporary Sheet before the long-running attachment
   and Drive-move stages begin.
3. Preserve the exact report/source/receipt page order and per-file skip
   semantics.
4. Surface an interrupted stream inside the open dialog with an actionable
   Hebrew message instead of `HTTP 200`.
5. Add privacy-safe production timing evidence so a future slow stage is
   identifiable without logging names, file identifiers, personal values, or
   signature data.

## Non-goals

- No asynchronous job system, queue, resumable export, or persisted job state.
- No dependency additions.
- No Vercel-plan-dependent increase above 300 seconds.
- No change to report contents, receipt-selection rules, file order, output
  naming, signature geometry, or the move-to-`מסמכים` product decision.
- No automated test suite. The repository deliberately declares that gap; the
  verification gates remain typecheck, lint, build, diff inspection, and user
  runtime E2E.

## Architecture

### 1. Short sensitive-copy lifetime

`lib/report/pdf.ts` will isolate temporary-Sheet work in a helper that:

1. creates the temporary report Sheet;
2. reads the signature placement geometry;
3. fills the transient personal fields;
4. exports the personalized report page bytes; and
5. deletes the temporary Sheet in the helper's own `finally` block.

The helper returns only the exported page bytes and non-sensitive numeric
signature placement. `buildReportPdfBundle` loads and stamps those bytes only
after cleanup has completed. It then performs attachment downloads, local PDF
merging, receipt moves, and final upload without any personalized temporary
Sheet remaining in Drive.

The route derives an absolute sensitive-phase deadline from both a 90-second
phase cap and handler entry plus 240 seconds. The latter reserves 15 seconds
for cleanup and a further 45-second termination margin inside the 300-second
function budget. If authentication consumed that allowance, the builder
refuses to create the temporary copy.

The application owns phase and per-request `AbortController` timers. Every
Google SDK call receives a signal combined from the absolute phase deadline
and a 30-second per-request deadline, with SDK retries disabled. The raw Sheets
export `fetch` receives the same combined signal. SDK `timeout` is deliberately
omitted because installed Gaxios can replace an already-aborted signal while
preparing its own timeout. Every application timer is cleared in `finally`.
Grid/anchor/geometry reads happen before personal values are written, reducing
the personalized portion of that window further. A deadline aborts the
underlying network request rather than merely abandoning a still-running
promise.

Cleanup does not reuse the phase signal. It receives an independent,
application-owned 15-second cancellation signal and one SDK call configured
for one transient retry, producing at most two delete attempts inside the
application deadline. SDK `timeout` and `retryConfig.totalTimeout` are omitted;
the latter controls retry delay rather than absolute cancellation. There is no
manual retry wrapper. A 404 remains a failure because Drive documents it as
either absent or inaccessible; it is not treated as proof that deletion
succeeded. If preparation/export and cleanup both fail, cleanup failure takes
precedence and blocks attachment processing. Safe telemetry can record both
operation categories and statuses, but output and logs preserve neither raw
cause nor request details.

The handler-derived cutoff reserves 60 seconds before Vercel's hard 300-second
termination for cleanup and termination margin. It narrows the unavoidable
hard-termination exposure to the short Google Sheet preparation/export window
and removes the proven failure mode where the temporary Sheet remains alive
during minutes of unrelated attachment work. It cannot make remote deletion
transactional: hard process termination or an ambiguous remote response can
still leave uncertainty, which remains a documented residual risk.

### 2. Bounded parallel Drive work

Attachment downloads will run in ordered batches of three. Downloads inside a
batch happen concurrently; downloaded files are appended to the shared
`PDFDocument` sequentially in their original order. The next batch does not
start until the current batch has been appended, bounding retained buffers and
avoiding concurrent mutation of `pdf-lib` state.

Source-document metadata already comes from `listDriveFolderImages`.
`downloadDriveFile` will accept an optional known MIME type so source downloads
can skip the redundant metadata request. Receipt downloads retain the metadata
lookup because receipt rows do not persist MIME type.

Receipt moves will run with bounded concurrency of four. Each move still keeps
its existing best-effort semantics. Progress `done` values represent completed
items and may arrive in completion order, while the PDF page order remains
deterministic.

Each download promise resolves to an explicit success/failure result before
the batch-level `Promise.all`, so one failed download cannot reject the batch
or discard healthy results. Batching bounds outstanding attachment buffers by
file count, not bytes. The accumulated PDF, decoded images, and final
serialization buffers still scale with document size; the production runtime
assessment must inspect duration and memory without claiming a fixed byte
bound.

Source order remains the order returned by the existing Drive listing. That
listing has no explicit `orderBy`, so identical source order across separate
exports is not newly guaranteed. The repair preserves rather than changes
that behavior. Receipt moves also preserve the current behavior of moving all
resolved receipts, including a receipt whose append failed; the inaccurate
"successfully-attached" comment will be corrected.

### 3. Stream verdict and dialog error

The route keeps streaming NDJSON and keeps `maxDuration = 300`. Once streaming
has begun, HTTP status 200 remains transport status rather than the operation
verdict.

The client will distinguish these cases:

- final `{ ok: true }`: existing success behavior;
- final `{ error }`: show the server's safe public error;
- stream closes or `reader.read()` rejects without a final verdict: show the approved message
  `החיבור לשרת הסתיים לפני שהנפקת ה-PDF הושלמה.`
- missing body: show the same interrupted-stream message;
- malformed/truncated NDJSON or an invalid success payload: show the already
  approved generic failure `הנפקת ה-PDF נכשלה`.

The reader lock is released in `finally`. Once a valid terminal verdict has
been received, a later transport failure does not replace it.

`PdfExportDialog` receives the transient error and renders it while the dialog
remains open. The existing error below the report buttons remains as a second
post-dialog location. Both render a complete message rather than constructing
`HTTP <status>` for a committed stream.

Unexpected server exceptions after the stream starts return the already
approved generic string `הנפקת ה-PDF נכשלה`. Before streaming, known local
authentication/authorization errors retain their existing status and stable
message; raw Google and unexpected errors retain their status mapping but use
the generic public message. Internal exception messages, raw Google error
objects, request URLs, and request bodies are never serialized or logged in
any environment.

### 4. Privacy-safe timing evidence

The route will emit structured production logs from handler entry through the
final outcome. Each stage is recorded before its first operation; stages whose
totals require a list/read emit again after the total is known. Cleanup uses an
internal telemetry event rather than a client-visible progress stage. Allowed
fields are:

- `stage`;
- `done` and `total`;
- elapsed milliseconds; and
- outcome (`success`, `error`, or client disconnect where observable).

Logs must not contain personal values, signature bytes, file names, Drive ids,
folder ids, spreadsheet ids, raw exception messages, raw exception objects,
request URLs, or request bodies. Safe error telemetry may contain only a
stable operation category and numeric HTTP status; development is not exempt
from this privacy allowlist.

The request abort signal records a transport disconnect without cancelling the
bundle; the existing behavior allows server work to continue after the client
goes away. A later bundle success/error is logged independently, and the abort
listener is removed when processing finishes. Telemetry callback failures are
ignored by the builder so logging cannot block cleanup or change the export
outcome.

## Files

- `lib/google.ts` — bounded request options for sensitive Sheet operations and
  an optional known MIME type for Drive media downloads.
- `lib/report/pdf.ts` — short-lived temp helper, cleanup retry, ordered bounded
  attachment batches, and bounded receipt moves.
- `app/api/report/pdf/route.ts` — safe public failure and privacy-safe stage
  timing logs.
- `components/PdfExportDialog.tsx` — render an issuance error inside the open
  dialog.
- `components/ReportWizard.tsx` — interrupted-stream verdict and dialog error
  wiring.

## Verification

Static gates:

1. `node node_modules/typescript/bin/tsc --noEmit`
2. changed-file ESLint, followed by the repository full lint command with the
   accepted pre-existing `components/UploadZone.tsx:93` error treated exactly
   as documented;
3. `node node_modules/next/dist/bin/next build`
4. `git diff --check`
5. privacy and scope greps over the branch diff.

User runtime gate after the final commit:

1. issue the same production-sized PDF;
2. confirm progress completes and the Drive PDF opens with unchanged page
   order and content;
3. confirm no `(<report name>) (זמני)` Sheet remains;
4. confirm the Vercel invocation completes below 300 seconds; and
5. confirm both a clean EOF without a verdict and a rejected stream read use
   the approved message inside the still-open dialog; and
6. inspect Vercel duration and memory for the production-sized run, recognizing
   that the implementation bounds concurrent file count rather than total PDF
   bytes.
