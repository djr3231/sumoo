# Receipt Billing Dates and Matching Anchors - Design

> Status: strategy approved by the user on 2026-09-14; written spec pending
> user review.
> Branch: `feat/receipt-billing-dates` off `dev`.
> Base commit: `b96a60f`.

## Problem

The receipt scanner stores one generic `date` for every document. That is
insufficient for recurring-service bills, which can contain several dates with
different meanings:

- the bill preparation or issue date;
- a billing or consumption period;
- the payment deadline;
- one or more dates on which payment was actually completed;
- one or more scheduled bank-debit dates; and
- a lower-bound debit date expressed as "not before" a stated date.

The current Gemini schema asks for only one date and the prompt defines only its
format. The OCR route then copies that value directly into every persisted
receipt row. Period filtering and receipt-to-expense matching treat it as the
transaction date. This caused a municipal bill prepared in late June for July
and August debits to be filed under June, and caused a telecommunications bill
with an explicit early-June bank-debit date to receive an unrelated July date.

The failure is a contract and domain-model problem, not evidence that Gemini
cannot read the source PDFs.

## Investigation evidence

Two user-supplied, text-based Hebrew PDFs were inspected locally and used for an
approved four-call comparison with the production OCR model,
`gemini-2.5-pro`. Both the original PDF and Docling Markdown received the same
explicit date-role instructions and JSON schema.

Both inputs produced the required matching dates and preserved the tested totals:

| Document | Required facts | Direct PDF | Docling Markdown |
|---|---|---|---|
| Bi-monthly municipal bill | total `1357.14`; debit dates `2026-07-15`, `2026-08-15`; matching date `2026-07-15` | correct | correct |
| Monthly telecommunications bill | total `150.27`; debit anchor `2026-06-05`; matching date `2026-06-05` | correct | correct |

Docling did not improve accuracy on this corpus. Its Markdown used 4,035 prompt
tokens across the two calls versus 2,150 for direct PDF, an increase of about
88%. Its output also required all content layers to retain a critical page
footer, and Markdown did not retain usable page provenance in the comparison.
The direct-PDF path remains the selected approach; this feature adds no document
conversion dependency.

The comparison also exposed two constraints for the extraction contract:

- a month-only period such as `07-08/26` must not be expanded into invented
  day boundaries;
- a bank-debit date must not also be labeled as a payment deadline unless the
  document explicitly gives it both roles.

A third user-supplied invoice-receipt was then run as a blind validation. The
document was issued on `2026-07-30`, but its receipts table recorded a completed
Bit payment of `450.00` on `2026-07-07`. The first date-role schema extracted the
amount, payment method, and issue date but selected the issue date because it had
no field for a completed-payment date. After adding a generic `payment_dates`
role and instructions to inspect receipts and tender tables, a second call on the
same PDF extracted both dates without being given the expected value and derived
`2026-07-07` as the matching date. This establishes that completed payments are
a separate source fact rather than a subtype of scheduled bank debit.

## Goals

1. Extract each relevant date according to its printed role.
2. Derive the receipt's matching date deterministically in application code.
3. Keep existing period filters and consumers working through `Receipt.date`.
4. Preserve every explicit completed-payment and bank-debit anchor for review
   and guided split matching.
5. Keep historical receipt rows readable without a destructive migration.
6. Make the meaning of the editable date clear to the user.

## Domain model

### Gemini extraction result

`ExtractedReceipt` replaces the model-selected `date` field with these
model-extracted facts:

```ts
issue_date: string | null;       // YYYY-MM-DD
billing_period: string | null;   // printed period, trimmed but not expanded
due_date: string | null;         // YYYY-MM-DD
payment_dates: string[];         // explicit completed-payment dates
bank_debit_dates: string[];      // explicit dates or "not before" anchors
```

The existing store, amount, category, document type, confidence, and payment
fields remain unchanged. Currency extraction belongs to the separate
foreign-currency issue and is not added here.

The model does not return a final matching date. It reports source facts only.

### Persisted receipt

`Receipt` gains optional fields so rows written before this feature remain
valid:

```ts
issueDate?: string | null;
billingPeriod?: string | null;
dueDate?: string | null;
paymentDates?: string[];
bankDebitDates?: string[];
```

The existing `Receipt.date` remains the canonical, editable matching date. This
preserves the current API shape for period filters, duplicate detection,
receipt lists, report matching, CSV/XLSX consumers, and saved client state.

For mixed-payment documents, every linked receipt row receives the same
document-level date metadata, just as every linked row currently receives the
same generic date.

## Extraction rules

The Gemini prompt and response schema are extended with explicit role rules:

- `issue_date` is the printed preparation, editing, invoice, or issue date.
  For an ordinary point-of-sale receipt, its printed receipt date belongs here.
