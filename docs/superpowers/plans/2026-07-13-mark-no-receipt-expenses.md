# Mark No-Receipt Expenses + Working-Sheet Drive Links + Cash-Lines View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user mark expense lines as "לא רלוונטי" (legitimately receipt-less), reflect that plus live Drive-file links in the working sheet, and show the cash lines behind the cash-step summary.

**Architecture:** One optional field (`noReceipt?: boolean`) on `ExpenseItem` carries the decision — persistence and server flow are free because `expenses` is already serialized wholesale into progress autosave and into the generate route's `rollupInput`. `rollup.ts` turns it into the working-sheet cell text; a new `lib/google.ts` helper writes Drive smart chips over the receipt cells (HYPERLINK-formula fallback). All UI changes live in `components/ReportWizard.tsx`.

**Tech Stack:** Next.js App Router (Node runtime), TS strict, googleapis ^171 (Sheets v4), shadcn primitives already installed. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-13-mark-no-receipt-expenses-design.md` (approved 2026-07-13; committed on this branch).

## Global Constraints

- Branch `feat/mark-unmatched-expenses` off `dev`, worktree `C:\Development\sumoo-feat-mark-unmatched-expenses` — **already created; the spec is committed on it.** All work happens in that worktree. Never touch `main` or `dev`.
- **This repo has no automated tests** (personal project, by decision — see README "נקודות פתוחות"). Do NOT introduce a test framework. Verification per task = `npm run typecheck` (+ `npm run lint` for UI tasks); final task adds `npm run build` + DESIGN-SYSTEM greps + user E2E hand-off.
- Do NOT run `npm run dev` or attempt visual verification — hand off to the user.
- Conventional commits; one logical change per commit; typecheck passes before every commit.
- **context7 first** before coding against googleapis (Sheets/Drive); for REST-level semantics context7 covers only the client README (verified limitation) — the chip request shape below was verified 2026-07-13 against https://developers.google.com/workspace/sheets/api/guides/chips.
- All Google API access via `lib/google.ts` only.
- shadcn primitives only; no `rounded-*`; no `alert()`; no raw colors — theme tokens only. TS strict; no `any` without a comment.
- **Approved Hebrew strings (anything else → STOP-and-ASK):** `לא רלוונטי` (cell value / column header / filter option / aria-label), `ממתין לקבלה` (filter option), `ממתינים לקבלה` (counter), `שורות מזומן בדוח` (section title), `בטל התאמה` (button). Existing strings reused verbatim.
- Privacy: nothing in this feature touches personal details, the gov report layout, or `lib/report/pdf.ts`.

## Verified ground truth (2026-07-13, dev @ 1c2feef)

- `ExpenseItem.receipt?: string` — `lib/report/reconcile.ts:28`.
- `patchExpense(lineId, patch)` — `components/ReportWizard.tsx:592`.
- Auto-match apply writes `receipt` — `ReportWizard.tsx:672-678`; manual attach — `:799-827` (`attachReceipt`); detach — `:836-850`; `receiptLinks` values are `https://drive.google.com/file/d/<driveFileId>/view` (`:787`, `:820`, `:684`).
- Filter state `receiptMatchFilter: "all" | "matched" | "unmatched"` — `:391`; view `receiptView` — `:1191-1200`; filter `Select` — `:1933-1949`; counter line — `:1918-1926`; step-4 table header — `:1951-1984`; detach button `בטל` — `:2023`.
- `isExpenseIncluded` — `:1124`; cash summary rows `cashRows` — `:1247-1264`; step-5 (`step === 4`) block — `:2401-2460`; `Section`, `fmtDate`, `formatILS` all already used in the file.
- `YEAR_OPTIONS` — `:121`.
- Step-6 POST body `rollupInput` — `:1000-1009`; preview rollup `useMemo` — `:962-985`.
- Generate route types `rollupInput: Omit<RollupInput, "months" | "householdSize">` and spreads `...rollupInput` into `buildReportRollup` — `app/api/report/generate/route.ts:23,40-41` → **adding an optional field to `RollupInput` needs zero route changes.**
- `RollupInput` / `WorkingRow` / `workingRows` map — `lib/report/rollup.ts:25-49,142-160` (receipt cell: `:159`).
- Working sheet written RAW from `rollup.workingRows`, receipt = column index 6 (G), data starts row index 1 — `lib/report/generate.ts:113-117`; `rangeFor(tab,row,col)` helper — `generate.ts:82`; `WORKING_TAB` constant in that file.
- `lib/google.ts`: `sheetsClient` (:37-43), `listSheetTabs` (:826), `batchWriteCells(token, id, data, valueInputOption="RAW")` (:866).
- **Smart chips are writable** via `spreadsheets.batchUpdate` → `updateCells` with `userEnteredValue: {stringValue: "@"}` + `chipRuns: [{startIndex: 0, chip: {richLinkProperties: {uri}}}]`, `fields: "userEnteredValue,chipRuns"`. Write support is **Drive file links only** (exactly what `receiptLinks` holds). Writing a new `userEnteredValue` erases previous chipRuns (irrelevant here — we write once). Source: official chips guide (link above).

