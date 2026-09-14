# Receipt Billing Dates and Matching Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every printed receipt date by role, derive the editable matching date deterministically, and expose transaction anchors for safe manual multi-transaction matching without changing one-to-one automatic matching.

**Architecture:** Gemini returns source facts only. A pure `lib/receipt-dates.ts` module validates those facts, derives `Receipt.date`, and supplies the unique date sets used by candidate ranking; the OCR route copies the normalized document-level facts to every generated row. Google Sheets gains five additive columns P:T while historical A:O rows remain readable, and UI/matching consumers continue treating `Receipt.date` as the canonical period and automatic-match date.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, `@google/generative-ai` 0.24, Google Sheets API through `googleapis` 171, existing shadcn/Base UI primitives, and existing SheetJS export support.

**Spec:** `docs/superpowers/specs/2026-09-14-receipt-billing-dates-design.md`

**Approval record:** The user explicitly identified this specification as approved in the 2026-09-14 implementation-plan handoff. The older “written spec pending user review” line inside the specification is stale metadata; it does not reopen the approved design.

**Branch:** `feat/receipt-billing-dates`

**Base commit:** `a1eacc2` (`docs: specify receipt billing date handling`)

## Global Constraints

- Work only on `feat/receipt-billing-dates`; do not work on `main`, `master`, or `dev`.
- Treat `docs/superpowers/specs/2026-09-14-receipt-billing-dates-design.md` as the approved source of truth. STOP-and-ASK on an ambiguity or a required Hebrew string outside its approved list.
- Keep issue dates, billing periods, due dates, completed-payment dates, and scheduled bank-debit dates as distinct source facts.
- Derive `Receipt.date` in application code using exactly this precedence: earliest valid completed-payment date, earliest valid scheduled bank-debit date, due date, issue date, then `null`.
- `Receipt.date` remains the canonical editable matching date used by period filters, duplicate detection, automatic matching, and existing consumers. Editing it must not rewrite extracted source facts.
- Keep every explicit valid completed-payment date and bank-debit date. Deduplicate and chronologically sort each array; do not collapse either array to the derived matching date.
- Preserve historical `Receipt` objects and A:O Google Sheets rows without a destructive migration or model backfill. New receipt metadata fields are optional.
- Extend the receipt sheet additively from A:O to A:T with exactly these P:T headers: `תאריך הפקה`, `תקופת חשבון`, `מועד אחרון לתשלום`, `מועדי תשלום בפועל`, `מועדי חיוב בנק`.
- Automatic matching remains one receipt to one expense line with its existing amount and date tolerances. Do not attach one document to multiple charges automatically.
- Never invent installment amounts, split the bill total, or infer a transaction date from the payment method alone.
- Manual split matching is user-confirmed and uses only preserved completed-payment and bank-debit anchors for its relaxed amount gate.
- Add no PDF conversion layer, Docling/AnyDoc integration, package, or other dependency. Continue sending the original supported image/PDF directly to the existing OCR model.
- Keep the existing model/provider choice explicit and unchanged: `gemini-2.5-pro` remains the OCR model.
- TypeScript strict; no `any` without an explaining comment. Do not introduce automated test files or a test framework under the repository's declared testing gap.
- Use only the approved Hebrew strings for this feature: `תאריך התאמה`, `תאריך הפקה`, `תקופת חשבון`, `מועד אחרון לתשלום`, `מועדי תשלום בפועל`, `מועדי חיוב בנק`.
- Add no color, font, radius, custom CSS, or UI dependency. Reuse existing muted text and responsive table/sheet patterns from `DESIGN-SYSTEM.md`.
- Per implementation task, the orchestrator reviews the diff and runs `npm run typecheck` and `npm run lint`; when behavior is observable, the user then performs the task's focused runtime/visible check before commit approval. Run `npm run build` only at the final static gate.
- Implementers do not commit. The orchestrator presents the narrowly scoped diff, verification evidence, and proposed Conventional Commit message; the user's explicit approval authorizes that commit only.
- Do not run `npm run dev`, start the application, or perform visual/runtime verification. Runtime and visible checks belong to the user at the focused task gates and final Task 8 regression gate.
- Never push to a remote.

## Execution Model Policy

- Orchestrator: `gpt-5.6-sol`. It owns task dispatch, direct diff review, typecheck/lint/build execution, user handoffs, staging, and commits.
- Implementation Tasks 1–6: `gpt-5.6-terra`. These tasks cross domain, extraction, persistence, matching, or large existing UI boundaries and require contract-level reasoning.
- Documentation Task 7: `gpt-5.6-luna`. This is a narrow, mechanically specified documentation update after the implementation contract is settled.
- Final verification Task 8: the `gpt-5.6-sol` orchestrator runs every command itself.
- `gpt-6-astra` is an independent read-only reviewer at exactly two checkpoints: once on this completed plan before plan-commit approval, and once on the cumulative implementation diff after Tasks 1–7 and before final runtime closure. Astra does not implement, edit, commit, or replace the orchestrator's own review.
- Tasks are dependent and execute sequentially. Do not parallelize tasks that consume interfaces or persistence introduced by an earlier task.

---

### Task 1: Add the receipt date domain model and pure normalization rules

**Files:**
- Modify: `lib/types.ts` (`Receipt`, `RECEIPT_HEADERS`)
- Create: `lib/receipt-dates.ts`

**Behavior changed:**
- `Receipt` can carry five optional source-fact fields without invalidating historical objects.
- The sheet schema declares the approved five additive headers after the existing A:O headers.
- A pure module validates extracted ISO calendar dates for years 2018–2030, preserves valid canonical dates from historical/manual rows outside that extraction window, trims the printed billing period without expanding it, normalizes date arrays, and derives the matching date with the approved precedence.

