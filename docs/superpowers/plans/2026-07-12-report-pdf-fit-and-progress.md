# Report PDF: Fit-to-Page Fix + Staged Export Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the exported report PDF a single fitted page (matching the Sheets print default the user verified) and stream stage-by-stage progress with counters into the export dialog.

**Architecture:** Two sequential changes on `feat/report-pdf`. (1) `exportSheetTabPdf` switches to `scale=4` (fit-to-page) and the signature geometry in `lib/report/pdf.ts` gains a computed fit factor + conditional RTL mirroring. (2) `buildReportPdfBundle` gains an optional `onProgress` callback (3rd parameter); the route becomes a streaming NDJSON response whose final line is the verdict; the wizard reads the stream and the dialog shows the stage + counter.

**Tech Stack:** Existing only — Next.js 16 App Router (Node runtime), TS strict, googleapis via `lib/google.ts`, pdf-lib, shadcn primitives. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-12-report-pdf-fit-and-progress-design.md` (user-approved 2026-07-12). Root cause user-verified: Sheets print default = התאמה לגודל הדף (`scale=4`); switching the dialog to 100% reproduces our broken 3-page output.

## Global Constraints

- Branch: continue on `feat/report-pdf` (already 9 commits over dev). Conventional commits; one logical change per commit.
- No test runner in repo: every task's verify cycle = `npm run typecheck` + `npx eslint <changed files>`; `npm run build` at the final task. Accepted pre-existing lint error: `UploadZone.tsx:138` only.
- **Privacy (unchanged hard rules):** personal values + signature never in `console.*`, never in progress events, never persisted; `lib/report/progress.ts` (`serializeProgress`) stays diff-free; temp Sheet copy still deleted in `finally`; progress events carry **stage + numbers only** — no file names, no personal values.
- **Approved strings** — the feature's existing list PLUS exactly these six stage strings (anything else → STOP-and-ASK): `מכין את הדוח…`, `מייצא וחותם…`, `מצרף מסמכי מקור…`, `מצרף קבלות…`, `מסדר קבצים בדרייב…`, `שומר את הקובץ…`; counter format appended to the three loop stages: `(<done> מתוך <total>)`.
- shadcn primitives only; never `rounded-*`; no `alert()`. TS strict; no `any` without a comment.
- Do NOT run `npm run dev` or visually verify — hand off to the user.
- All Google API access stays in `lib/google.ts`.
- Subagents: context7 first before coding against an external API surface (Task 2: Next.js streaming route handlers). Task 1 and 3 touch only surfaces already established in this codebase — no context7 needed.

## File Structure

- `lib/google.ts` — modify `exportSheetTabPdf` (scale param) and `getSheetTabMetrics` (+`rightToLeft`). Task 1.
- `lib/report/pdf.ts` — modify stage-4 geometry (Task 1); add `PdfProgress` + `onProgress` 3rd param + emissions (Task 2).
- `app/api/report/pdf/route.ts` — streaming NDJSON rewrite. Task 2.
- `components/ReportWizard.tsx` — stream reader in `handlePdfExport`, `pdfProgress` state. Task 3.
- `components/PdfExportDialog.tsx` — `progress` prop + stage label line. Task 3.

---

### Task 1: Fit-to-page export + scaled/RTL signature geometry

**Files:**
- Modify: `lib/google.ts` (`exportSheetTabPdf` ~:975, `getSheetTabMetrics` ~:940)
- Modify: `lib/report/pdf.ts` (stage-4 block, ~:201-221)

**Interfaces:**
- Consumes: existing `getSheetTabMetrics`/`exportSheetTabPdf`; `grid`, `signatureRow`, `COL`, `A4_WIDTH_PT`/`A4_HEIGHT_PT`/`PAGE_MARGIN_PT` already in `pdf.ts` scope at the edit site.
- Produces: `getSheetTabMetrics` return type becomes `{ sheetId: number; rightToLeft: boolean; rowPx: number[]; colPx: number[] }` (Task 2+ callers unaffected — nothing else consumes it).

- [ ] **Step 1: `exportSheetTabPdf` → scale=4**

In `lib/google.ts`, in the URL template, replace `&size=A4&portrait=true&scale=1&` with `&size=A4&portrait=true&scale=4&` and update the function's comment block to:

```ts
// Exports one tab as a PDF via Sheets' export endpoint (not part of the
// Sheets/Drive API surface — no googleapis method covers it, hence the raw
// fetch). scale=4 = fit-to-page: matches the Sheets print-dialog default the
// user verified (התאמה לגודל הדף) — the report tab is designed to print as
// exactly one page. scale=1 (100%) breaks it across ~3 pages.
```

- [ ] **Step 2: `getSheetTabMetrics` returns `rightToLeft`**

Same API call — only the `fields` string and return change:

```ts
export async function getSheetTabMetrics(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
): Promise<{ sheetId: number; rightToLeft: boolean; rowPx: number[]; colPx: number[] }> {
  const sheets = sheetsClient(accessToken);
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      "sheets(properties(sheetId,title,rightToLeft),data(rowMetadata(pixelSize),columnMetadata(pixelSize)))",
  });
  const sheet = (res.data.sheets ?? []).find((s) => s.properties?.title === tabTitle);
  if (!sheet) throw new Error(`Sheet tab not found: ${tabTitle}`);
  const data = sheet.data?.[0];
  const rowPx = (data?.rowMetadata ?? []).map((m) => m.pixelSize ?? DEFAULT_ROW_PX);
  const colPx = (data?.columnMetadata ?? []).map((m) => m.pixelSize ?? DEFAULT_COL_PX);
  return {
    sheetId: sheet.properties!.sheetId!,
    rightToLeft: sheet.properties?.rightToLeft ?? false,
    rowPx,
    colPx,
  };
}
```

- [ ] **Step 3: rewrite the stage-4 geometry block in `lib/report/pdf.ts`**

Replace the block from `// Stage 4:` down to (and including) the four `boxXPt/boxYTopPt/boxWPt/boxHPt` consts with:

