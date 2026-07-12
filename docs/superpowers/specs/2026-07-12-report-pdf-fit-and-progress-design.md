# Report PDF: fit-to-page export fix + staged progress feedback — Design

Approved by user 2026-07-12 (brainstorm session, Fable). Applies to branch `feat/report-pdf`
(post plan `2026-07-12-report-pdf-export.md`, commits `feca983..3303333`).

## Problem

1. **Broken layout (bug, root-caused):** `exportSheetTabPdf` exports with `scale=1` (100%).
   The דו"ח tab is wider/taller than A4's printable area at 100%, so the export smears
   across ~3 pages and splits the tables mid-body. User-verified experiment: the Sheets
   print dialog defaults to **התאמה לגודל הדף** (fit-to-page) and produces the expected
   single page; switching the dialog to רגיל (100%) reproduces our broken output exactly.
   Root cause = the `scale` parameter, nothing else (same file, same content).
2. **No process feedback (UX):** the export runs 2–4 minutes on a large period
   (sequential Drive downloads + moves) while the dialog shows only a static `מנפיק…`.
   User requirement: stage-level feedback **with a counter**, displayed **in the dialog**.

Both changes touch the same files (`lib/google.ts`, `lib/report/pdf.ts`, the route, the
dialog), designed together, executed as two sequential steps on `feat/report-pdf`.

## Part 1 — fit-to-page export + geometry under scale

### Export URL
`exportSheetTabPdf` changes `scale=1` → `scale=4` (fit-to-page — the exact setting the
user verified). All other parameters (A4, portrait, 0.25in margins, no
gridlines/sheetnames/pagenum) stay.

### Signature geometry (lib/report/pdf.ts stage 4)
Fit-to-page shrinks the content by a **computable** factor. New math:

- Content extent in px: `contentWpx = Σ colPx[0..lastUsedCol]`,
  `contentHpx = Σ rowPx[0..lastUsedRow]`, where the used extent comes from the already-
  fetched grid (`grid.length` rows; max row length columns). Caveat (documented in code):
  `values.get` reflects VALUE extent; formatting-only trailing rows/cols would extend the
  print extent — accepted risk, calibrated at E2E.
- Points at 100%: `pt = px * 0.75`; printable area: `A4 − 2×18pt` margins
  (559.28 × 805.89 pt).
- Fit factor: `s = min(printableW / contentWpt, printableH / contentHpt)` (no cap at 1 —
  content is known to exceed the page today; if Sheets also up-scales small content the
  uncapped form stays correct).
- Box: `x' = marginPt + xPx·0.75·s`, `y'` likewise; box width/height also ×`s`.
- Alignment unknowns (does Sheets center the slack axis?) remain **calibration
  constants** (default 0 = top-left anchored), adjusted in one E2E pass. Fail mode is a
  cosmetic offset only.

### RTL awareness
`getSheetTabMetrics` is extended to also return `rightToLeft: boolean` (from
`sheets(properties(rightToLeft))` — same single API call). When true, the x origin is
mirrored: `xFromLeftPx = contentWpx − (xPx + wPx)`.

**Calibration note (user evidence, 2026-07-12):** in the broken 3-page output the
signature landed in the correct spot **without** mirroring, suggesting the export may
not mirror RTL sheets (or the page fragmentation masked it). The mirror ships behind the
`rightToLeft` flag, but the E2E checklist explicitly verifies which side the signature
lands on; removing/keeping the mirror is a one-line change either way.

## Part 2 — staged progress over a streaming response (approach A)

### Module (lib/report/pdf.ts)
`buildReportPdfBundle` gains an optional callback:

```ts
export interface PdfProgress {
  stage: "prepare" | "export" | "sources" | "receipts" | "move" | "upload";
  done?: number;  // 1-based, present for the three file loops
  total?: number;
}
onProgress?: (p: PdfProgress) => void   // 3rd parameter of buildReportPdfBundle —
// NOT a PdfExportArgs field: PdfExportArgs mirrors the serializable POST body,
// and a callback cannot cross HTTP.
```

Emitted: once at each stage start; per-iteration inside the sources/receipts/move loops.
Progress payloads carry **stage + numbers only** — never personal values, never file
names. Callback failures must not break the bundle (fire-and-forget try/catch or
guaranteed-safe caller).

### Route (app/api/report/pdf/route.ts)
Becomes a streaming NDJSON response:
- The 400 guard still returns plain JSON (`Content-Type: application/json`) **before**
  any streaming starts.
- Otherwise returns `new Response(stream, { headers: { "Content-Type":
  "application/x-ndjson" } })`. Each progress event → one line `{"progress":{stage,done,total}}`.
  Final line: `{"ok":true,"pdf":{...},"skippedFiles":[...]}` on success, `{"error":"<msg>"}`
  on failure (HTTP status is already 200 once streaming began — the final line is the
  verdict). The temp-copy `finally` deletion is unaffected (single invocation).
- `runtime = "nodejs"`, `maxDuration = 300` unchanged. No logging of personal fields —
  unchanged hard rule.

### Client (PdfExportDialog + ReportWizard)
- `handlePdfExport` reads the response: if `Content-Type` is JSON → legacy error path
  (400/500 before stream). Otherwise `res.body.getReader()` + `TextDecoder`, split on
  newlines, parse each line; `progress` lines update a transient `pdfProgress` state
  passed into the dialog; the final line resolves success/failure exactly as today.
- The dialog's busy footer shows the Hebrew stage label + counter instead of static
  `מנפיק…` (which remains the fallback before the first event).
- `pdfProgress` is transient client state — NOT in `WizardProgressState` /
  `serializeProgress` (unchanged hard rule).

### Approved stage strings (added to the feature's approved-strings list)
| stage | string |
|---|---|
| prepare | `מכין את הדוח…` |
| export | `מייצא וחותם…` |
| sources | `מצרף מסמכי מקור… (X מתוך Y)` |
| receipts | `מצרף קבלות… (X מתוך Y)` |
| move | `מסדר קבצים בדרייב… (X מתוך Y)` |
| upload | `שומר את הקובץ…` |

(X/Y rendered from `done`/`total`; the format is `(<done> מתוך <total>)`.)

## Error handling
- Stream ends without a final `ok`/`error` line (network cut, crashed invocation) →
  client shows the existing generic failure string `הנפקת ה-PDF נכשלה` + a generic
  message; no retry logic (out of scope).
- Per-file skip semantics (`skippedFiles`) unchanged.

## Testing / verification
- No test runner in repo: `npm run typecheck` + `npm run lint` + `npm run build` gates.
- User E2E (one pass): (a) PDF page 1 is a single fitted page matching the manual Sheets
  export; (b) signature position + side (RTL question) — report offset direction if any;
  (c) progress advances through the stages with live counters on a large period;
  (d) failure mid-run still shows the failure string and the temp copy is still deleted.

## Out of scope
- Parallelizing the Drive downloads/moves (separate future step; progress makes the wait
  transparent, parallelism would shorten it).
- Retry/resume of a failed export.