**Behavior preserved:**
- Existing required `Receipt` fields and the order of columns A:O.
- Historical objects that contain only `date`.
- The distinction between a source fact and the editable matching date.

**Interfaces:**
- Produces optional `Receipt.issueDate`, `Receipt.billingPeriod`, `Receipt.dueDate`, `Receipt.paymentDates`, and `Receipt.bankDebitDates`.
- Produces `ReceiptDateFacts` with non-optional normalized properties:

```ts
export interface ReceiptDateFacts {
  issueDate: string | null;
  billingPeriod: string | null;
  dueDate: string | null;
  paymentDates: string[];
  bankDebitDates: string[];
}
```

- Produces these pure functions for later tasks:

```ts
export function normalizeReceiptDateFacts(input: {
  issueDate: unknown;
  billingPeriod: unknown;
  dueDate: unknown;
  paymentDates: unknown;
  bankDebitDates: unknown;
}): ReceiptDateFacts;

export function deriveMatchingDate(facts: ReceiptDateFacts): string | null;

export function receiptCandidateDates(
  receipt: Pick<Receipt, "date" | "paymentDates" | "bankDebitDates">,
): string[];

export function receiptTransactionAnchors(
  receipt: Pick<Receipt, "paymentDates" | "bankDebitDates">,
): string[];
```

- `receiptCandidateDates` returns unique valid dates from `[receipt.date, ...paymentDates, ...bankDebitDates]`; `receiptTransactionAnchors` excludes the editable `receipt.date` and returns only printed completed-payment and bank-debit dates.

- [ ] **Step 1: Extend `Receipt` with optional source facts**

Add these properties immediately after `date` so their relationship is visible:

```ts
  date: string | null;
  issueDate?: string | null;
  billingPeriod?: string | null;
  dueDate?: string | null;
  paymentDates?: string[];
  bankDebitDates?: string[];
```

Do not make them required and do not rename `date`.

- [ ] **Step 2: Append the approved P:T headers**

Keep the current 15 entries byte-for-byte and append:

```ts
  "תאריך הפקה",
  "תקופת חשבון",
  "מועד אחרון לתשלום",
  "מועדי תשלום בפועל",
  "מועדי חיוב בנק",
```

After the edit, `RECEIPT_HEADERS.length` is 20 and the first 15 indices still map to A:O.

- [ ] **Step 3: Implement real ISO-date validation with separate extraction and canonical policies**

In `lib/receipt-dates.ts`, accept only strings matching `YYYY-MM-DD` and compare the parsed UTC year/month/day back to the input components. This rejects values such as `2026-02-30` instead of allowing JavaScript date rollover.

Apply the 2018–2030 year guard to model-extracted `issueDate`, `dueDate`, `paymentDates`, and `bankDebitDates`. Do not apply that extraction guard to the existing editable `Receipt.date`: a valid historical/manual ISO date outside the model window must continue participating in period and duplicate behavior exactly as it does today.

The internal extraction normalizer returns `null` for non-strings, malformed strings, out-of-range years, and impossible calendar dates. The canonical validator rejects only malformed/impossible ISO dates.

- [ ] **Step 4: Implement source-fact normalization**

`normalizeReceiptDateFacts` must:

```text
issueDate       -> valid ISO date or null
billingPeriod   -> trimmed non-empty source string or null; never expand month-only text
dueDate         -> valid ISO date or null
paymentDates    -> valid ISO strings only, unique, ascending
bankDebitDates  -> valid ISO strings only, unique, ascending
```

Treat a non-array date-list value as an empty array. Keep the two arrays separate even when they contain the same date.

- [ ] **Step 5: Implement deterministic date selection and candidate sets**

Implement `deriveMatchingDate` as direct application logic:

```ts
return (
  facts.paymentDates[0] ??
  facts.bankDebitDates[0] ??
  facts.dueDate ??
  facts.issueDate ??
  null
);
```

`receiptCandidateDates` must use the canonical calendar-only validator for `receipt.date` and the 2018–2030 extraction validator for preserved source anchors. `receiptTransactionAnchors` uses the extraction validator. Both helpers remove duplicates across their combined inputs and sort ascending. Do not infer dates from `billingPeriod`.

- [ ] **Step 6: Run the task verification checkpoint**

Run:

```powershell
npm run typecheck
npm run lint
git diff --check
```

Expected: typecheck and lint exit successfully, `git diff --check` reports no whitespace errors, and no production consumer is forced to supply the new optional fields.

- [ ] **Step 7: Review and commit the domain change**

Show the scoped diff and verification output. After explicit commit approval:

```powershell
git add -- lib/types.ts lib/receipt-dates.ts
git commit -m "feat(receipts): add billing date domain model"
```

---

### Task 2: Prepare additive Google Sheets persistence before enabling enriched OCR

**Files:**
- Modify: `lib/google.ts` (`writeHeaders`, `receiptToRow`, `rowToReceipt`, receipt append/read/update/bulk-update ranges)

**Behavior changed:**
- New receipt rows round-trip all five source fields through A:T.
- Every A:T read/write path validates P:T first, including cached personal accounts, family/shared accounts, `ensure: false` API routes, direct appends, PATCH, and dedup bulk updates.
- Existing sheets receive missing P:T headers additively; expected headers are preserved and conflicting nonblank cells fail before receipt-row mutation.
- Receipt row writes use literal-value semantics so ISO strings and printed billing-period text are not reinterpreted by Sheets.

**Behavior preserved:**
- Existing A:O headers and cells, UUID placement in column A, numeric amounts, linked rows, direct manual sheet edits, and rows with fewer than 20 cells.
- No historical row rewrite or model backfill.