- `billing_period` is copied from the document as a short source string. It is
  never converted into artificial first/last days. Examples include a pair of
  months or an explicit day-to-day service range.
- `due_date` is populated only for an explicit payment deadline such as
  "payment due by". A label meaning "bank account debit date" is not a due
  date.
- `payment_dates` contains every explicit date associated with a completed
  payment or receipt of funds. The model inspects tables headed "receipts",
  "payments", or equivalent labels and keeps the date attached to each tender
  row. A completed Bit, card, cash, or transfer payment is not a scheduled bank
  debit. Its date may precede the issue date of an invoice-receipt.
- `bank_debit_dates` contains every explicit bank-account charge date. A
  statement that the account will be charged on two dates yields two entries.
- A phrase meaning "not before DATE" yields `DATE` as a bank-debit matching
  anchor. It does not add one day and does not imply an exact settlement date.
- Merely identifying the payment method as a standing order does not create a
  date.
- The model extracts only printed information. Missing or unreadable values are
  `null` or an empty array.

The existing valid-year guard remains 2018-2030. Server-side normalization also
requires real ISO calendar dates, removes duplicates from both date arrays, and
sorts them chronologically. Invalid model values are discarded rather than
persisted.

## Deterministic matching-date selection

A pure helper derives `Receipt.date` after extraction:

1. earliest valid `paymentDates` entry;
2. otherwise earliest valid `bankDebitDates` entry;
3. otherwise `dueDate`;
4. otherwise `issueDate`;
5. otherwise `null`.

This precedence is application logic and must not be delegated to the model.
The OCR route derives the date once and copies it into each generated receipt
row.

Manual edits to `Receipt.date` continue to change the matching date only. They
do not rewrite the source fields, so the user can correct matching without
destroying what the document parser observed.

## Google Sheets persistence

The existing receipt tab uses columns A-O. Five additive columns are appended:

| Column | Header | Value |
|---|---|---|
| P | `תאריך הפקה` | ISO date or blank |
| Q | `תקופת חשבון` | trimmed printed period or blank |
| R | `מועד אחרון לתשלום` | ISO date or blank |
| S | `מועדי תשלום בפועל` | comma-separated ISO dates or blank |
| T | `מועדי חיוב בנק` | comma-separated ISO dates or blank |

`receiptToRow`, `rowToReceipt`, and all receipt ranges expand from A:O to A:T.
Old rows naturally return absent metadata. There is no bulk rewrite or model
backfill of historical data.

Existing spreadsheets already have headers, while `writeHeaders` currently
writes only an entirely empty header row. The setup path therefore performs an
additive header check:

- blank P1:T1 cells receive the five headers;
- an existing expected header is left unchanged;
- a nonblank conflicting value fails loudly instead of overwriting user data.

No existing A:O header or row value is changed during this schema extension.

## Receipt review and export UI

The existing editable `תאריך` label becomes **`תאריך התאמה`** wherever it
refers to `Receipt.date`, including the scan-results table, desktop receipt
table, mobile edit sheet, CSV header, and XLSX header.

The desktop receipt table shows the extracted source fields as read-only muted
lines below the existing matching-date input. The mobile edit sheet shows the
same read-only block immediately after its matching-date control. Missing
source fields are omitted rather than rendered as empty placeholders:

- `תאריך הפקה`
- `תקופת חשבון`
- `מועד אחרון לתשלום`
- `מועדי תשלום בפועל`
- `מועדי חיוב בנק`

The manual matching workbench shows the completed-payment dates and bank-debit
schedule beside the selected receipt's matching date, so split matching can be
checked against the source dates without leaving the workbench. The scan-results
table only relabels its existing date column; it does not grow five additional
columns.

The editable matching-date input remains the primary field. Secondary details
use existing muted text and current responsive table/card patterns. This adds
no new color, font, radius, custom CSS, or UI dependency.

The free-text receipt search includes the new source fields. Period filtering
continues to use `Receipt.date`, because that is the selected matching anchor.

## Multi-payment and multi-debit documents

One source document may justify several expense lines through completed payments
or scheduled bank debits. The application must preserve all explicit transaction
anchors, but it must not invent installment amounts by dividing the document
total.

Automatic matching remains one receipt to one line and keeps the existing
amount tolerance. A full bill total therefore is not silently attached to one
partial installment.

`receiptLineDistance` calculates its day difference against the nearest unique
date in `[receipt.date, ...receipt.paymentDates, ...receipt.bankDebitDates]`.
This affects candidate ordering only; it does not relax automatic matching.

