# Pharmacy Food-Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default retail-pharmacy (סופר-פארם / ניו-פארם / גוד פארם) expense lines to `"כלכלה (מזון)"` instead of `"הוצאות רפואיות חריגות"` in the report classification.

**Architecture:** Add a maintained pharmacy-chain constant + a pure matcher (`isPharmacyStore`) to `lib/types.ts`, then apply a deterministic override in `lib/report/process.ts` immediately after `classifyExpenses` — any expense line whose `description` matches a chain is forced to `GOV_EXPENSE_CATEGORY.Food`, overriding the LLM. The classify prompt is unchanged.

**Tech Stack:** TypeScript (strict), Next.js server-side report pipeline. No test runner in repo.

**Spec:** `docs/superpowers/specs/2026-07-06-pharmacy-food-default-design.md`

## Global Constraints

- Work in an isolated worktree `C:/Development/sumoo-pharmacy` on branch `fix/pharmacy-food-default` off `dev`. Do NOT touch the main dir's `:3000` dev server or its `.next`.
- Real `npm install` in the worktree (NOT a junction/symlink) so `npm run build` works with Turbopack.
- No test runner exists. Verification per task = `npm run typecheck` (PASS) + `npm run lint` (zero NEW errors; the ONLY accepted pre-existing lint error is `components/UploadZone.tsx:135` react-hooks/set-state-in-effect). `npm run build` once before the final commit. Behavior verified by the USER on `:3000` after merge — do NOT run `next dev`/screenshots.
- Deterministic override ONLY — do NOT change the classify prompt (`lib/ai.ts:597`) or the scanner prompt (`lib/ai.ts:183`).
- Target category is exactly `GOV_EXPENSE_CATEGORY.Food` (`"כלכלה (מזון)"`), imported from `lib/types.ts`. Never inline the Hebrew literal.
- No new Hebrew UI strings. `PHARMACY_CHAINS` entries are literal match strings (allowed).
- No extra Google/LLM calls (quota-neutral). Domain values in `lib/types.ts`. TypeScript strict, no `any`.
- Conventional Commits; end each message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git reset`/force-push/rewrite history.

## File Structure

- **Modify:** `lib/types.ts` — add `PHARMACY_CHAINS`, `normalizeStoreName`, `isPharmacyStore` (domain rule, single source of truth).
- **Modify:** `lib/report/process.ts` — apply the override in the expense-mapping step (`:160-163`); add the `isPharmacyStore` import.
- **Include (already written, commit on this branch):** the spec and this plan under `docs/superpowers/`.

---

### Task 1: Create the isolated worktree

**Files:** none modified (environment setup).

- [ ] **Step 1: Create worktree + branch off dev**

Run from `C:\Development\sumoo`:
```bash
git worktree add C:/Development/sumoo-pharmacy -b fix/pharmacy-food-default dev
```
Expected: `Preparing worktree ... HEAD is now at <sha> ...` (dev's current tip).

- [ ] **Step 2: Real npm install in the worktree**

Run from `C:\Development\sumoo-pharmacy`:
```bash
npm install
```
Expected: completes with no errors; a real `node_modules` directory (NOT a junction).

- [ ] **Step 3: Baseline typecheck**

Run from `C:\Development\sumoo-pharmacy`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

---

### Task 2: Add pharmacy constant + matcher to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (append after the `GOV_EXPENSE_CATEGORIES` export, currently ending at line 128)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PHARMACY_CHAINS: readonly string[]` — normalized chain tokens.
  - `normalizeStoreName(s: string): string`.
  - `isPharmacyStore(description: string): boolean`.

- [ ] **Step 1: Add the constant and helpers**

Open `C:/Development/sumoo-pharmacy/lib/types.ts`. Immediately AFTER the line
`export const GOV_EXPENSE_CATEGORIES: GovExpenseCategory[] = Object.values(GOV_EXPENSE_CATEGORY);`
(currently line 128), add:

