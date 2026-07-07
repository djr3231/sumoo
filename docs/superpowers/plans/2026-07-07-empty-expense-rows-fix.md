# Empty Expense Rows Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop "+ הוסף שורה" from silently accumulating empty expense rows, and clean the 27 existing garbage rows from the saved 5-6/2026 progress.

**Architecture:** Root cause (evidence-verified in the live app): `addExpense` appends an empty draft row (`month=m1, amount=0, description=""`), but the table's default sort (`month asc`, stable) places it in the MIDDLE of the table — far from the button below the table — so the click has no visible feedback and users click repeatedly (27 distinct-UUID rows accumulated; the step-4 counter "118 מתוך 194" counts them, which read as a receipts sync problem — actual receipt state was verified consistent: 118 attachments = 118 links = 118 rows-with-receipt, 0 orphans). Fix in `components/ReportWizard.tsx` only: (1) a shared `isDraftExpense` predicate; (2) `compareExpense` sorts draft rows LAST regardless of sort key/direction, so a new draft appears directly above the button in both the classify (step 3) and receipts (step 4) tables; (3) `addExpense` refuses to add a second empty draft. Data cleanup of the existing saved progress is an orchestrator task via the user's authenticated browser session (subagents have no auth cookie).

**Tech Stack:** Next.js App Router client component, React state, existing progress GET/POST API.

## Global Constraints

- Work in an isolated worktree `C:/Development/sumoo-empty-rows` on branch `fix/empty-expense-rows` off `dev`. Do NOT touch the main dir's `:3000` dev server or its `.next`.
- Real `npm install` in the worktree (NOT a junction/symlink — Turbopack rejects it).
- Read `CLAUDE.md`, and consult `ARCHITECTURE.md` / `DESIGN-SYSTEM.md` if touching anything beyond the specified lines. TS strict, no `any`. Design tokens only; no new colors/radii/shadows.
- **No new Hebrew UI strings** — this fix is behavior-only (sort rule + guard). No toast/label.
- No test runner exists. Verification per task = `npm run typecheck` (PASS) + `npm run lint` (zero NEW errors; ONLY accepted pre-existing error: the `react-hooks/set-state-in-effect` in `components/UploadZone.tsx` folder-restore effect ~line 138) + `npm run build` once (worktree only). Visual verification by the USER on :3000 after merge.
- Windows: the Bash tool resets cwd after every command — prefix worktree commands with `cd /c/Development/sumoo-empty-rows &&`.
- Conventional Commits ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git reset`/force-push.
- Do NOT change the persistence schema, the matching logic, or the footer/gates.

## File Structure

- **Modify:** `components/ReportWizard.tsx` — module-scope `isDraftExpense`; `compareExpense` (~line 855); `addExpense` (~line 766).
- **Include (commit on this branch):** this plan under `docs/superpowers/plans/`.

---

### Task 1: Create the isolated worktree (orchestrator)

- [ ] **Step 1:** From `C:\Development\sumoo`: `git worktree add C:/Development/sumoo-empty-rows -b fix/empty-expense-rows dev` → expect `HEAD is now at f16f1fb ...` (or current dev tip).
- [ ] **Step 2:** `cd /c/Development/sumoo-empty-rows && npm install` → completes clean.
- [ ] **Step 3:** `cd /c/Development/sumoo-empty-rows && npm run typecheck` → PASS (exit 0).
- [ ] **Step 4:** Copy this plan into the worktree (`docs/superpowers/plans/2026-07-07-empty-expense-rows-fix.md`).

---

### Task 2: Draft predicate + drafts-sort-last + add guard

**Files:**
- Modify: `components/ReportWizard.tsx`

**Interfaces:**
- Produces: module-scope `function isDraftExpense(e: CategorizedExpense): boolean` — true when `e.amount === 0 && e.description.trim() === ""`. Used by `compareExpense` and `addExpense`.

- [ ] **Step 1: Add the predicate at module scope**

In `C:/Development/sumoo-empty-rows/components/ReportWizard.tsx`, immediately AFTER the `fmtDate` helper (the function ending near line 70, `function fmtDate(...) {...}`), add:

```tsx
// A manual "+ הוסף שורה" row the user has not filled in yet. Draft rows sort
// to the END of the expense tables (directly above the add button) so adding
// one gives immediate visible feedback, and addExpense refuses to stack a
// second untouched draft.
function isDraftExpense(e: { amount: number; description: string }): boolean {
  return e.amount === 0 && e.description.trim() === "";
}
```

- [ ] **Step 2: Sort drafts last in `compareExpense`**

Find `compareExpense` (currently ~line 855):

```tsx
  const compareExpense = (
    a: { e: CategorizedExpense },
    b: { e: CategorizedExpense },
  ) => {
    const k = expenseSort.key;
    const cmp =
      k === "amount" || k === "month"
        ? a.e[k] - b.e[k]
        : String(a.e[k] ?? "").localeCompare(String(b.e[k] ?? ""), "he");
    return expenseSort.dir === "asc" ? cmp : -cmp;
  };