The manual workbench keeps its current exact-amount and related-name gates until
the user enables split mode. When split mode is enabled for a receipt with at
least two unique completed-payment or bank-debit dates, the candidate list also
admits a line when its name is related and its date is within the existing
three-day tolerance of any preserved transaction anchor, regardless of the
amount difference. "Show all" and free-text search retain their current
behavior. The user confirms each attachment, and the same receipt remains
available through the existing `keepAvailable` flow.

This keeps the uncertain financial decision with the user while making every
printed payment and debit anchor discoverable.

## Compatibility and failure handling

- Historical rows with only `date` behave exactly as they do today.
- A missing matching date remains visible in every period through the existing
  API fallback, allowing manual correction.
- Duplicate detection continues to use the canonical matching date.
- Invalid extracted date metadata does not fail the whole scan; it is dropped,
  and the precedence helper falls through to the next valid source.
- An invalid or conflicting receipt-sheet header fails the setup request with a
  generic production response; diagnostic detail stays in development logs.
- The two existing user records are not silently rewritten. Correcting stored
  production rows or rescanning them is a separate user-controlled action after
  deployment.

## Approved Hebrew strings proposed by this spec

These strings are part of the written spec review. Implementation must stop and
ask before introducing another Hebrew string for this feature.

| Purpose | String |
|---|---|
| Canonical editable date label | `תאריך התאמה` |
| Source issue-date label and sheet header | `תאריך הפקה` |
| Billing-period label and sheet header | `תקופת חשבון` |
| Due-date label and sheet header | `מועד אחרון לתשלום` |
| Completed-payment label and sheet header | `מועדי תשלום בפועל` |
| Bank-debit label and sheet header | `מועדי חיוב בנק` |

## Scope by module

- `lib/types.ts`: optional receipt metadata and five sheet headers.
- `lib/ai.ts`: expanded response schema and extraction instructions; remove the
  model-selected generic date.
- `lib/receipt-dates.ts`: validate extracted values, derive the matching date,
  and expose the date set used for candidate distance.
- `app/api/ocr/route.ts`: map extracted facts into each receipt row.
- `lib/google.ts`: additive P:T persistence and header compatibility handling.
- `lib/match.ts`: calculate receipt date distance against all preserved payment
  and debit anchors for manual multi-transaction review.
- `components/ReceiptTable.tsx` and `components/UploadZone.tsx`: relabel the
  matching date and expose source metadata using existing primitives.
- `components/report/MatchWorkbench.tsx`: display payment and debit dates and
  apply the explicit split-mode candidate exception.
- receipt CSV/XLSX exports: include the five new source columns and rename the
  canonical date column.
- `ARCHITECTURE.md`: update the authoritative receipt schema and matching-date
  invariant.

Exact task boundaries and commit splits belong in the implementation plan.

## Verification

Repository gates:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- repository search for stale receipt ranges ending at column O
- repository search confirming the model no longer selects a generic receipt
  date
- repository search confirming no Docling or other conversion dependency was
  added

Runtime and visible behavior are handed to the user:

1. Scan the municipal sample: total remains `1357.14`, matching date is
   `2026-07-15`, and both July and August debit anchors are visible and saved.
2. Scan the telecommunications sample: total remains `150.27`, matching date is
   `2026-06-05`, the issue date remains distinct, and the bank-debit date is not
   duplicated as a payment deadline.
3. Scan an ordinary point-of-sale receipt: its printed date remains the matching
   date and no recurring-bill metadata is invented.
4. Scan the validated invoice-receipt: total remains `450.00`, issue date is
   `2026-07-30`, completed-payment date and matching date are `2026-07-07`, and
   no scheduled bank debit is invented.
5. Open a spreadsheet created before this feature: all existing rows load, P:T
   headers are added without changing A:O, and old rows remain editable.
6. Filter the receipts and report wizard by period: each sample appears under
   the period selected by its matching date.
7. Open the municipal bill in the manual matching workbench: candidates near
   both preserved debit dates are discoverable, and split mode can attach the
   document to two confirmed expense lines.
8. Edit only `תאריך התאמה`: matching and filtering follow the edit while the
   extracted source dates remain unchanged.

Passing build, typecheck, and lint establishes static correctness only. The
feature is not considered runtime-verified until the user confirms the checks
above against the stated expectations.

## Out of scope

- Docling, AnyDoc, OCR services, or another PDF-to-Markdown preprocessing layer.
- Foreign-currency extraction and conversion.
- Automatic division of a bill total into installment amounts.
- Automatic one-to-many receipt attachment without user confirmation.
- Model/provider replacement or benchmarking beyond the completed preprocessing
  comparison.
- Gmail receipt import.
- Salary-slip matching.
- Receipt-summary counter corrections.
- Automatic backfill or mutation of historical production receipts.