```ts

// ----------------------------------------------------------------------------
// Retail-pharmacy default: drugstore chains whose spend defaults to
// food/household ("כלכלה (מזון)"), NOT medical — toiletries/cosmetics dominate.
// Health-fund pharmacies (מכבי פארם, בית מרקחת כללית) are deliberately excluded
// (matched on FULL chain names, not the bare word "פארם"), so they stay
// "הוצאות רפואיות חריגות". Tokens are pre-normalized (see normalizeStoreName).
// ----------------------------------------------------------------------------
export const PHARMACY_CHAINS = [
  "סופרפארם",
  "ניופארם",
  "גודפארם",
  "superpharm",
  "newpharm",
  "goodpharm",
] as const;

// Normalize a store name for tolerant matching: lowercase, strip spaces and
// hyphens (ASCII "-" and Hebrew maqaf "־").
export function normalizeStoreName(s: string): string {
  return s.toLowerCase().replace(/[\s\-־]/g, "");
}

// True when the description names one of PHARMACY_CHAINS (normalized substring),
// e.g. `סופר-פארם ר"ג`, `SUPER-PHARM #123`, `ניו פארם`.
export function isPharmacyStore(description: string): boolean {
  const n = normalizeStoreName(description);
  return PHARMACY_CHAINS.some((chain) => n.includes(chain));
}
```

- [ ] **Step 2: Typecheck**

Run from `C:\Development\sumoo-pharmacy`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

- [ ] **Step 3: Manual sanity check of the matcher (no test runner exists)**

Run from `C:\Development\sumoo-pharmacy` (uses tsx via npx; if unavailable, skip and rely on typecheck + reasoning, and note it in the report):
```bash
npx --yes tsx -e "import {isPharmacyStore} from './lib/types.ts'; const T=['סופר פארם','סופר-פארם ר\"ג','SUPER-PHARM 123','ניו פארם','גוד פארם']; const F=['מכבי פארם','בית מרקחת כללית','שופרסל','רמי לוי']; console.log('true→', T.map(isPharmacyStore)); console.log('false→', F.map(isPharmacyStore));"
```
Expected: first array all `true`, second array all `false`. If `tsx` cannot run in this environment, state that in the report and rely on typecheck; do NOT add a test file or a runtime dep.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts docs/superpowers/specs/2026-07-06-pharmacy-food-default-design.md docs/superpowers/plans/2026-07-06-pharmacy-food-default.md
git commit -m "feat(report): add pharmacy-chain constant and matcher

Deterministic list of retail drugstore chains (Super-Pharm, New Pharm,
Good Pharm) plus a normalized-substring matcher, to default their spend
to food/household instead of exceptional-medical.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Apply the override in `lib/report/process.ts`

**Files:**
- Modify: `lib/report/process.ts` — the import block (top) and the expense-mapping step at `:160-163`.

**Interfaces:**
- Consumes: `isPharmacyStore` and `GOV_EXPENSE_CATEGORY` from `lib/types.ts` (Task 2 + existing).
- Produces: report expenses where pharmacy lines are categorized `Food`.

- [ ] **Step 1: Add a value import for `GOV_EXPENSE_CATEGORY` and `isPharmacyStore`**

`process.ts` currently imports from `@/lib/types` ONLY as a type-only import
(line 21: `import type { BankTxn, GovExpenseCategory, ReportPeriod } from "@/lib/types";`).
Both `GOV_EXPENSE_CATEGORY` (a value/const) and `isPharmacyStore` (a function) are
runtime VALUES, so they cannot go on the `import type` line. Leave line 21
unchanged and add a NEW import line immediately after it:

```ts
import { GOV_EXPENSE_CATEGORY, isPharmacyStore } from "@/lib/types";
```

Do not merge these into the `import type { ... }` line — that would be a type
error. Keep `GovExpenseCategory` (the type) on the existing `import type` line.

- [ ] **Step 2: Apply the override in the expense map**

Replace the expense-mapping block currently at `process.ts:160-163`:

```ts
  const expenses: CategorizedExpense[] = recon.expenseItems.map((e, i) => ({
    ...e,
    category: categories[i],
  }));
```

with:

```ts
  const expenses: CategorizedExpense[] = recon.expenseItems.map((e, i) => ({
    ...e,
    // Retail pharmacies default to food/household, not exceptional-medical.
    // Deterministic override wins over the LLM classification (the LLM sees
    // only the store name, so this is at least as accurate and predictable).
    category: isPharmacyStore(e.description)
      ? GOV_EXPENSE_CATEGORY.Food
      : categories[i],
  }));
```

- [ ] **Step 3: Typecheck**

Run from `C:\Development\sumoo-pharmacy`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

- [ ] **Step 4: Lint**

Run from `C:\Development\sumoo-pharmacy`:
```bash
npm run lint
```
Expected: zero NEW errors. Only `components/UploadZone.tsx:135` is accepted; neither `lib/types.ts` nor `lib/report/process.ts` should appear.

- [ ] **Step 5: Build (once, in the worktree)**

Run from `C:\Development\sumoo-pharmacy`:
```bash
npm run build
```
Expected: `next build` completes successfully. Do NOT run this in the main dir.

- [ ] **Step 6: Commit**

```bash
git add lib/report/process.ts
git commit -m "feat(report): default pharmacy spend to food/household

Override classifyExpenses for lines whose store matches a retail pharmacy
chain, sending them to GOV_EXPENSE_CATEGORY.Food instead of exceptional
medical. Health-fund pharmacies and clinics are unaffected.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Integration and manual verification (orchestrator)

**Files:** none (git integration).

- [ ] **Step 1: Fast-forward merge into `dev` locally**

From `C:\Development\sumoo` (main dir, on `dev`):
```bash
git merge --ff-only fix/pharmacy-food-default
```
Expected: fast-forward; `:3000` hot-reloads. Do NOT push to `origin/dev` (batch pushes at the very end).

- [ ] **Step 2: Hand off to the user for verification**

Ask the user to confirm on `:3000`: process (or re-process) a report containing a
סופר-פארם line and confirm it lands in "כלכלה (מזון)"; confirm a clinic / מכבי-פארם
line still shows "הוצאות רפואיות חריגות". Wait for confirmation. Do NOT delete the
`fix/pharmacy-food-default` branch.

---

## Self-Review

- **Spec coverage:** constant + matcher (`lib/types.ts`) → Task 2; deterministic override after `classifyExpenses` (`process.ts`) → Task 3; target `GOV_EXPENSE_CATEGORY.Food`, health-fund excluded, prompt unchanged, quota-neutral → covered by Tasks 2-3 code + Global Constraints; scanner line 183 and "Be" out of scope → not touched. All covered.
- **Placeholder scan:** none — every code step shows full code; every command shows expected output. The one conditional ("if tsx unavailable") has an explicit fallback (rely on typecheck, no new dep) rather than a vague TODO.
- **Type consistency:** `PHARMACY_CHAINS` / `normalizeStoreName(s: string): string` / `isPharmacyStore(description: string): boolean` defined in Task 2 and used with the same names/signatures in Task 3; `GOV_EXPENSE_CATEGORY.Food` matches `lib/types.ts:106`.