```ts
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

    // RTL sheets may export with column A on the RIGHT — mirror the x origin.
    // CALIBRATION NOTE (user evidence 2026-07-12): at scale=1 the UNMIRRORED x
    // looked correct, so the export may not mirror at all. If E2E shows the
    // signature on the wrong side, delete this one line (see design spec).
    if (metrics.rightToLeft) xPx = contentWpx - (xPx + wPx);

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
```

Stage 5 below (export, load, stamp with `boxXPt/boxYTopPt/boxWPt/boxHPt`) is untouched.

- [ ] **Step 4: verify**

Run: `npm run typecheck` → expect clean exit 0. Run: `npx eslint lib/google.ts lib/report/pdf.ts` → expect no output.

- [ ] **Step 5: commit**

```bash
git add lib/google.ts lib/report/pdf.ts
git commit -m "fix(report): export report tab fit-to-page; scale signature geometry, honor RTL"
```

---

### Task 2: `onProgress` callback + streaming NDJSON route

**Files:**
- Modify: `lib/report/pdf.ts` (add `PdfProgress`, 3rd param, emissions)
- Modify: `app/api/report/pdf/route.ts` (streaming rewrite)

**Interfaces:**
- Consumes: `buildReportPdfBundle(accessToken, args)` as committed; route structure as committed (guard, `todayDDMMYYYY`, `PdfBody`).
- Produces (Task 3 relies on these EXACTLY):
  - `export interface PdfProgress { stage: "prepare" | "export" | "sources" | "receipts" | "move" | "upload"; done?: number; total?: number; }` (exported from `lib/report/pdf.ts`)
  - `buildReportPdfBundle(accessToken: string, args: PdfExportArgs, onProgress?: (p: PdfProgress) => void)`
  - Wire protocol (`Content-Type: application/x-ndjson`, one JSON object per `\n`-terminated line): progress lines `{"progress":{"stage":"receipts","done":34,"total":118}}`; final line `{"ok":true,"pdf":{"id":"…","url":"…"},"skippedFiles":[…]}` or `{"error":"<message>"}`. Pre-stream failures (400 guard, malformed JSON body) return plain `application/json` `{ error }` as today.

- [ ] **Step 1: context7 — Next.js streaming route handler**

Query context7 for Next.js (App Router route handlers): confirm returning `new Response(readableStream, { headers })` from a POST handler streams incrementally on the Node runtime, and note any flushing caveat. Record findings in the task report. (WebSearch fallback if coverage is thin.)

