# Design: Pharmacy purchases default to food/household (report batch #1)

**Date:** 2026-07-06
**Branch (implementation):** `fix/pharmacy-food-default` off `dev`
**Files:** `lib/types.ts`, `lib/report/process.ts`

## Goal

A receipt from a retail pharmacy/drugstore (סופר-פארם and similar) is currently
auto-classified in the report as **"הוצאות רפואיות חריגות"** (exceptional
medical). Most such spend is toiletries/cosmetics/household, not medical. Make
the **default** category for these stores **`GOV_EXPENSE_CATEGORY.Food`**
(`"כלכלה (מזון)"`). Genuine medical items are re-categorized manually by the
user. Applies from now on (past reports are the user's own to re-run/fix).

## Background (verified in code)

- Report expense categories come **only** from `classifyExpenses`
  (`lib/ai.ts:611`), invoked in `lib/report/process.ts:157`. The LLM receives per
  line only `{ description, amount }` and returns one `GOV_EXPENSE_CATEGORY`.
- The offending rule is one prompt line: `lib/ai.ts:597` —
  `pharmacy / HMO / clinic / doctor → "הוצאות רפואיות חריגות"`.
- The LLM sees **only the store name** per line — it cannot tell toiletries from
  prescription at the same store. So the store name is the only available
  signal, and a deterministic store-name rule is exactly as powerful as the LLM
  here, but predictable.
- Target category string: `GOV_EXPENSE_CATEGORY.Food = "כלכלה (מזון)"` (the clean
  stem; the "מס' נפשות N" household suffix is added only at report generate-time).
  The longer `"כלכלה (מזון) - מס' נפשות 3"` belongs to the separate `CATEGORIES`
  scanner taxonomy and is **not** the classification target.
- The receipt-scanner OCR prompt (`lib/ai.ts:183`) also maps pharmacies → medical,
  but in the separate `CATEGORIES` taxonomy that the report classification does
  **not** consume (`lib/report/process.ts` only uses `classifyExpenses`). Out of
  scope.

## Decision (confirmed with the user)

Mechanism: **deterministic store-name override only** (not a prompt change, not a
hybrid). Chains: **סופר-פארם, ניו-פארם, גוד פארם** (retail drugstores). "Be/בי"
is deferred (too short to match safely; no observed charges yet). The classify
prompt is left unchanged — the override wins over it regardless.

## Design

### 1. `lib/types.ts` — domain constant + matcher

Add a maintained list of pharmacy-chain tokens and a pure matcher. This is the
single source of truth for the rule.

```ts
// Retail drugstore chains whose spend defaults to food/household, NOT medical
// (toiletries/cosmetics dominate). Health-fund pharmacies (מכבי פארם, בית מרקחת
// כללית) are deliberately excluded — those stay "הוצאות רפואיות חריגות". Tokens
// are pre-normalized (see normalizeStoreName): lowercase, no spaces/hyphens.
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
// e.g. "סופר-פארם ר\"ג", "SUPER-PHARM #123", "ניו פארם".
export function isPharmacyStore(description: string): boolean {
  const n = normalizeStoreName(description);
  return PHARMACY_CHAINS.some((chain) => n.includes(chain));
}
```

Notes:
- Full-name tokens (not the bare word "פארם") ensure "מכבי פארם" →
  `"מכביפארם"` matches nothing.
- Substring match tolerates branch suffixes/prefixes and store numbers.

### 2. `lib/report/process.ts` — apply the override

Right where each reconciled expense item is mapped to its classified category
(`process.ts:160-163`), override to Food when the store is a pharmacy:

```ts
const expenses: CategorizedExpense[] = recon.expenseItems.map((e, i) => ({
  ...e,
  category: isPharmacyStore(e.description)
    ? GOV_EXPENSE_CATEGORY.Food
    : categories[i],
}));
```

`isPharmacyStore` and `GOV_EXPENSE_CATEGORY` are imported from `lib/types.ts`
(the latter may already be imported; add `isPharmacyStore`).

## Behavior

- 100% predictable for the three chains; overrides whatever the LLM returned.
- Health-fund pharmacies and clinics/doctors remain "הוצאות רפואיות חריגות".
- Applies to new classifications only (at `process` time). Re-running a report
  re-applies it. The user edits genuine exceptions manually in the wizard table;
  those edits persist via the progress feature and are unaffected (the override
  runs only during initial classification, not on user edits).

## Out of scope

- `lib/ai.ts:183` (scanner CATEGORIES taxonomy) and any change to the classify
  prompt (`:597`).
- "Be/בי" chain.
- Migrating/reclassifying already-saved reports.

## Constraints & compliance

- No new Hebrew **UI** strings: `PHARMACY_CHAINS` entries are literal match
  strings, and the category is an existing `GOV_EXPENSE_CATEGORY` constant.
- No extra Google/LLM calls — the override is pure local logic (quota-neutral).
- Domain values live in `lib/types.ts` constants. TypeScript strict, no `any`.

## Verification

- `npm run typecheck` — PASS.
- `npm run lint` — zero new errors (pre-existing `UploadZone.tsx:135` allowed).
- `npm run build` — succeeds (in the worktree).
- Manual reasoning check (no test runner): `isPharmacyStore` returns true for
  `"סופר פארם"`, `"סופר-פארם ר\"ג"`, `"SUPER-PHARM 123"`, `"ניו פארם"`,
  `"גוד פארם"`; false for `"מכבי פארם"`, `"בית מרקחת כללית"`, `"שופרסל"`.
- Manual (user, on :3000): process a report containing a סופר-פארם line and
  confirm it lands in "כלכלה (מזון)", while a clinic/מכבי-פארם line stays
  "הוצאות רפואיות חריגות".
