- קבלות מזומן in הכנת דוח דו-חודשי[התאם קבלות] need to show the sum of all founded receipts, and the current expense summary hows left without matched receipts (updated bt the state changes).
- Split and consolidated receipts: Each credit note represents and corresponds to a separate debit line on the card, for example, for the receipt approved up to 4,322.01, there are 4 credit notes of 1000 NIS each. If we have the original receipt, then each note is considered a duplicate. The 5 separate credit charges must be attached to the original receipt, even if it does not match the amount - because it is the source that explains the expense in the most detailed way. Sometimes the original receipt is not available - so the credit note saves the situation... and then we attach it to the charge instead of the non-existent receipt.

Another example: The payment of property taxes to the Harish Municipality is received in a bi-monthly document, but in practice the charge is split into a monthly charge, so the 2 periodic charges must be attached to the same receipt/invoice.

- MatchWorkbench candidate table is not responsive (reported 2026-07-05, with
  screenshots). The candidate list has too many columns (תאריך / תיאור / סכום /
  הפרש סכום / הפרש ימים / בחר) for the pane it lives in, so the table overflows
  horizontally: the horizontal scrollbar sits at the BOTTOM of the (max-h-96,
  overflow-y) scroll area, meaning the user must first scroll DOWN through all
  rows just to reach it and scroll RIGHT — unusable. This is inside the desktop
  workbench which now renders as an expansion row under the clicked receipt, so
  its usable width is a single table cell (colSpan), narrower than a full page.
  Options to weigh (do NOT just enable overflow-x — that reproduces the bug):
  drop/merge low-value columns in the narrow view (e.g. combine הפרש סכום +
  הפרש ימים into one "הפרש" cell, or hide them unless "הצג הכל"); switch the
  candidate list to the card/stacked layout the mobile cards already use once
  the container is narrow (container query, not viewport — it's an inline pane);
  or give the expansion row a wider, non-table layout entirely. Needs a real
  responsive design pass, not a one-line CSS patch.

- Persist & resume wizard progress (per-period Google Sheet): full execution plan at
  C:\Users\dajro\.claude\plans\swirling-noodling-lerdorf.md — run in a clean session
  with superpowers:subagent-driven-development. Scope: persistence + resume +
  non-destructive receipt merge only.
- step 4 ignores the manual "include in calc" checkbox: the matching table and the
  "X מתוך Y חיובים" counter (ReportWizard.tsx:1177, receiptView:497) iterate ALL
  expenses regardless of expenseIncluded, so an excluded line still nags for a receipt.
  Small isolated fix: filter expenseIncluded in receiptView + the counter.
- Currency/FX: Receipt has no currency field; a $20 Anthropic receipt is stored as ₪20
  and even corrected can't match the shekel charge by amount (same family as a
  post-discount mismatch, e.g. סימונה ₪81 vs charged ₪78.16). Needs currency capture at
  OCR + a match path that doesn't rely on amount equality for forex.
- Document type "זיכוי": credit confirmations (e.g. a LIME minus-charge already
  classified as an expense) surface as receipts awaiting matching. Add a doc type or
  "Credit (Other)" so they don't pollute the flow.
- Fix-receipt flow: correct a receipt's OCR name/amount from inside the wizard
  ("מעיין 200"→"מעיינות הטבע") instead of detouring to the receipts page.
- Auto-cancel refund pairing too strict: reconcile.ts requires BOTH ≈amount AND similar
  description; opaque הו"ק descriptions fail the name test so a genuinely offset charge
  stays a live expense demanding a receipt. Consider looser/configurable pairing for
  standing orders.
- Receipt↔Expense data model (the big one, 2026-07-05): two entities with N:M relations
  (one receipt ↔ many lines; a line ↔ non-"expense" docs אשראי/מזומן/הו"ק/זיכוי). Wanted
  before "taking the system outside"; precursor to a real DB (which the per-period
  progress store is deliberately designed to swap into).

- Classify-table perf follow-ups (2026-07-06): Fix #2 (commit 9f5f32c) extracted the
  step-2 EXPENSE rows into a React.memo'd ExpenseRow, so editing a row in a ~300-row
  report is now instant (was ~1900ms/keystroke) and "+ הוסף שורה" dropped 1534ms→~204ms.
  Remaining:
  (a) initial render of ~300 rows is still heavy when entering step 2 (one-time) —
  consider list virtualization (needs a lib, e.g. @tanstack/react-virtual — discuss
  before adding a dependency);
  (b) apply the same memoized-row extraction to the income / transfer / review-credit
  tables and the step-3 receipt table (all share the un-memoized inline .map pattern);
  (c) the step-3 receipt table also recomputes candidateCount() — O(receipts × expenses)
  via receiptLineDistance — on every render; memoize it (useMemo keyed on
  expenses/unmatchedReceipts);
  (d) "+ הוסף שורה" residual ~204ms/click (acceptable for now, tracked here).

- vercel show logs of:

```

# GET /robots.txt

Status: 404

## Request

Started: Jul 03 17:19:57.97 GMT+3

Request ID: kmqtz-1783088397971-a42c7b408434

Path: /robots.txt

Host: www.chewie.ceo

User Agent: Mozilla/5.0 (compatible; MJ12bot/v2.0.5; http://mj12bot.com/)

Received in Paris, France (cdg1)

Firewall Allowed

Routed to Washington, D.C., USA (iad1)

### Function Invocation

Route: / _not-found

Execution Duration / Maximum: 71ms / 5m

External APIs

No outgoing requests

### Fluid

275 MB

Response finished in 293ms

## Deployment Information

Deployment ID: dpl_G2xfKeaASuJfRWPCG6DRdmQk5PE9

Environment: production

Branch: main

# GET /.well-known/assetlinks.json

Status: 404

## Request

Started: Jul 03 17:19:46.25 GMT+3

Request ID: 2mmfc-1783088386253-f08dda22b0fa

Path: /.well-known/assetlinks.json

Host: www.chewie.ceo

User Agent: GoogleAssociationService

Received in Paris, France (cdg1)

Firewall Allowed

Routed to Washington, D.C., USA (iad1)

### Function Invocation

Route: / _not-found

Execution Duration / Maximum: 601ms / 5m

External APIs

No outgoing requests

### Fluid

267 MB

Response finished in 1s

## Deployment Information

Deployment ID: dpl_G2xfKeaASuJfRWPCG6DRdmQk5PE9

Environment: production

Branch: main
```

- vercel 5:50pm 07/07/2026
  ````(node:4) [DEP0169] DeprecationWarning:`url.parse()`behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for`url.parse()`vulnerabilities.
(Use`node --trace-deprecation ...` to show where the warning was created)
