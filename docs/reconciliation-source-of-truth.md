# Reconciliation — the source-of-truth model (knowledge for the fix)

> Status: **knowledge base, not yet a plan.** This captures the user's confirmed
> mental model so we can design the fix from a stable, shared understanding. The
> current code contradicts parts of this (see §7). Nothing here is implemented
> yet — we plan the fix together after the user finishes reviewing the code.

---

## 1. The core principle

**The bank account (עו"ש) is the ONLY source of truth for the amount and the date
of every expense and income.**

- What is written in the bank statement happened. What is not written did not.
- The **credit-card statement is NOT a source of truth.** It is only the credit
  company's *confirmation of the orders it sent to the bank.* Anything that
  differs on the card side — a date lag, a currency conversion, a partial refusal
  or an adjustment made by the bank — is not our concern. The real event is the
  debit that actually posted to the account.
- Therefore the expense table must be an **accurate reflection of every bank
  debit**, with the credit-charge *groups* broken down so each individual expense
  is visible with its real business name.

## 2. What the card statement is for (its ONLY 3 jobs)

The card breakdown does **exactly three** things. It never sets the amount and
never sets the month.

1. **Split** a bank settlement group (one `ישראכרט-דיירקט` / `קיזוז` debit) into
   its individual charges.
2. **Name** each resulting expense line with the real business (`שם בית עסק`).
3. **Receipts** — help find a matching receipt per individual charge.

## 3. Determining the month

**Month = the date the action posted in the BANK account.** Not the card
transaction date.

- Exception: **salaries** are attributed by the salary month shown in the account
  (income side), not by the actual payment date. This is a separate area and is
  already handled — see the salary-timing notes.

## 4. Every bank action needs a source / justification

For the report, each bank line must be explainable with supporting evidence:

| Bank line type | Required source |
|---|---|
| Credit settlement (`ישראכרט-דיירקט` / `קיזוז`) | the card lines that make it up, then a receipt per card line |
| Bank transfer (`העברה…`) | an invoice or receipt **in the debtor's name** |
| Cash withdrawal (`משיכה…בנקט`) | receipts for cash purchases of a **close** amount — a little **less** is acceptable, **never more** |

## 5. Bank line families (what the עו"ש statement contains)

Matched against the `תיאור פעולה` text (see `lib/report/reconcile.ts`):

- `ישראכרט-דיירקט` — a **domestic** credit settlement debit (bundles several card
  charges from one or more days).
- `קיזוז מטח` — a **foreign** credit settlement. A `$`/`€` charge posts as a
  `קרן` (principal ₪) line and an **optional** `עמלות` (fee ₪) line. Small charges
  may have **no** fee line at all.
- `משכורת` — salary credit (income; attributed by salary month).
- `קצבת ילדים` — national-insurance child allowance (income).
- `העברה…` — a transfer (needs a debtor-named document).
- `משיכה…בנקט` — a cash (ATM) withdrawal.

## 6. The hard part — splitting a settlement debit back into card lines

This is the crux of the fix and the main design question to resolve.

- The bank's old system posts credit settlements in **irregular batches** (1–3
  business days after the charge). One debit **bundles** charges from different
  days; one day's charges can be **split across several** debits. So there is
  **no 1-to-1 date or amount mapping** between a bank debit and a card charge.
- The card statement carries the individual charges (XLSX has no group subtotals;
  the PDF has `סה"כ חיוב לתאריך <date>` subtotal lines, each equal to one bank
  settlement debit).
- The card XLSX also has a **`חיוב בחשבון הבנק`** column (the date the charge
  posted to the bank), which is the most reliable link between a card charge and
  the bank debit that settled it.
- **Open issue:** the ₪ figure on the card (`סכום חיוב`) can differ from what the
  bank actually took (rounding, FX, a bank-side change). Under §1 the **bank**
  amount wins. So splitting a bank debit into named lines must **preserve the bank
  total**, distributing it across the card lines that belong to that debit —
  the card supplies the names and the split, the bank supplies the money.

## 7. What the current code does (and why it's wrong under this model)

In `lib/report/reconcile.ts`, the direct-card loop currently:

- sets the month from the **card** `transactionDate` (`monthOf(c.transactionDate)`)
  — should be the **bank** settlement date;
- takes the amount from the **card** `סכום חיוב` — should be tied to the **bank**
  debit;
- for foreign rows, swaps in the ₪ from the matching `קיזוז` `קרן`(+`עמלות`) line
  by matching the foreign amount (see `docs/card-foreign-matching.md`) — right
  instinct (bank ₪ wins) but done as a special case rather than the general rule;
- treats the bank `ישראכרט-דיירקט` / `קיזוז` lines as a **checksum only** and
  emits the card lines as the expenses — inverted: the bank lines are the truth,
  the card lines are the *breakdown/labels* for them.

Net effect: amounts and months can drift from the bank reality, which is the
likely real cause of the reconciliation gap and the foreign-amount problems —
beyond the `מטבע`-column parsing bug already noted.

## 8. What the fixed behavior should produce

- Expense table = one row per **individual** expense, whose **amount and month
  come from the bank**, whose **name comes from the card** (for card settlements),
  and whose **sum per settlement group equals the bank debit exactly**.
- Non-card bank debits (transfers, cash, direct debits) appear as their own rows,
  each tagged with the source document it needs.
- Card charges that have **not yet posted** to the bank are excluded (they didn't
  happen yet) — the `ממתין לאישור` idea stays, but framed as "no bank line yet."

## 9. Open questions to settle before planning the fix

1. When a bank debit's total ≠ the sum of its card lines, how do we reconcile the
   difference — trust the bank total and show a small unexplained remainder, or
   attribute it to a specific line?
2. How do we group card charges to a specific bank debit — solely by
   `חיוב בחשבון הבנק` = bank debit date, or with amount corroboration?
3. What do we show when a bank settlement debit has **no** matching card lines yet
   (card file not uploaded / out of range)?
4. Foreign: keep the `קרן`+`עמלות` merge, but as part of the general
   split-the-bank-debit rule rather than a separate code path?

## 10. Related docs / memory

- `docs/card-foreign-matching.md` — current foreign-matching mechanics + the
  `מטבע`-column parsing bug.
- Memory: `direct-card-settlement`, `salary-benefit-timing`.
