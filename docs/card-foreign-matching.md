# Card ↔ Bank reconciliation, and how foreign charges get their ₪

This explains how the insolvency report reconciles **Isracard Direct (דיירקט)
card charges** against the **bank (עו"ש) settlement lines**, with a focus on the
question: *how does a foreign‑currency card charge (e.g. `$20 CLAUDE`) get matched
to the generic bank "currency conversion" (`קיזוז מטח`) line, when neither the
name nor the ₪ amount is the same?*

Short answer: **the match key is the foreign amount** (the `20`), which appears in
BOTH places — once as the card row's billed amount, and once buried inside the
bank line's description text. Not the name, not the ₪.

---

## 1. The pipeline

`lib/report/process.ts` orchestrates one period run:

1. **Parse** each uploaded file → `parseCardXLSX` (card) and `parseXLSX` (bank).
2. **Reconcile** → `reconcile()` in `lib/report/reconcile.ts` (the core logic).
3. **Classify** each expense into a government category (`classifyExpenses`).

The card lines come from the card file; the bank `ישראכרט-דיירקט`/`קיזוז` lines are
**only used as a checksum**, never as expenses (otherwise every charge would be
double‑counted).

---

## 2. Parsing the card XLSX — `lib/parsers.ts` → `parseCardXLSX`

The Isracard card export has reliable per‑charge columns, matched by name:

| Field (`CardCharge`) | Column key | Meaning |
|---|---|---|
| `settlementDate` | `חיוב בחשבון הבנק` | the date it posted to the bank |
| `amount` | `סכום חיוב` | the ₪ billed — **but for a foreign row this is the foreign amount** |
| `transactionDate` | `תאריך עסקה` / `תאריך רכישה` | used to attribute the month |
| `merchant` | `שם בית עסק` | merchant name |
| `currency` | `מטבע` | `₪` / `USD` / `EUR` … — marks a row as foreign |

`findCardHeaderRow` locates the real charges table (a row that has both a
`חיוב…בנק` and a `סכום חיוב` header), which skips the `עסקאות שטרם נקלטו`
(not‑yet‑captured) section.

### ⚠ The currency column is the weak link
Every column above is matched loosely (`colIndexByKeys` uses `includes`) **except
`מטבע`, which is matched exactly**:

```ts
// lib/parsers.ts
let currencyCol = headers.findIndex(
  (h, idx) => normalizeKey(h) === "מטבע" && idx > ilsCol,
);
if (currencyCol === -1) {
  currencyCol = headers.findIndex((h) => normalizeKey(h) === "מטבע");
}
```

If the real header isn't *literally* `מטבע` (e.g. `מטבע עסקה`, `מטבע חיוב`,
`סוג מטבע`, or a merged/blank cell), `currencyCol` stays `-1`, so **`currency`
comes back `null` on every row.** When that happens the foreign match in §4 never
runs — which is exactly why foreign rows still display the `$` amount (`CLAUDE 20`,
`ANTHROPIC 6`, `HETZNER 1.71`). **This is the prime suspect for the current bug.**

---

## 3. Settlement‑date cut‑off (included vs. `ממתין לאישור`)

Bank settlements post 1–3 days after the charge, so a card charge is included
only if it has **already** posted:

```ts
// lib/report/reconcile.ts
const settled =
  lastSettlementDate === null ||
  (c.settlementDate !== null && c.settlementDate <= lastSettlementDate);
```

`lastSettlementDate` = the latest date across all bank `ישראכרט-דיירקט` / `קיזוז`
lines. A charge whose `חיוב בחשבון הבנק` is after that date (or blank) goes to
**`pending` (`ממתין לאישור`)** instead of expenses. This part is working — it is
what correctly pushes the not‑yet‑posted 07‑file charges out of the report.

---

## 4. The foreign match (the actual question)

### On the bank side
A foreign charge settles as one or two `קיזוז מטח` lines:

```
קיזוז מטח או שח/קרן/USD/20/ILS/58.92/2.94      amount = -58.92 ₪   (principal / קרן)
קיזוז מטח או שח/עמלות/20260612                  amount = -0.70  ₪   (fee / עמלות, OPTIONAL)
```

The **foreign amount (`20`) lives inside the description string**, not in the
amount field. A regex digs it out:

```ts
// lib/report/reconcile.ts
const FOREX_PRINCIPAL_RE = /קרן\/([A-Za-z]{3})\/([\d.]+)\/ILS\/([\d.]+)/;
//   captures:                   ↑ currency   ↑ foreign   ↑ ₪
```

So the `קרן` line becomes `{ currency: "USD", foreignAmount: 20, ils: 58.92 }` and
is pushed to `forexPrincipals`. A `עמלות` line (no `קרן`, so the regex misses) is
pushed to `forexFees`, then attached to its principal by matching settlement date:

```ts
for (const p of forexPrincipals) {
  const fee = forexFees.find((f) => !f.used && f.date === p.date);
  if (fee) { fee.used = true; p.ils += fee.ils; }   // 58.92 + 0.70 = 59.62
}
```

### On the card side
For a foreign row, `parseCardXLSX` puts the **foreign** number into `amount`
(`20`), and the currency into `currency` (`USD`/`$`).

### The join
```ts
let amount = c.amount ?? 0;                       // 20
if (isForeignCurrency(c.currency)) {              // currency is not ₪/ILS/שח…
  const p = forexPrincipals.find(
    (pp) => !pp.matched && approxEqual(pp.foreignAmount, Math.abs(amount), 0.5),
  );                                              // 20 ≈ 20  → match
  if (p) { p.matched = true; amount = p.ils; }    // swap 20 → 59.62 ₪
}
```

So the two `20`s are the join key: one read from the card's amount field, one
parsed out of the bank line's text. The ₪ (`ils`, principal + fee) is the
**result**, not the key. The name is never used. `approxEqual` allows a 0.5 (or
0.5%) tolerance; `!pp.matched` means each bank principal is consumed once.

---

## 5. Known weaknesses (worth scrutiny)

1. **Gated on `currency` being detected.** If §2's currency column isn't read,
   `isForeignCurrency` is false and the whole swap is skipped → foreign keeps the
   `$` amount. *(Current bug.)*
2. **Amount‑only match.** Two different `$20` charges → two `USD/20` bank lines →
   matched greedily by array order. Their ₪ are usually close, so it rarely
   misassigns, but it isn't identity‑precise. A stronger key would be
   `currency + foreignAmount` together.
3. **Requires the `/קרן/CUR/amount/ILS/ils/` shape.** A differently formatted
   `קיזוז` line won't parse, so its ₪ won't attach.
4. **Small charges may have no `עמלות` line.** The code already handles this — the
   fee is optional (`if (fee)`), so a fee‑less foreign charge still resolves to
   just the principal ₪. This should NOT contribute to the gap.

---

## 6. Where to look

| What | File | Anchor |
|---|---|---|
| Card parsing + currency column | `lib/parsers.ts` | `parseCardXLSX`, `currencyCol` |
| Foreign regex | `lib/report/reconcile.ts` | `FOREX_PRINCIPAL_RE` |
| Collecting bank forex lines | `lib/report/reconcile.ts` | `forexPrincipals.push`, `forexFees.push` |
| Fee → principal merge | `lib/report/reconcile.ts` | the `for (const p of forexPrincipals)` loop |
| The join / ₪ swap | `lib/report/reconcile.ts` | `isForeignCurrency`, `forexPrincipals.find` |
| Settlement cut‑off | `lib/report/reconcile.ts` | `const settled = …` |
| Checksum (card detail vs bank aggregate) | `lib/report/reconcile.ts` | `directDetailSum`, `directAggregateSum` |