**Interfaces:**
- Consumes `RECEIPT_HEADERS`, `normalizeReceiptDateFacts`, and optional `Receipt` fields.
- P stores `issueDate`, Q stores `billingPeriod`, R stores `dueDate`, S stores comma-separated `paymentDates`, and T stores comma-separated `bankDebitDates`.

- [ ] **Step 1: Extend row serialization to exactly 20 values**

Append to `receiptToRow`:

```ts
    r.issueDate ?? "",
    r.billingPeriod ?? "",
    r.dueDate ?? "",
    (r.paymentDates ?? []).join(","),
    (r.bankDebitDates ?? []).join(","),
```

Do not insert these values among A:O.

- [ ] **Step 2: Read P:T defensively**

In `rowToReceipt`, pass indices 15–19 through `normalizeReceiptDateFacts`. Split S/T only when the cell is a non-empty string, then return normalized `issueDate`, `billingPeriod`, `dueDate`, `paymentDates`, and `bankDebitDates` on the `Receipt`.

For an old 15-cell row, the result is:

```ts
{
  issueDate: null,
  billingPeriod: null,
  dueDate: null,
  paymentDates: [],
  bankDebitDates: [],
}
```

That representation is compatible with optional fields and makes downstream array use safe after a Sheets read.

- [ ] **Step 3: Define one header validator used by setup and normal persistence**

Add module-private helpers with these responsibilities:

```ts
type MissingReceiptHeader = {
  index: number;
  column: "P" | "Q" | "R" | "S" | "T";
  expected: string;
};

function inspectReceiptHeaders(row: readonly unknown[]): MissingReceiptHeader[];

async function writeMissingReceiptHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  missing: readonly MissingReceiptHeader[],
): Promise<void>;

async function ensureReceiptHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<void>;
```

`inspectReceiptHeaders` checks indices 15–19 against `RECEIPT_HEADERS.slice(15)`. It returns blank/missing cells, leaves exact matches alone, and throws before any write for a nonblank mismatch. Development logs may include column/expected/actual; the thrown production-facing message is only `Receipt sheet headers are incompatible`.

`writeMissingReceiptHeaders` writes only the returned P:T cells with `RAW`. It never writes A:O. `ensureReceiptHeaders` reads A1:T1 and delegates to those two helpers.

Refactor `writeHeaders` to call the same logic for an existing receipt header row. Keep full A:T header creation for an entirely blank row.

- [ ] **Step 4: Make header validation a prerequisite of every A:T persistence path**

Do not rely on `ensureTabs`, `requireCapability({ ensure: true })`, or client call order: cached personal contexts and family/shared contexts bypass that setup path.

Apply the prerequisite without redundant reads where the function already reads receipt data:

```text
appendReceipts      call ensureReceiptHeaders before values.append
getAllReceipts      read A:T including row 1, inspect/repair its header, return rows after row 1
updateReceiptById   batch-read A1:T1 plus the target A:T row, inspect/repair header, then update
bulkUpdateReceipts  inspect/repair row 1 from its existing A:T read before building any row updates
writeHeaders        use the same validator during setup
```

For a conflict, return/throw before append, row update, or bulk update. A missing approved header may be filled before the data operation continues. Header validation must run for normal `/api/sheets` GET/POST/PATCH and `/api/dedup` flows even though those routes use `ensure: false`.

The append path necessarily adds one Sheets header read before each standalone append because it has no existing read from which to prove the schema. Do not hide this behind an untrusted client flag or a cache that can bypass conflicts. Record the request-cost trade-off, and include a representative multi-file scan in the user's runtime check; a quota regression is a STOP-and-ASK finding, not permission to weaken schema safety.

- [ ] **Step 5: Expand every receipt data range to A:T**

Change only receipt-row ranges and their explanatory comments:

```text
appendReceipts           A:T
getAllReceipts           A2:T
updateReceiptById        A{row}:T{row}
bulkUpdateReceipts read  A:T
bulkUpdateReceipts write A{row}:T{row}
```

Keep narrow UUID lookup ranges such as A2:A unchanged.

- [ ] **Step 6: Preserve strings literally on receipt writes**

For `appendReceipts`, `updateReceiptById`, and `bulkUpdateReceipts`, use `valueInputOption: "RAW"`. Values supplied as JavaScript numbers remain numeric, while ISO dates, comma-separated date lists, opaque ids, and a source period such as `07-08/26` remain literal strings.

Do not change the value-input option of settings, stores, transactions, or unrelated sheet writes in this task.

- [ ] **Step 7: Run the static task verification checkpoint**

Run:

```powershell
npm run typecheck
npm run lint
rg -n "A:O|A2:O|:O\\$|O\\{row" lib/google.ts
rg -n "A:T|A1:T1|RECEIPT_HEADERS\.slice\(15\)|ensureReceiptHeaders|inspectReceiptHeaders" lib/google.ts
git diff --check
```

Expected:

- Typecheck and lint exit successfully.
- No stale A:O receipt range or comment remains in `lib/google.ts`.
- All row writers emit 20 values and all row readers tolerate missing P:T cells.
- Every A:T persistence path invokes the validator directly or validates row 1 from the same read.

- [ ] **Step 8: Hand off focused persistence runtime verification**

The user runs the application and confirms before commit:

1. An existing personal spreadsheet with a cached session receives the five approved P:T headers; A:O headers/values remain unchanged and historical rows still load/edit.
2. A family/shared account performs the same GET/PATCH path successfully with the approved headers.
3. In a safe spreadsheet copy, a conflicting nonblank P:T header makes GET, append, PATCH, and bulk-update attempts fail before any receipt-row cell changes.
4. A missing P:T header is filled without rewriting neighboring expected headers.
5. A representative multi-file scan completes without a Sheets 429 after the append preflight was added.