```

Replace with (draft rule FIRST, and NOT subject to `dir` negation — drafts stay last in both asc and desc):

```tsx
  const compareExpense = (
    a: { e: CategorizedExpense },
    b: { e: CategorizedExpense },
  ) => {
    // Draft rows always sort last, regardless of key/direction, so a freshly
    // added row lands next to the "+ הוסף שורה" button instead of vanishing
    // into the middle of the month-sorted table.
    const aDraft = isDraftExpense(a.e);
    const bDraft = isDraftExpense(b.e);
    if (aDraft !== bDraft) return aDraft ? 1 : -1;
    const k = expenseSort.key;
    const cmp =
      k === "amount" || k === "month"
        ? a.e[k] - b.e[k]
        : String(a.e[k] ?? "").localeCompare(String(b.e[k] ?? ""), "he");
    return expenseSort.dir === "asc" ? cmp : -cmp;
  };
```

- [ ] **Step 3: Guard `addExpense` against stacking empty drafts**

Find `addExpense` (currently ~line 766):

```tsx
  function addExpense() {
    setExpenses((prev) => [
      ...prev,
      {
        lineId: crypto.randomUUID(),
        month: pair?.m1 ?? 1,
        amount: 0,
        description: "",
        category: GOV_EXPENSE_CATEGORY.Miscellaneous,
        source: "direct",
      },
    ]);
  }
```

Replace with:

```tsx
  function addExpense() {
    setExpenses((prev) => {
      // One untouched draft at a time: repeated clicks (e.g. when the user
      // didn't notice the row appear) must not stack empty rows.
      if (prev.some(isDraftExpense)) return prev;
      return [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          month: pair?.m1 ?? 1,
          amount: 0,
          description: "",
          category: GOV_EXPENSE_CATEGORY.Miscellaneous,
          source: "direct",
        },
      ];
    });
  }
```

- [ ] **Step 4:** `cd /c/Development/sumoo-empty-rows && npm run typecheck` → PASS (exit 0).
- [ ] **Step 5:** `cd /c/Development/sumoo-empty-rows && npm run lint` → zero NEW errors (only the accepted `UploadZone.tsx` one). Quote output.
- [ ] **Step 6:** `cd /c/Development/sumoo-empty-rows && npm run build` → succeeds (exit 0).
- [ ] **Step 7: Commit**

```bash
git add components/ReportWizard.tsx docs/superpowers/plans/2026-07-07-empty-expense-rows-fix.md
git commit -m "fix(report): keep manual draft rows visible and unique

Draft expense rows (amount 0, empty description) now sort last in the
expense tables so '+ הוסף שורה' gives immediate feedback next to the
button, and addExpense refuses to stack a second untouched draft.
Repeated no-feedback clicks had accumulated 27 empty rows.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Review + integration (orchestrator)

- [ ] **Step 1:** Generate review package (`scripts/review-package <dev-tip> <head>`), dispatch task reviewer (sonnet) with the brief + report + diff; fix loop if needed.
- [ ] **Step 2:** From `C:\Development\sumoo`: remove the untracked plan copy (`rm docs/superpowers/plans/2026-07-07-empty-expense-rows-fix.md`), then `git merge --ff-only fix/empty-expense-rows`. :3000 hot-reloads.

---

### Task 4: Clean the 27 saved empty rows (orchestrator, via the user's authenticated browser — subagents have no auth)

- [ ] **Step 1:** Re-verify via GET `/api/report/progress?period=5-6_2026` that the empty rows are still exactly the draft-shaped ones (amount 0, empty description) and that none is referenced by `attachments`/`receiptLinks`.
- [ ] **Step 2:** **Ask the user for explicit approval** (mutates saved data), then POST back the progress with: `expenses` minus draft rows, and `expenseIncluded` minus the removed lineIds. All other fields byte-identical. schemaVersion stays 1.
- [ ] **Step 3:** Confirm in the UI (reload wizard → resume) that the table shows 167 rows and the counter reads "118 מתוך 167".
- [ ] **Step 4:** Production: after the fix deploys (PR dev→main), repeat Steps 1-3 against the production URL in the user's browser — with approval.

---

## Self-Review

- **Coverage:** feedback fix (sort-last) → Task 2 Step 2 (applies to both step-3 and step-4 tables since `compareExpense` is shared); duplicate prevention → Task 2 Step 3; cleanup local+prod → Task 4; no schema/matching/UI-string changes → constraints. Covered.
- **Placeholders:** none — full code shown for both edits; commands with expected results.
- **Type consistency:** `isDraftExpense` takes `{ amount: number; description: string }` (structural — `CategorizedExpense` satisfies it); used with `prev.some(isDraftExpense)` (element type `CategorizedExpense`) and `isDraftExpense(a.e)`. Consistent.