---

### Task 0: Worktree bootstrap (orchestrator itself — no subagent)

**Files:** none (environment only).

**Steps:**
- [ ] `cd C:\Development\sumoo-feat-mark-unmatched-expenses`
- [ ] `npm install` — **real install in the worktree** (junction/symlink to the main repo's node_modules breaks Turbopack — known project fact).
- [ ] Run `npm run typecheck` → PASS (baseline).
- [ ] Confirm `git log --oneline -3` shows the spec and plan commits (`docs: design spec…`, `docs: pin select-all…`, `docs: implementation plan…`). If the plan file is somehow uncommitted: `git add docs/superpowers/plans/2026-07-13-mark-no-receipt-expenses.md && git commit -m "docs: implementation plan — no-receipt marker, Drive-link chips, cash-lines view"`

### Task 1: Domain constant + data field

**Files:**
- Modify: `lib/types.ts` (insolvency-report constants section — search `GOV_EXPENSE_CATEGORY`)
- Modify: `lib/report/reconcile.ts:28`

**Interfaces:**
- Produces: `NO_RECEIPT_LABEL: "לא רלוונטי"` (exported const, `lib/types.ts`); `ExpenseItem.noReceipt?: boolean`.
- Consumed by: Tasks 2 (rollup), 5, 6 (wizard).

**Steps:**
- [ ] **Step 1:** In `lib/types.ts`, next to the other insolvency-report constants, add:

```ts
// Working-sheet receipt-column value for expense lines the user marked as
// legitimately having no receipt (insurance/savings deposits, social payments,
// forgotten receipt). A user decision, never auto-set.
export const NO_RECEIPT_LABEL = "לא רלוונטי";
```

- [ ] **Step 2:** In `lib/report/reconcile.ts`, directly under `receipt?: string;` (line 28), add:

```ts
  noReceipt?: boolean; // user marked: this line legitimately has no receipt ("לא רלוונטי")
```

- [ ] **Step 3:** Run `npm run typecheck` → PASS.
- [ ] **Step 4:** Commit:

```bash
git add lib/types.ts lib/report/reconcile.ts
git commit -m "feat(report): noReceipt field on expense lines + NO_RECEIPT_LABEL constant"
```

### Task 2: Rollup — three-state receipt cell + receipt URL

**Files:**
- Modify: `lib/report/rollup.ts:25-49` (interfaces), `:142-160` (workingRows map)

**Interfaces:**
- Consumes: `NO_RECEIPT_LABEL` from `@/lib/types`; `e.noReceipt` (Task 1).
- Produces: `RollupInput.receiptLinks?: Record<string, string>` (fileName → Drive URL); `WorkingRow.receiptUrl?: string`. Consumed by Tasks 3-5.

**Steps:**
- [ ] **Step 1:** Add `NO_RECEIPT_LABEL` to the existing `@/lib/types` import in `rollup.ts`.
- [ ] **Step 2:** In `RollupInput` (after `creditRoute`), add:

```ts
  // fileName → Drive URL for attached receipts (wizard's receiptLinks state).
  // Optional: absent = working-sheet receipt cells stay plain text.
  receiptLinks?: Record<string, string>;
```

- [ ] **Step 3:** In `WorkingRow`, replace the `receipt` line and add `receiptUrl`:

```ts
  receipt: string; // receipt fileName, NO_RECEIPT_LABEL, or "-"
  receiptUrl?: string; // Drive URL when the line has an attached receipt with a known link
```

- [ ] **Step 4:** In the `workingRows` map (line ~159), replace `receipt: e.receipt || "-",` with:

```ts
      receipt: e.receipt || (e.noReceipt ? NO_RECEIPT_LABEL : "-"),
      receiptUrl: e.receipt ? input.receiptLinks?.[e.receipt] : undefined,
```

- [ ] **Step 5:** Run `npm run typecheck` → PASS.
- [ ] **Step 6:** Commit:

```bash
git add lib/report/rollup.ts
git commit -m "feat(report): rollup receipt cell — no-receipt label and Drive URL passthrough"
```

### Task 3: `lib/google.ts` — smart-chip write helper

**Files:**
- Modify: `lib/google.ts` (add one function near `batchWriteCells`, :866)

**Interfaces:**
- Produces (consumed by Task 4):

```ts
export async function writeFileChips(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  cells: Array<{ row: number; col: number; uri: string }>, // zero-based grid coords
): Promise<void>;
```

**Steps:**
- [ ] **Step 1: context7 first** (googleapis): confirm `spreadsheets.batchUpdate` + `updateCells` usage in the Node client. The chip payload shape itself is already verified (see Verified ground truth) — do not re-derive it from memory.
- [ ] **Step 2:** Implement, following the file's existing style (client factory, one API call):

```ts
// Write Google-Drive smart chips ("file chips") into individual cells.
// Each cell becomes a single chip: userEnteredValue "@" is the placeholder
// the chipRun replaces (per the Sheets API chips guide). Write support is
// limited to Drive file URIs. One spreadsheets.batchUpdate call total.
export async function writeFileChips(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  cells: Array<{ row: number; col: number; uri: string }>,
): Promise<void> {
  if (cells.length === 0) return;
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: cells.map(({ row, col, uri }) => ({
        updateCells: {
          rows: [
            {
              values: [
                {
                  userEnteredValue: { stringValue: "@" },
                  chipRuns: [
                    { startIndex: 0, chip: { richLinkProperties: { uri } } },
                  ],
                },
              ],
            },
          ],
          fields: "userEnteredValue,chipRuns",
          start: { sheetId, rowIndex: row, columnIndex: col },
        },
      })),
    },
  });
}
```

- [ ] **Step 3:** Run `npm run typecheck`. If `sheets_v4` types in googleapis ^171 do not know `chipRuns` (types occasionally lag the API), keep the payload and cast the single cell-value object with an explanatory comment, e.g. `as unknown as sheets_v4.Schema$CellData // chipRuns shipped in the API; client types lag`. If any *other* error appears — STOP and report.
- [ ] **Step 4:** `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit:

```bash
git add lib/google.ts
git commit -m "feat(google): writeFileChips — Drive smart chips via updateCells/chipRuns"
```

### Task 4: `generate.ts` — chip the working-sheet receipt column (HYPERLINK fallback)

**Files:**
- Modify: `lib/report/generate.ts:103-119` (`generateWorkingSheet`)

**Interfaces:**
- Consumes: `WorkingRow.receiptUrl` (Task 2), `writeFileChips` + `listSheetTabs` (Task 3 / existing), `rangeFor` + `WORKING_TAB` + `batchWriteCells` (already in the file).
- Produces: no new exports — behavior only. Route unchanged (verified: `rollupInput` spread covers `receiptLinks`).

**Steps:**
- [ ] **Step 1:** Add `listSheetTabs` and `writeFileChips` to the existing `@/lib/google` import in `generate.ts`.
- [ ] **Step 2:** In `generateWorkingSheet`, after the existing `batchWriteCells(token, id, [{ range: `'${WORKING_TAB}'!A1`, values }])` call and before `return`, add:

```ts
  // Receipt cells (col G, zero-based 6; data starts at row index 1) that carry
  // a Drive URL become smart chips — same look as the user's hand-made sheet.
  // On any chip-write failure, degrade to a plain HYPERLINK formula: cosmetic
  // difference only, never fail the generation for it.
  const chipCells = rollup.workingRows
    .map((r, i) => ({ row: i + 1, col: 6, uri: r.receiptUrl, name: r.receipt }))
    .filter((c): c is { row: number; col: number; uri: string; name: string } =>
      Boolean(c.uri),
    );
  if (chipCells.length > 0) {
    const tabs = await listSheetTabs(token, id);
    const tab = tabs.find((t) => t.title === WORKING_TAB);
    if (tab) {
      try {
        await writeFileChips(token, id, tab.sheetId, chipCells);
      } catch {
        await batchWriteCells(
          token,
          id,
          chipCells.map((c) => ({
            range: rangeFor(WORKING_TAB, c.row, c.col),
            values: [
              [`=HYPERLINK("${c.uri}","${c.name.replace(/"/g, '""')}")`],
            ],
          })),
          "USER_ENTERED",
        );
      }
    }
  }
```

- [ ] **Step 3:** `npm run typecheck` → PASS.
- [ ] **Step 4:** Commit:

```bash
git add lib/report/generate.ts
git commit -m "feat(report): working-sheet receipt cells as Drive smart chips with HYPERLINK fallback"
```

### Task 5: Wizard state logic — send receiptLinks; receipt-attach clears the mark

**Files:**
- Modify: `components/ReportWizard.tsx` — `:962-985` (preview rollup), `:1000-1009` (generate POST body), `:672-678` (auto-match apply), `:799-812` (attachReceipt)

**Interfaces:**
- Consumes: `RollupInput.receiptLinks` (Task 2), `noReceipt` (Task 1).
- Produces: wizard behavior later tasks and the server rely on. No new exports.

**Steps:**
- [ ] **Step 1:** Preview rollup (`useMemo`, :962): add `receiptLinks,` to the `buildReportRollup({...})` argument object AND add `receiptLinks` to the `useMemo` dependency array. (Keeps "preview = exactly what the server writes" true.)
- [ ] **Step 2:** Generate POST body (:1000-1009): add `receiptLinks,` inside the `rollupInput: { ... }` object literal.
- [ ] **Step 3:** Auto-match apply (:672-678) — a matched receipt clears the mark:

```ts
    setExpenses((prev) =>
      prev.map((e) =>
        applied.has(e.lineId) && !e.receipt
          ? { ...e, receipt: applied.get(e.lineId)!.fileName, noReceipt: undefined }
          : e,
      ),
    );
```

- [ ] **Step 4:** `attachReceipt` (:800-802) — same rule on manual attach:

```ts
    const nextExpenses = expenses.map((e) =>
      e.lineId === lineId
        ? { ...e, receipt: r.fileName, noReceipt: undefined }
        : e,
    );
```

(`detachReceipt` stays as-is: detaching does NOT re-mark the line.)

- [ ] **Step 5:** `npm run typecheck` → PASS.
- [ ] **Step 6:** Commit:

```bash
git add components/ReportWizard.tsx
git commit -m "feat(report): receiptLinks into rollup input; attaching a receipt clears the no-receipt mark"
```

### Task 6: Wizard step-4 UI — column, select-all, muting, filter, counter

**Files:**
- Modify: `components/ReportWizard.tsx` — `:391` (filter state), `:1191-1200` (receiptView), `:1918-1926` (counter), `:1933-1949` (filter Select), `:1951-1984` (table header), `:1986-2030` (row render), `:2023` (button label)

**Interfaces:**
- Consumes: `noReceipt` (Task 1), `patchExpense` (:592), `receiptView`.
- Produces: nothing external — UI only.

**Steps:**
- [ ] **Step 1:** Filter state (:391) — widen the union and keep default `"all"`:

```ts
  const [receiptMatchFilter, setReceiptMatchFilter] = useState<
    "all" | "matched" | "awaiting" | "irrelevant"
  >("all");
```

Update the `onValueChange` cast (:1936-1938) to the same union, and replace the `SelectContent` items (:1944-1948) with:

```tsx
                      <SelectContent>
                        <SelectItem value="all">הכל</SelectItem>
                        <SelectItem value="matched">עם קבלה</SelectItem>
                        <SelectItem value="awaiting">ממתין לקבלה</SelectItem>
                        <SelectItem value="irrelevant">לא רלוונטי</SelectItem>
                      </SelectContent>
```

- [ ] **Step 2:** `receiptView` filter (:1193-1199):

```ts
    .filter(({ e }) =>
      receiptMatchFilter === "all"
        ? true
        : receiptMatchFilter === "matched"
          ? Boolean(e.receipt)
          : receiptMatchFilter === "awaiting"
            ? !e.receipt && !e.noReceipt
            : !e.receipt && Boolean(e.noReceipt),
    )
```

- [ ] **Step 3:** Directly after the `receiptView` declaration, add the select-all derivations + handler:

```ts
  // "לא רלוונטי" select-all: acts only on rows visible under the current
  // filter that have no receipt. Rows carrying a receipt are never touched.
  const markableVisible = receiptView.filter(({ e }) => !e.receipt);
  const allVisibleMarked =
    markableVisible.length > 0 &&
    markableVisible.every(({ e }) => e.noReceipt);
  function setMarkAllVisible(checked: boolean) {
    const ids = new Set(markableVisible.map(({ e }) => e.lineId));
    setExpenses((prev) =>
      prev.map((e) =>
        ids.has(e.lineId)
          ? { ...e, noReceipt: checked ? true : undefined }
          : e,
      ),
    );
  }
```

- [ ] **Step 4:** Counter line (:1918-1926) — extend to:

```tsx
                  {matchRan ? (
                    <span className="text-sm text-muted-foreground">
                      {expenses.filter((e) => e.receipt).length} מתוך{" "}
                      {expenses.length} חיובים עם קבלה
                      {expenses.filter((e) => !e.receipt && e.noReceipt).length > 0
                        ? ` · ${expenses.filter((e) => !e.receipt && e.noReceipt).length} לא רלוונטי`
                        : ""}
                      {` · ${expenses.filter((e) => !e.receipt && !e.noReceipt).length} ממתינים לקבלה`}
                      {unmatchedReceipts.length > 0
                        ? ` · ${unmatchedReceipts.length} קבלות ללא התאמה`
                        : ""}
                    </span>
                  ) : null}
```

- [ ] **Step 5:** Table header (after the `קבלה` `TableHead`, :1977-1982) — add:

```tsx
                          <TableHead>
                            <span className="flex items-center gap-1">
                              לא רלוונטי
                              <Checkbox
                                checked={allVisibleMarked}
                                disabled={markableVisible.length === 0}
                                onCheckedChange={(v) =>
                                  setMarkAllVisible(v === true)
                                }
                                aria-label="לא רלוונטי"
                              />
                            </span>
                          </TableHead>
```

- [ ] **Step 6:** Row render — mute marked rows and add the cell. Change the `TableRow` opener (:1987) to:

```tsx
                          <TableRow
                            key={e.lineId}
                            className={
                              e.noReceipt ? "text-muted-foreground" : undefined
                            }
                          >
```

and after the receipt `TableCell` (closing at :2029) add:

```tsx
                            <TableCell>
                              <Checkbox
                                checked={Boolean(e.noReceipt)}
                                disabled={Boolean(e.receipt)}
                                onCheckedChange={(v) =>
                                  patchExpense(e.lineId, {
                                    noReceipt: v === true ? true : undefined,
                                  })
                                }
                                aria-label="לא רלוונטי"
                              />
                            </TableCell>
```

- [ ] **Step 7:** Detach button label (:2023): `בטל` → `בטל התאמה`.
- [ ] **Step 8:** `npm run typecheck` && `npm run lint` (changed file clean; the pre-existing `UploadZone.tsx:138` lint error is accepted) → PASS.
- [ ] **Step 9:** Commit:

```bash
git add components/ReportWizard.tsx
git commit -m "feat(report): no-receipt marker UI — column, select-all, muting, filter, counter"
```

### Task 7: Cash step — included cash-lines table

**Files:**
- Modify: `components/ReportWizard.tsx` — derivation near `cashRows` (:1247), render inside the `step === 4` block after the gap-ack/`כל המשיכות מכוסות בקבלות ✓` block (:2437-2459), inside the surrounding `space-y-4` div.

**Interfaces:**
- Consumes: `expenses`, `isExpenseIncluded` (:1124), `receiptLinks`, `Section`/`fmtDate`/`formatILS`/`Link` (all already used in the file).

**Steps:**
- [ ] **Step 1:** Next to `cashRows` (:1247), add:

```ts
  // Cash lines actually included in the report — the detail behind cashRows'
  // "covered" numbers, listed in the cash step with their receipt links.
  const includedCashLines = expenses
    .filter((e) => e.source === "cash" && isExpenseIncluded(e.lineId))
    .sort(
      (a, b) =>
        a.month - b.month || (a.date ?? "").localeCompare(b.date ?? ""),
    );
```

- [ ] **Step 2:** In the step-5 render (`step === 4`), after the gap-ack/all-covered conditional block (:2437-2459) and still inside the `space-y-4` div, add:

```tsx
                {includedCashLines.length > 0 ? (
                  <Section title="שורות מזומן בדוח">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>חודש</TableHead>
                          <TableHead>תאריך</TableHead>
                          <TableHead>תיאור</TableHead>
                          <TableHead>סכום</TableHead>
                          <TableHead>קבלה</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {includedCashLines.map((e) => (
                          <TableRow key={e.lineId}>
                            <TableCell>{e.month}</TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {fmtDate(e.date)}
                            </TableCell>
                            <TableCell>{e.description}</TableCell>
                            <TableCell className="tabular-nums">
                              {formatILS(e.amount)}
                            </TableCell>
                            <TableCell>
                              {e.receipt && receiptLinks[e.receipt] ? (
                                <Link
                                  href={receiptLinks[e.receipt]}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={e.receipt}
                                  className="underline truncate min-w-0 max-w-70"
                                >
                                  {e.receipt}
                                </Link>
                              ) : e.receipt ? (
                                <span className="truncate min-w-0" title={e.receipt}>
                                  {e.receipt}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Section>
                ) : null}
```

- [ ] **Step 3:** `npm run typecheck` && `npm run lint` → PASS.
- [ ] **Step 4:** Commit:

```bash
git add components/ReportWizard.tsx
git commit -m "feat(report): cash step — table of included cash lines with receipt links"
```

### Task 8: Year options (approved incidental change)

**Files:**
- Modify: `components/ReportWizard.tsx:121`

**Steps:**
- [ ] **Step 1:** Replace the current line `const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];` with:

```ts
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
```

- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** Commit:

```bash
git add components/ReportWizard.tsx
git commit -m "feat(report): year picker — previous, current, next year"
```

### Task 9: Full verification + hand-off (orchestrator)

**Steps:**
- [ ] `npm run typecheck` && `npm run lint` && `npm run build` — all PASS.
- [ ] DESIGN-SYSTEM.md §10 greps on the diff vs dev — clean (no `rounded-*`, no raw colors, no default palette, no `alert(`).
- [ ] Grep the diff: `lib/report/progress.ts` unchanged; `app/api/report/generate/route.ts` unchanged; no `console.log` added; the only Hebrew strings added are the approved list.
- [ ] **Hand off to user for visual E2E** (do NOT run the app) — checklist from the spec:
  1. Step 4: mark a line → row mutes + counter updates; attach receipt to a marked line → mark clears; checkbox disabled while attached.
  2. Filter: `ממתין לקבלה` = unmarked+unreceipted only; `לא רלוונטי` = marked only; select-all affects exactly the visible receipt-less rows; disabled when none.
  3. Reload mid-wizard → marks survive (progress autosave).
  4. Step 5: cash-lines table with working links; hidden when no cash lines.
  5. Step 6: working-sheet receipt column = Drive chips (or hyperlink fallback) / `לא רלוונטי` / `-`; government report unchanged.
- [ ] After user confirmation: PR `feat/mark-unmatched-expenses` → `dev` via `mcp__github__*` (never `gh` CLI).
- [ ] Cleanup (user-approved): `git worktree remove --force C:/Development/summo-feat-mark-unmatcheds-expenses` (old prototype worktree; `--force` because it has uncommitted prototype changes + stray pnpm files). Keep branch `feat/mark-unmatcheds-expenses` (branches are never deleted).

## Risks

- **googleapis TS types may lag `chipRuns`** — mitigation in Task 3 Step 3 (single documented cast). The REST API itself supports it (verified against the official guide).
- **Chip write rejects non-Drive URIs** — ours are always `drive.google.com/file/d/…` links; the try/catch HYPERLINK fallback covers any surprise, cosmetic-only.
- **Re-processing documents resets marks** — known, accepted (same behavior as receipt attachments; lineIds are regenerated).