Expected: no old row is migrated or backfilled, no conflicting column is overwritten, and the user confirms the visible Sheet result. Static checks do not satisfy this gate.

- [ ] **Step 9: Review and commit the persistence change**

Show the scoped diff, static verification output, and the user's runtime confirmation. After explicit commit approval:

```powershell
git add -- lib/google.ts
git commit -m "feat(sheets): persist receipt billing dates"
```

---

### Task 3: Extract date-role facts and derive every generated receipt row

**Files:**
- Modify: `lib/ai.ts` (`ExtractedReceipt`, `RECEIPT_SCHEMA`, `RECEIPT_SYSTEM`, `extractReceipt` normalization)
- Modify: `app/api/ocr/route.ts` (receipt construction for zero, one, and multiple payment rows)

**Behavior changed:**
- Gemini returns distinct source facts and no model-selected generic receipt date.
- Invalid date metadata is dropped server-side without failing the scan.
- The OCR route derives `Receipt.date` once and copies the matching date plus all normalized source metadata to every row produced for the document.
- Task 2 already persists these fields, so no committed intermediate state can silently discard enriched OCR output.

**Behavior preserved:**
- Direct image/PDF input, `gemini-2.5-pro`, retry behavior, category/payment extraction/classification, known-store handling, and mixed-payment row construction.
- A document with several scheduled debits still produces rows only from explicit payment-method entries; dates never create extra rows or invented amounts.
- Bit is printed evidence for a completed payment date; this feature does not add Bit to the existing payment-method enums.

**Interfaces:**
- Consumes `normalizeReceiptDateFacts` and `deriveMatchingDate` from Task 1 and A:T persistence from Task 2.
- `ExtractedReceipt` replaces `date` with:

```ts
  issue_date: string | null;
  billing_period: string | null;
  due_date: string | null;
  payment_dates: string[];
  bank_debit_dates: string[];
```

- [ ] **Step 1: Replace the receipt date in the Gemini response contract**

Remove `date` only from the receipt extraction interface, receipt schema properties, and receipt schema `required` list. Add all five fields above; require each field in the JSON object while allowing nullable scalar values and empty arrays.

Schema descriptions must state:

```text
issue_date: YYYY-MM-DD or null
billing_period: printed source text or null
due_date: YYYY-MM-DD or null
payment_dates: every explicit completed-payment date as YYYY-MM-DD
bank_debit_dates: every explicit scheduled bank-account debit or not-before anchor as YYYY-MM-DD
```

Do not modify unrelated `date` fields in statement, deduplication, salary, or direct-card-charge schemas.

- [ ] **Step 2: Replace the generic prompt rule with date-role instructions**

Keep the existing anti-hallucination and valid-year rules, then explicitly instruct the model:

- `issue_date` covers printed preparation/edit/invoice/issue dates and the printed date of an ordinary point-of-sale receipt.
- `billing_period` is copied as printed and never expanded to invented day boundaries.
- `due_date` requires an explicit payment deadline; a bank-account debit label is not a deadline unless the document explicitly gives both roles.
- `payment_dates` contains all dates tied to completed tenders or receipt of funds, including receipts/payment tables and completed Bit/card/cash/transfer rows.
- `bank_debit_dates` contains all explicit scheduled account-charge dates; “not before DATE” contributes DATE itself, not the next day.
- A standing-order payment method alone contributes no date.
- Missing or unreadable facts return `null` or `[]`.

Update the confidence wording so it refers to the receipt's relevant readable date facts rather than the removed generic response field.

- [ ] **Step 3: Normalize the parsed model response before returning it**

Immediately after JSON parsing and the existing defensive category/payment checks, call `normalizeReceiptDateFacts` with the five snake-case values. Return the normalized values in the same snake-case `ExtractedReceipt` fields. Invalid date values disappear individually; they do not reject otherwise usable store, amount, or payment data.

- [ ] **Step 4: Derive one document-level date bundle in the OCR route**

After `extractReceipt` returns, map its already-normalized snake-case values to one typed camel-case bundle and derive the canonical date once:

```ts
const dateFacts: ReceiptDateFacts = {
  issueDate: extracted.issue_date,
  billingPeriod: extracted.billing_period,
  dueDate: extracted.due_date,
  paymentDates: extracted.payment_dates,
  bankDebitDates: extracted.bank_debit_dates,
};
const receiptDate = deriveMatchingDate(dateFacts);
const receiptDates = { date: receiptDate, ...dateFacts };
```

Do not normalize twice. `extractReceipt` owns validation; the route owns the explicit snake-case-to-camel-case boundary and deterministic derivation.

- [ ] **Step 5: Copy the bundle into all generated receipt shapes**

Replace each `date: extracted.date` in the zero-payment, one-payment, and mixed-payment branches with `...receiptDates`. Keep the same bundle for every linked row. Do not derive or mutate dates inside the per-payment loop.

The pre-existing non-OCR fallback row at `app/api/ocr/route.ts` keeps `date: null`; it need not spell out optional metadata.

- [ ] **Step 6: Run the static task verification checkpoint**

Run:

```powershell
npm run typecheck
npm run lint
rg -n "issue_date|billing_period|due_date|payment_dates|bank_debit_dates" lib/ai.ts app/api/ocr/route.ts
rg -n "extracted\.date" lib/ai.ts app/api/ocr/route.ts
git diff --check
```

Expected:

- Typecheck and lint exit successfully.
- All five source fields appear in the receipt extraction contract and route mapping.
- `extracted.date` has no matches.
- Unrelated statement/transaction `date` schemas remain intact.