- [ ] **Step 2: add `PdfProgress` + callback to `lib/report/pdf.ts`**

Below `PdfExportResult` add:

```ts
// Progress event for the streaming route: stage + loop counters ONLY —
// never file names, never personal values (privacy hard rule).
export interface PdfProgress {
  stage: "prepare" | "export" | "sources" | "receipts" | "move" | "upload";
  done?: number; // 1-based, present inside the three file loops
  total?: number;
}
```

Change the signature and add a safe emitter as the function's first line:

```ts
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
```

Emission points (7 edits, each one line, placed exactly):
1. Before the `copyDriveFileAsSheet` call (stage 2): `emit({ stage: "prepare" });`
2. Before the `exportSheetTabPdf` call (stage 5): `emit({ stage: "export" });`
3. Before the sources loop (stage 6): `emit({ stage: "sources", total: sourceFiles.length });`
4. Inside the sources loop, first line — convert `for (const f of sourceFiles)` to indexed form:
```ts
    for (let i = 0; i < sourceFiles.length; i++) {
      const f = sourceFiles[i];
      emit({ stage: "sources", done: i + 1, total: sourceFiles.length });
```
5. Before the receipts download loop (stage 7): `emit({ stage: "receipts", total: resolvedReceipts.length });` and the same indexed conversion inside (`done: i + 1, total: resolvedReceipts.length`).
6. Before the move loop (stage 8): `emit({ stage: "move", total: resolvedReceipts.length });` and the same indexed conversion inside.
7. Before `doc.save()` (stage 9): `emit({ stage: "upload" });`

- [ ] **Step 3: streaming route rewrite**

Replace the `POST` body of `app/api/report/pdf/route.ts` (imports gain `PdfProgress` type; `NextResponse` stays for the pre-stream JSON errors):

```ts
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
```

- [ ] **Step 4: verify**

Run: `npm run typecheck` → clean. Run: `npx eslint lib/report/pdf.ts app/api/report/pdf/route.ts` → clean.

- [ ] **Step 5: commit**

```bash
git add lib/report/pdf.ts app/api/report/pdf/route.ts
git commit -m "feat(report): stream stage progress from the PDF export route (NDJSON)"
```

---

### Task 3: Client — stream reader + dialog progress display

**Files:**
- Modify: `components/ReportWizard.tsx` (`handlePdfExport` ~:1026-1063, `pdfProgress` state near the other `pdf*` states ~:413-420, dialog render ~:2580)
- Modify: `components/PdfExportDialog.tsx` (`progress` prop, footer status line)

**Interfaces:**
- Consumes (from Task 2, exact): `PdfProgress` from `@/lib/report/pdf`; the NDJSON wire protocol (`Content-Type: application/x-ndjson`; lines `{"progress":PdfProgress}`; final `{"ok":true,"pdf":{id,url},"skippedFiles":string[]}` | `{"error":string}`; pre-stream failures are plain JSON).
- Produces: `PdfExportDialogProps` gains `progress: PdfProgress | null`.

- [ ] **Step 1: wizard state + imports**

In `components/ReportWizard.tsx`: extend the type import to `import type { PersonalDetails, PdfProgress } from "@/lib/report/pdf";` and add below `pdfError`:

```ts
  // Live stage of a running PDF export (transient, from the NDJSON stream).
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null);
```

- [ ] **Step 2: rewrite the response handling in `handlePdfExport`**

Replace everything from `const data = await res.json();` through `setPdfDialogOpen(false);` with:

```ts
      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        // Pre-stream failure (400 guard / early 500) — plain JSON path.
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let final:
        | { ok?: boolean; pdf?: { id: string; url: string }; skippedFiles?: string[]; error?: string }
        | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffered.indexOf("\n")) !== -1) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line) as {
            progress?: PdfProgress;
            ok?: boolean;
            pdf?: { id: string; url: string };
            skippedFiles?: string[];
            error?: string;
          };
          if (evt.progress) setPdfProgress(evt.progress);
          else final = evt;
        }
      }
      if (!final || final.error || !final.ok || !final.pdf) {
        // Stream ended without a success verdict (server error or cut stream).
        throw new Error(final?.error || `HTTP ${res.status}`);
      }
      setPdfResult({ url: final.pdf.url, skippedFiles: final.skippedFiles ?? [] });
      setPdfDialogOpen(false);
```

