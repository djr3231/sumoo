# Mark No-Receipt Expenses + Working-Sheet Drive Links + Cash-Lines View — Design

> Status: approved by the user (2026-07-13, brainstorming session).
> Branch: `feat/mark-unmatched-expenses` off `dev`. PR into `dev`. Never touch `main`.
> A stale manual prototype exists on branch `feat/mark-unmatcheds-expenses`
> (worktree `C:\Development\summo-feat-mark-unmatcheds-expenses`, 33 commits
> behind dev). It is an **intent reference only** — this feature is
> re-implemented fresh from this spec. The old branch is kept; the old worktree
> is deleted once the new branch stands. Its stray `pnpm-lock.yaml` /
> `pnpm-workspace.yaml` are NOT carried over (the project uses npm).

---

## 1. Context — why

In wizard step 4 (receipt matching) many expense lines legitimately have no
receipt. Three real-world reasons (user's words, condensed):

1. **No legal receipt exists** — insurance premiums, savings-plan deposits:
   money moved into the user's own fund; nothing was bought, so no תקבול.
2. **Community/social payments** — e.g. a Bit transfer to a colleague's gift
   pool.
3. **Forgot to take a receipt** — happens; a private person is not obligated
   to fight for one at a busy register.

Today there is no way to distinguish "consciously has no receipt" from "still
awaiting a receipt", so the user cannot see what actually remains to collect.
This feature adds a **manual** per-line marker (no auto-detection — that is a
possible future enhancement for insurances/standing orders), persisted with
the rest of the matching decisions, and reflected in the working sheet.

Two companion improvements ride along (same code area, separate commits):
the working-sheet receipt cell becomes a **live Drive link**, and the cash
step gains a **detail view of the cash lines** behind its summary numbers.

---

## 2. Feature A — "לא רלוונטי" marker on expense lines

### 2.1 Data model

- New optional field `noReceipt?: boolean` on `ExpenseItem`
  (`lib/report/reconcile.ts:28`), directly beside the existing
  `receipt?: string`. Same layer, same rationale: a user decision that lives
  on the line and travels with it.
- New constant in `lib/types.ts`: `NO_RECEIPT_LABEL = "לא רלוונטי"` — it is a
  domain value written into the working sheet, so it obeys the
  no-magic-strings rule (ARCHITECTURE.md §1.2).
- **Persistence is free.** `expenses` is already serialized wholesale into the
  progress autosave (`lib/report/progress.ts`) and already flows to the
  generate route inside `rollupInput.expenses`. No schema bump; old saved
  progress hydrates with the field absent (= unmarked).
- **Interaction rule:** attaching a receipt to a marked line **clears the
  mark** (the receipt wins; no dual state). The checkbox is disabled while a
  receipt is attached.
- Re-running document processing regenerates `lineId`s and therefore resets
  marks — same known behavior as receipt attachments; accepted.

### 2.2 Step-4 UI (matching table in `components/ReportWizard.tsx`)

The step-4 table already has a filter `Select` (הכל / עם קבלה / ללא קבלה) and
a summary counter line. Changes:

1. **New column** after `קבלה`, header **`לא רלוונטי`** (describes the
   meaning, not the condition — deliberate change from the prototype's
   "ללא קבלה"). Each row: a shadcn `Checkbox` bound to `e.noReceipt`, updated
   via the existing `patchExpense` mechanism. Disabled when `e.receipt` is
   set.
2. **Header select-all checkbox** — applies only to the rows **currently
   visible under the active filter** that have no receipt. (Fixes the
   prototype's semantic bug of comparing against all rows including
   receipted ones.) Checked state = every visible receipt-less row is
   marked; checking marks all of them, unchecking unmarks all of them.
   Rows with receipts are never affected. Disabled when no receipt-less
   rows are visible.
3. **Marked rows are visually muted** — `text-muted-foreground` on the whole
   `TableRow`.
4. **Filter grows 3 → 4 options:** `הכל` / `עם קבלה` / **`ממתין לקבלה`**
   (no receipt AND not marked — the working view) / **`לא רלוונטי`** (marked
   lines). The old `ללא קבלה` option is replaced by `ממתין לקבלה`.
5. **Counter line extended:**
   `X מתוך Y חיובים עם קבלה · Z לא רלוונטי · W ממתינים לקבלה`
   — the `Z לא רלוונטי` segment renders only when Z > 0.

### 2.3 Working-sheet reflection (step 6)

`lib/report/rollup.ts:159` — the receipt cell becomes three-state:

- receipt attached → live Drive link (Feature B below);
- `noReceipt` → `NO_RECEIPT_LABEL` (`לא רלוונטי`);
- otherwise → `-` (unchanged).

The **government report is unchanged** — marked lines were always included in
the sums; the marker is documentation, not inclusion/exclusion.

---

## 3. Feature B — working-sheet receipt cell as a live Drive link

The user's hand-made sheet (tab `חיובים דיירקט`, column G) shows Drive file
chips: icon + file name + hover preview. Target the same.

### 3.1 Data flow

- The URL already exists client-side: `receiptLinks`
  (`Record<fileName, driveUrl>`) is wizard state, persisted in progress.
- `RollupInput` gains optional `receiptLinks?: Record<string, string>`;
  `WorkingRow` gains `receiptUrl?: string`. The wizard passes `receiptLinks`
  inside the generate POST body (`rollupInput`). No new Google API reads.

### 3.2 Writing the cell (`lib/report/generate.ts`)

Working rows are currently written RAW (`generate.ts:117`). For receipt cells
that carry a URL:

- **Preferred: a real Sheets smart chip** via the Sheets API chip support
  (`chipRuns` / `richLinkProperties`). This is a recent API capability —
  **verify against current docs (context7, WebSearch fallback) during
  planning, never from memory.** If supported for writes, use it.
- **Fallback: `=HYPERLINK("<url>", "<fileName>")`** written with
  `USER_ENTERED` **for those cells only** (other columns keep their current
  write semantics). Drive links in Sheets still get a hover preview card.

Cells without a URL (no receipt / `לא רלוונטי` / `-`) are written as plain
text exactly as today.

---

## 4. Feature C — cash step (step 5) lines view

Below the existing per-month summary table (withdrawn / covered / residual),
a new `Section` titled **`שורות מזומן בדוח`**:

- Read-only table of `expenses` where `source === "cash"` and
  `isExpenseIncluded(lineId)`.
- Columns: `חודש`, `תאריך`, `תיאור`, `סכום`, `קבלה` — the receipt cell reuses
  the step-4 link pattern (`receiptLinks[e.receipt]`, `target="_blank"`),
  **without** the detach button.
- Sorted by month, then date.
- The Section is not rendered when there are no included cash lines.

---

## 5. Incidental changes (user-approved, from the prototype)

- `YEAR_OPTIONS` → `[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]`.
- Detach-receipt button label `בטל` → `בטל התאמה`.

---

## 6. Approved Hebrew strings (complete list — anything else → STOP-and-ASK)

| Purpose | String |
|---|---|
| Working-sheet cell value + constant `NO_RECEIPT_LABEL` | `לא רלוונטי` |
| Step-4 new column header | `לא רלוונטי` |
| Filter option (marked lines) | `לא רלוונטי` |
| Filter option (awaiting) | `ממתין לקבלה` |
| Counter segments | `לא רלוונטי`, `ממתינים לקבלה` |
| Cash-step section title | `שורות מזומן בדוח` |
| Detach button | `בטל התאמה` |

---

## 7. Execution notes

- Fresh worktree `C:\Development\sumoo-feat-mark-unmatched-expenses`, branch
  `feat/mark-unmatched-expenses` off `dev`, **real `npm install`** (junction
  breaks Turbopack).
- Model-split workflow: Fable plans; a cheaper model executes the plan.
- Small steps, one logical change per commit, conventional prefixes.
- Machine verification: `npm run typecheck`, `npm run lint`, `npm run build`,
  DESIGN-SYSTEM.md §10 greps. No `npm run dev`, no visual verification by the
  model.

### User visual-verification checklist (hand-off)

1. Step 4: mark a line `לא רלוונטי` → row mutes, counter updates; attach a
   receipt to a marked line → mark clears; checkbox disabled while attached.
2. Filter: `ממתין לקבלה` shows only unmarked+unreceipted lines; `לא רלוונטי`
   shows only marked ones; select-all marks exactly the visible receipt-less
   rows.
3. Reload mid-wizard → marks survive (progress autosave).
4. Step 5: cash lines table appears with working links; hidden when no cash
   lines.
5. Step 6 output: working-sheet receipt column shows live Drive links
   (chip or hyperlink) for receipted lines, `לא רלוונטי` for marked, `-`
   otherwise; government report unchanged.

---

## 8. Out of scope

- Auto-detection of no-receipt categories (insurance, standing orders) —
  possible future phase.
- Any change to the government report layout or sums.
- Matching-algorithm changes.
- State-management refactor (planned separately, post-MVP).