- [ ] **Step 7: Hand off the three approved sample-document runtime checks**

The user scans the municipal, telecommunications, and validated invoice-receipt samples and confirms the exact expectations later repeated in Task 8. In particular, the invoice-receipt must retain issue date `2026-07-30`, completed-payment date `2026-07-07`, and matching date `2026-07-07`. Its printed Bit row is evidence for `paymentDates`; the existing supported payment-method classification remains unchanged.

The user also opens the saved Google Sheet and confirms every scalar/date array round-trips through P:T as literal source data. Do not commit on static evidence alone.

- [ ] **Step 8: Review and commit the extraction change**

Show the scoped diff, static verification output, and the user's runtime confirmation. After explicit commit approval:

```powershell
git add -- lib/ai.ts app/api/ocr/route.ts
git commit -m "fix(ocr): derive receipt dates from source facts"
```

---

### Task 4: Rank manual candidates by preserved transaction anchors without broadening automatic or duplicate matching

**Files:**
- Modify: `lib/match.ts` (`daysBetween` reuse, `receiptLineDistance`, new split-candidate helper)
- Modify: `lib/receipt-check.ts` (`checkScannedReceipt` distance call)

**Behavior changed:**
- Manual candidate ordering measures the line date against the nearest valid unique date in `[Receipt.date, ...paymentDates, ...bankDebitDates]`.
- A pure split-candidate predicate can admit related expense lines near one of at least two printed transaction anchors regardless of amount difference.

**Behavior preserved:**
- `matchTxnsToReceipts` and `matchReceiptsToLines` continue using `Receipt.date`, the existing 0.5% amount tolerance, the existing three-day tolerance, and used-receipt sets. Each receipt can be matched automatically at most once.
- `/check` duplicate confidence continues comparing canonical `Receipt.date` values within one day. Payment/debit anchors must not make a different receipt appear duplicated.
- Existing “amount is king” ordering and name-similarity threshold.

**Interfaces:**
- `receiptLineDistance` gains an optional date scope while defaulting to all candidate dates:

```ts
export function receiptLineDistance(
  line: { date?: string | null; amount: number | null; description: string | null },
  receipt: Receipt,
  options?: { dateScope?: "candidate" | "matching" },
): CandidateDistance | null;
```

- Produces:

```ts
export const DEFAULT_MATCH_DAYS_TOL = 3;

export function isManualSplitCandidate(
  line: { date?: string | null; description: string | null },
  receipt: Receipt,
): boolean;
```

- [ ] **Step 1: Centralize the existing three-day default without changing it**

Export `DEFAULT_MATCH_DAYS_TOL = 3` and use it as the default in both automatic matching functions. Do not change amount tolerance, scoring, iteration order, or used-receipt behavior.

- [ ] **Step 2: Expand candidate distance only**

For the default `dateScope: "candidate"`, calculate `daysDiff` as the minimum distance from the line date to `receiptCandidateDates(receipt)`. For `dateScope: "matching"`, use only a valid `receipt.date`.

Keep returning `null` when either amount is missing, the line date is missing/invalid, or the selected date set is empty. Preserve `amountDiff`, `sameAmount`, and `nameRelated` exactly.

- [ ] **Step 3: Implement the manual split predicate from printed anchors only**

`isManualSplitCandidate` returns `true` only when all conditions hold:

```text
receiptTransactionAnchors(receipt) contains at least two unique dates
line.date is valid
line description and receipt store name meet NAME_SIMILARITY_MIN
nearest printed transaction anchor is within DEFAULT_MATCH_DAYS_TOL
```

Do not inspect `Receipt.date` in this predicate. Do not require equal amounts and do not calculate installment amounts.

- [ ] **Step 4: Pin duplicate checking to canonical matching dates**

In `lib/receipt-check.ts`, call:

```ts
receiptLineDistance(line, receipt, { dateScope: "matching" })
```

Keep `MATCH_DAYS_TOL = 1`, same-amount, and related-name gates unchanged.

- [ ] **Step 5: Inspect the automatic functions as a negative-scope gate**

Review the diff for `matchTxnsToReceipts` and `matchReceiptsToLines`. Apart from replacing the literal default `3` with `DEFAULT_MATCH_DAYS_TOL`, their bodies must be unchanged and must continue reading `r.date` directly.

- [ ] **Step 6: Run the task verification checkpoint**

Run:

```powershell
npm run typecheck
npm run lint
rg -n "usedReceipts|const used|r\.date|DEFAULT_MATCH_DAYS_TOL|dateScope: \"matching\"|isManualSplitCandidate" lib/match.ts lib/receipt-check.ts
git diff --check
```

Expected: typecheck and lint exit successfully; both automatic paths still enforce one used receipt and canonical `r.date`; `/check` explicitly requests matching-date-only distance.

- [ ] **Step 7: Hand off focused matching runtime verification**

The user confirms before commit:

1. Automatic matching still attaches at most one receipt and still requires the existing amount/date tolerances against canonical `Receipt.date`.
2. The municipal bill's manual candidate ordering can rank lines near either preserved debit anchor.
3. `/check` duplicate suggestions remain based on canonical receipt dates; a future debit anchor does not create a duplicate match.
4. A manually edited canonical date outside 2018–2030 continues participating in the same historical/duplicate behavior as before.

Do not mark matching behavior verified from typecheck/lint alone.

- [ ] **Step 8: Review and commit the matching-core change**

Show the scoped diff, static verification output, and the user's runtime confirmation. After explicit commit approval:

```powershell
git add -- lib/match.ts lib/receipt-check.ts
git commit -m "feat(report): rank candidates by receipt transaction dates"
```

---

### Task 5: Expose transaction anchors and the explicit split-mode exception in the manual workbench