And extend the `finally` block to also reset progress:

```ts
    } finally {
      setPdfBusy(false);
      setPdfProgress(null);
    }
```

- [ ] **Step 3: pass progress into the dialog**

```tsx
                <PdfExportDialog
                  open={pdfDialogOpen}
                  onOpenChange={setPdfDialogOpen}
                  busy={pdfBusy}
                  progress={pdfProgress}
                  onSubmit={handlePdfExport}
                />
```

- [ ] **Step 4: dialog — `progress` prop + stage label**

In `components/PdfExportDialog.tsx`: add `import type { PdfProgress } from "@/lib/report/pdf";`, add `progress: PdfProgress | null;` to `PdfExportDialogProps`, thread it into `PdfExportForm` (same prop). Above the component add:

```ts
// Approved stage strings (design spec 2026-07-12). Counter format: (X מתוך Y).
function progressLabel(p: PdfProgress): string {
  const count =
    p.done !== undefined && p.total !== undefined ? ` (${p.done} מתוך ${p.total})` : "";
  switch (p.stage) {
    case "prepare":
      return "מכין את הדוח…";
    case "export":
      return "מייצא וחותם…";
    case "sources":
      return `מצרף מסמכי מקור…${count}`;
    case "receipts":
      return `מצרף קבלות…${count}`;
    case "move":
      return `מסדר קבצים בדרייב…${count}`;
    case "upload":
      return "שומר את הקובץ…";
  }
}
```

In `PdfExportForm`'s `DialogFooter`, add the status line as the first child (before the `ביטול` button); the submit button's `מנפיק…` busy label stays as the pre-first-event fallback:

```tsx
      <DialogFooter>
        {busy && progress ? (
          <p className="me-auto self-center text-sm text-muted-foreground">
            {progressLabel(progress)}
          </p>
        ) : null}
        ...existing ביטול + הנפק buttons unchanged...
      </DialogFooter>
```

- [ ] **Step 5: verify**

Run: `npm run typecheck` → clean. Run: `npm run lint` → only the pre-existing `UploadZone.tsx:138` error.

- [ ] **Step 6: commit**

```bash
git add components/ReportWizard.tsx components/PdfExportDialog.tsx
git commit -m "feat(report): live stage + counter in the PDF export dialog"
```

---

### Task 4: Full verification + E2E handoff (orchestrator — no subagent)

- [ ] `npm run typecheck` && `npm run lint` && `npm run build` — all pass (lint: only `UploadZone.tsx:138`).
- [ ] Greps on the diff vs the pre-Task-1 commit: no `console.*` added; no `rounded-*`/`alert(`; no Hebrew strings beyond the six approved stage strings + `מתוך`; `lib/report/progress.ts` diff-free; no dependency changes.
- [ ] Verify progress events carry no file names: grep the `emit(` call sites — only `stage`/`done`/`total` keys.
- [ ] **Hand off to user E2E** (do NOT run the app): (a) PDF page 1 = ONE fitted page matching the manual Sheets export; (b) signature position AND side — if offset, report direction/magnitude (calibration = `ALIGN_X_PT`/`ALIGN_Y_PT`; wrong side = delete the RTL mirror line); (c) on a large period the dialog advances through the stages with live counters; (d) a mid-run failure shows `הנפקת ה-PDF נכשלה` and the temp copy is still gone from Drive.
- [ ] After user confirmation: this branch's PR `feat/report-pdf` → `dev` proceeds per the original plan (user opens/merges PRs himself).

## Risks

- **Slack-axis alignment / print-extent mismatch** — fit factor is computed from the VALUE extent; formatting-only trailing rows/cols or centering would shift the stamp. One E2E calibration pass on `ALIGN_X_PT`/`ALIGN_Y_PT` closes it; fail mode cosmetic.
- **RTL mirror direction** — user evidence suggests the export may not mirror; the mirror ships flag-gated with an explicit E2E check either way (one-line change to flip).
- **Proxy buffering of the stream** — localhost and Vercel stream fine; a corporate proxy could buffer (progress would arrive late, correctness unaffected).