**Files:**
- Modify: `components/report/MatchWorkbench.tsx`

**Behavior changed:**
- The receipt summary shows completed-payment and bank-debit dates beside the editable matching date context.
- Split mode admits a related expense line near any of at least two printed transaction anchors even when its amount differs from the receipt total.
- The user still confirms each attachment, and the existing `keepAvailable` flow leaves the receipt available for another explicit attachment.

**Behavior preserved:**
- Default mode requires exact amount plus related name.
- “Show all” and non-empty free-text search retain their current behavior.
- The workbench does not create amounts, attach automatically, or consume the receipt in split mode.
- `components/ReportWizard.tsx` needs no change: `attachReceipt(..., keepAvailable)` already implements the approved repeated manual attachment, and its default `candidateCount` remains exact-amount/name based.

**Interfaces:**
- Consumes `isManualSplitCandidate` and the existing `receiptLineDistance`/`compareCandidates` APIs from Task 4.

- [ ] **Step 1: Add the split-mode candidate exception**

Preserve the search override as the first branch. Replace only the no-search gate with equivalent logic:

```ts
return (
  showAll ||
  (d !== null && d.sameAmount && d.nameRelated) ||
  (splitMode && isManualSplitCandidate(e, receipt))
);
```

The last branch must not use `d.daysDiff`, because that distance includes the editable `Receipt.date`. It must use the printed-anchor-only predicate from Task 4.

- [ ] **Step 2: Render completed-payment and debit schedules in the receipt summary**

Below the current matching date/payment-method line, conditionally render:

```text
מועדי תשלום בפועל: DD/MM/YYYY, ...
מועדי חיוב בנק: DD/MM/YYYY, ...
```

Omit each line when its array is empty or absent. Use the component's existing `fmtDate` and `text-sm text-muted-foreground` patterns. Add no empty placeholder and no new Hebrew copy.

- [ ] **Step 3: Confirm the repeated-attachment boundary remains user controlled**

Inspect, but do not edit, `components/ReportWizard.tsx`:

- `onAttach(e.lineId, splitMode)` passes the explicit checkbox state.
- `attachReceipt` keeps the receipt in the unmatched list only when `keepAvailable` is true.
- No code path loops through candidates or attaches several lines at once.

Record this inspection in the task report.

- [ ] **Step 4: Run the task verification checkpoint**

Run:

```powershell
npm run typecheck
npm run lint
rg -n "isManualSplitCandidate|splitMode|keepAvailable|מועדי תשלום בפועל|מועדי חיוב בנק" components/report/MatchWorkbench.tsx components/ReportWizard.tsx
git diff --check
```

Expected: typecheck and lint exit successfully; the split exception exists only behind `splitMode`; repeated attachment still goes through one user click per line.

- [ ] **Step 5: Hand off focused workbench runtime verification**

The user confirms before commit:

1. Default mode still shows only exact-amount, related-name candidates.
2. Split mode shows related lines within three days of either printed municipal debit date even when line amounts differ from the bill total.
3. An unrelated manual `Receipt.date` edit does not create a split candidate.
4. Completed-payment and bank-debit schedules appear only when present.
5. Each attachment still requires a separate click and `keepAvailable` preserves the receipt only while split mode is explicitly enabled.

- [ ] **Step 6: Review and commit the workbench change**

Show the scoped diff, static verification output, and the user's runtime confirmation. After explicit commit approval:

```powershell
git add -- components/report/MatchWorkbench.tsx
git commit -m "feat(report): guide split matching with receipt dates"
```

---

### Task 6: Show, search, and export receipt source dates

**Files:**
- Modify: `components/ReceiptTable.tsx` (column label, desktop row, mobile edit sheet, search haystack, CSV export, XLSX export)
- Modify: `components/UploadZone.tsx` (scan-results date-column label only)

**Behavior changed:**
- Every receipt-facing `Receipt.date` label in these components reads `תאריך התאמה`.
- The desktop receipt table and mobile edit sheet show source facts as read-only muted details and omit absent facts.
- Free-text receipt search includes all five source fields.
- CSV/XLSX exports rename the canonical date and append the five approved source columns.

**Behavior preserved:**
- The matching-date input remains editable and autosaves only `{ date: value }`.
- Source facts are not editable from the receipt UI.
- Period filtering and sorting still use `Receipt.date`.
- The scan-results table gains no additional columns.
- CSV BOM/quoting, selected sorted rows, and XLSX RTL behavior remain intact.

- [ ] **Step 1: Rename canonical matching-date labels**

Change only labels that name `Receipt.date`:

- `COLUMNS` date label in `ReceiptTable.tsx`.
- Mobile edit-sheet `<Label>` in `ReceiptTable.tsx`.
- Existing scan-results date header in `UploadZone.tsx`.

Use exactly `תאריך התאמה`. Do not rename unrelated bank transaction or report expense-line date headers.

- [ ] **Step 2: Add read-only source facts below the desktop date input**

After the existing matching-date display, conditionally show the five approved labels and their values:

```text
תאריך הפקה             formatDate(issueDate)
תקופת חשבון            billingPeriod verbatim
מועד אחרון לתשלום      formatDate(dueDate)
מועדי תשלום בפועל      each paymentDates value through formatDate
מועדי חיוב בנק         each bankDebitDates value through formatDate
```

Omit missing/null scalars and empty arrays. Use existing muted small text and no new UI primitive.

- [ ] **Step 3: Add the same read-only block to the mobile edit sheet**

Place it immediately after the matching-date control and before the next editable field. Keep the source values outside inputs and ensure `patch(editing.id, { date: v })` remains the only date mutation in this block.

- [ ] **Step 4: Extend free-text search**

Add these values to the existing search haystack:

```ts
r.issueDate,
r.billingPeriod,
r.dueDate,
...(r.paymentDates ?? []),
...(r.bankDebitDates ?? []),
```

Keep period filtering, column filtering, pagination, and sort behavior unchanged.

- [ ] **Step 5: Extend CSV export**

Rename the existing `תאריך` header to `תאריך התאמה` and append the five approved source headers after the existing columns. Append the corresponding values to every exported row in the same order.

Run joined date arrays through `quoteCSV`, so their comma separators remain inside one CSV cell. Preserve the BOM, line quoting, file name, and `sorted` source collection.

- [ ] **Step 6: Extend XLSX export**

Rename the existing object key to `תאריך התאמה` and add the five source keys. Export date arrays as comma-separated ISO strings. Preserve `XLSX.utils.json_to_sheet`, `!RTL`, workbook name, and file name.

- [ ] **Step 7: Run the task verification checkpoint**

Run:

```powershell
npm run typecheck
npm run lint
rg -n "תאריך התאמה|תאריך הפקה|תקופת חשבון|מועד אחרון לתשלום|מועדי תשלום בפועל|מועדי חיוב בנק" components/ReceiptTable.tsx components/UploadZone.tsx
rg -n "patch\([^,]+, \{ date:" components/ReceiptTable.tsx
git diff --check
```

Expected:

- Typecheck and lint exit successfully.
- All six approved labels appear only at the intended receipt UI/export sites.
- Source-field rendering contains no mutation handler.
- The scan-results table still has its original column count.

- [ ] **Step 8: Hand off focused receipt UI/export runtime verification**

The user confirms before commit:

1. Desktop and mobile show `תאריך התאמה` plus only the source facts that exist; source facts are read-only.
2. Editing the matching date changes only `Receipt.date` and leaves the five source fields unchanged.
3. Search finds receipts by each new source field.
4. CSV and XLSX use `תאריך התאמה`, contain all five appended source columns, and keep multi-date lists in one cell.
5. The scan-results table only renames its existing date column and gains no columns.

- [ ] **Step 9: Review and commit the receipt UI/export change**

Show the scoped diff, static verification output, and the user's runtime confirmation. After explicit commit approval:

```powershell
git add -- components/ReceiptTable.tsx components/UploadZone.tsx
git commit -m "feat(receipts): expose billing date metadata"
```

---

### Task 7: Update the authoritative architecture contract

**Files:**
- Modify: `ARCHITECTURE.md` (module boundaries, receipt schema, OCR contract, date convention, new-column guidance, file map)

**Behavior changed:**
- Documentation describes the implemented 20-column schema and matching-date invariant.

**Behavior preserved:**
- Existing architecture rules for UUIDs, mixed-payment rows, direct PDF OCR, API boundaries, authentication, and Hebrew string ownership.

- [ ] **Step 1: Document the pure date module**

Add `lib/receipt-dates.ts` to the service/business-logic layer and file map as the owner of receipt date validation, matching-date derivation, and candidate-anchor sets. Its dependencies are limited to `lib/types.ts`.

- [ ] **Step 2: Replace the 15-column receipt schema description**

Document 20 columns, A:T, and the five exact P:T mappings. State that A:O remains unchanged and old shorter rows load with absent/empty metadata.

- [ ] **Step 3: Document the date invariants**

Add the exact precedence:

```text
earliest completed-payment date
earliest scheduled bank-debit date
due date
issue date
null
```

State that `Receipt.date` is the editable matching date; source facts remain distinct; arrays retain all explicit dates; manual date edits do not rewrite source facts; period filters and automatic matching use `Receipt.date`.

- [ ] **Step 4: Document matching boundaries**

State that automatic matching remains one-to-one. Candidate ranking may consult the canonical, completed-payment, and bank-debit dates, while relaxed split admission requires at least two unique printed transaction anchors and a user-confirmed `keepAvailable` attachment. No amount division or automatic one-to-many attachment is allowed.

- [ ] **Step 5: Update the OCR and new-column guidance**

Update `/api/ocr` to say Gemini returns source facts and the server derives the matching date. Update “Add a new column to the receipts tab” so A:T persistence and additive header validation remain part of the schema change path.

- [ ] **Step 6: Run the task verification checkpoint**

Run:

```powershell
npm run typecheck
npm run lint
rg -n "20 columns|A:T|issue|billing|due|completed|bank-debit|matching date|receipt-dates" ARCHITECTURE.md
git diff --check
```

Expected: typecheck and lint exit successfully, and `ARCHITECTURE.md` agrees with the implemented field names, ranges, precedence, and one-to-one automatic-match boundary.

- [ ] **Step 7: Review and commit the architecture update**

Show the scoped diff and verification output. After explicit commit approval:

```powershell
git add -- ARCHITECTURE.md
git commit -m "docs: document receipt billing date semantics"
```

---

### Task 8: Obtain final Astra review, run static gates, and hand regression verification to the user

**Files:**
- No files changed.

**Purpose:**
- Obtain the second and final independent Astra opinion on the cumulative implementation, establish repository/static correctness, verify the planned scope, and define the exact user-run regression checks. Static checks and model review do not prove runtime behavior.

- [ ] **Step 1: Dispatch the second and final read-only Astra review**

Dispatch one `gpt-6-astra` reviewer at high reasoning effort with the approved spec, this plan, `ARCHITECTURE.md`, and the cumulative diff from `a1eacc2` through Tasks 1–7. Require severity-ordered findings with exact file/line references and explicit checks for:

- deterministic precedence and source-field separation;
- A:T compatibility and header validation on cached personal/shared/write paths;
- one-to-one automatic matching and canonical-only duplicate checking;
- printed-anchor-only manual split admission;
- accidental package/PDF-conversion changes;
- UI/export/search coverage and user-owned runtime gates.

The reviewer is read-only and does not commit. Sol reviews every finding against the source and spec. Any accepted code correction becomes a new focused task, user runtime gate when behavior changes, and separate approved commit before this task resumes.

- [ ] **Step 2: Verify the repository state and complete diff**

Run:

```powershell
git status --short
git diff a1eacc2 --stat
git diff a1eacc2 --check
```

Expected: only the planned production/documentation files differ from `a1eacc2`, every completed implementation task is committed, and the working tree is clean.

- [ ] **Step 3: Run the full non-interactive repository gates**

Run in this order:

```powershell
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit successfully. Record the accepted pre-existing lint warning only if it still exists at its current line; any new warning or error blocks handoff.

- [ ] **Step 4: Run focused contract searches**

Run:

```powershell
rg -n "A:O|A2:O" lib/google.ts
rg -n "extracted\.date" lib/ai.ts app/api/ocr/route.ts
rg -n -i "docling|anydoc|pdf.?to.?markdown" package.json package-lock.json lib app components
git diff a1eacc2 -- package.json package-lock.json
rg -n "usedReceipts|const used|r\.date" lib/match.ts
```

Expected:

- No stale A:O receipt range remains.
- The OCR receipt path no longer consumes a model-selected generic date.
- No conversion layer or dependency is present.
- Package manifests have no diff.
- Automatic matching still has a used-receipt guard and reads canonical `r.date`.

- [ ] **Step 5: Hand off the three approved sample-document checks**

The user runs the application through the normal environment and scans each approved sample. Do not run the dev server or mark these checks verified on the user's behalf.

1. **Bi-monthly municipal bill**
   - Total remains `1357.14`.
   - Issue/preparation date is `2026-06-29`.
   - Printed billing period remains a source string equivalent to `07-08/26`; it is not expanded into invented day boundaries.
   - Due date is `2026-07-15`.
   - Bank-debit dates are exactly `2026-07-15` and `2026-08-15`, both visible and persisted.
   - Completed-payment dates are empty unless explicitly printed as completed payments.
   - `Receipt.date` / `תאריך התאמה` is `2026-07-15`.

2. **Monthly telecommunications bill**
   - Total remains `150.27`.
   - Issue/edit date is `2026-05-19`.
   - The printed service period remains distinct source text.
   - Bank-debit anchor is `2026-06-05`, including the “not before” date itself.
   - The bank-debit anchor is not duplicated into `dueDate` unless the source explicitly labels it as a payment deadline.
   - `Receipt.date` / `תאריך התאמה` is `2026-06-05`.

3. **Validated invoice-receipt**
   - Total remains `450.00`.
   - Issue date is `2026-07-30`.
   - The printed Bit tender row is recognized as evidence that `paymentDates` contains `2026-07-07`.
   - The existing supported payment-method classification remains unchanged; this feature does not introduce a Bit enum value.
   - Scheduled bank-debit dates are empty unless explicitly printed.
   - `Receipt.date` / `תאריך התאמה` is `2026-07-07`, proving completed payment takes precedence even when it predates the issue date.

- [ ] **Step 6: Hand off compatibility and ordinary-receipt regression checks**

The user verifies:

1. Scan an ordinary point-of-sale receipt: its printed receipt date is saved as `issueDate` and selected as `Receipt.date`; no billing period, due date, completed-payment date, or bank-debit date is invented.
2. Open a spreadsheet created before this feature: P1:T1 receive exactly the approved headers, A:O headers and values remain unchanged, historical rows load and remain editable, and no bulk backfill occurs.
3. Repeat the existing-sheet check from a cached personal session and from a family/shared account; neither path may bypass schema validation.
4. In a safe copy, place a conflicting nonblank value in one P:T header cell and exercise GET, append, PATCH, and dedup/bulk update: each request fails before any receipt row changes; production UI receives a generic error while development logs carry the diagnostic detail.
5. Filter receipts and the report wizard by period: documents appear according to `Receipt.date`, including the three approved samples.
6. Edit only `תאריך התאמה`: filtering and matching follow the edit while all five extracted source fields remain unchanged.
7. Search by an issue date, billing-period text, completed-payment date, and bank-debit date: the corresponding receipt is found.
8. Export CSV and XLSX: the canonical column is `תאריך התאמה`, all five source columns exist, multi-date values remain in one cell, and prior columns retain their values.

- [ ] **Step 7: Hand off manual and automatic matching checks**

The user verifies with the municipal bill and representative expense lines:

1. Default workbench mode still offers only exact-amount, related-name candidates.
2. Candidate ordering can surface lines near either `2026-07-15` or `2026-08-15`.
3. Enabling split mode admits related-name lines within three days of either printed debit date even when each line amount differs from `1357.14`.
4. Each attachment requires a separate click; with split mode enabled the existing `keepAvailable` flow leaves the document available for the second confirmed expense line.
5. No installment amount is generated and no candidate is attached automatically.
6. Editing `Receipt.date` to an unrelated date does not create a split candidate unless it is also near one of the preserved completed-payment or bank-debit anchors.
7. Automatic matching still consumes a receipt at most once and still requires its existing amount/date tolerances against canonical `Receipt.date`.
8. The `/check` duplicate flow still compares canonical receipt dates and does not treat a preserved future debit anchor as the date of a prior receipt.

- [ ] **Step 8: Record the user's runtime result**

Do not claim the feature works from typecheck, lint, or build. Record the user's confirmation or exact failures in `.superpowers/sdd/progress.md`. Any runtime defect or calibration issue becomes a follow-up spec/plan on this feature branch under the repository workflow.
