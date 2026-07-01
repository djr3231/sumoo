import {
  GOV_INCOME_CATEGORY,
  type BankTxn,
  type GovIncomeCategory,
  type ReportPeriod,
} from "@/lib/types";
import type { SalarySlip } from "@/lib/ai";
import type { CardCharge } from "@/lib/parsers";

// ----------------------------------------------------------------------------
// Output shapes
// ----------------------------------------------------------------------------

// An expense line, NOT yet mapped to a government category — Step 5 (classify)
// assigns the GOV_EXPENSE_CATEGORY and sums.
export interface ExpenseItem {
  month: number; // report month (one of the period's two months)
  amount: number; // ₪ expense (always positive; refunds are credits, not negatives)
  description: string;
  source: "direct" | "checking";
  date?: string; // purchase date (card transaction / bank txn) — for receipt matching
  receipt?: string; // attached receipt label (filename), set in the receipts step
}

// Income is determinable by source, so it is categorized here.
export interface IncomeItem {
  month: number;
  amount: number;
  category: GovIncomeCategory;
  source: string;
}

// העברה/<name> credits — surfaced for the user's per-transfer include/exclude.
export interface TransferItem {
  month: number;
  amount: number;
  name: string;
  description: string;
}

// Any other positive checking line we couldn't classify — surfaced, default
// excluded from income, so nothing slips silently into the totals.
export interface ReviewCredit {
  month: number;
  amount: number;
  description: string;
  // "direct" = a card refund (part of the card detail — subtracted in the card
  // gap); "checking" = a bank credit (transfer/other) awaiting the user's routing.
  source: "direct" | "checking";
}

// An expense/refund pair that cancels out — kept out of the totals and shown
// in the "לא ייכלל בחישוב" section.
export interface ExcludedItem {
  month: number;
  amount: number; // signed
  description: string;
  source: "direct" | "checking";
  reason: "refund-pair";
}

// Total cash withdrawn per report month — a control figure (justified later by
// cash receipts), not itself a report row.
export interface CashWithdrawal {
  month: number;
  amount: number;
}

// Bank-credit salary vs the matching slip net (Decision: bank is primary).
export interface SalaryCrossCheck {
  month: number; // deposit month = report column
  bankNet: number;
  slipNet: number | null;
  employer: string | null;
  matches: boolean;
}

export interface ReconcileResult {
  expenseItems: ExpenseItem[];
  income: IncomeItem[];
  transfers: TransferItem[];
  reviewCredits: ReviewCredit[];
  excluded: ExcludedItem[];
  pending: ExpenseItem[];
  cashWithdrawals: CashWithdrawal[];
  salaryCrossChecks: SalaryCrossCheck[];
  checksum: { directDetailSum: number; directAggregateSum: number };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function monthOf(date: string | null): number | null {
  if (!date) return null;
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(date);
  return m ? Number(m[1]) : null;
}

function dayOf(date: string | null): number | null {
  if (!date) return null;
  const m = /^\d{4}-\d{2}-(\d{2})/.exec(date);
  return m ? Number(m[1]) : null;
}

// Salaries deposited late in a month (>= this day) are an early payment for the
// NEXT month and count as next month's income; earlier deposits count as the
// deposit month's income. See INSOLVENCY domain note on pay-timing.
const SALARY_LATE_DAY = 20;
function salaryIncomeMonth(date: string | null): number | null {
  const m = monthOf(date);
  const d = dayOf(date);
  if (m === null || d === null) return null;
  return d >= SALARY_LATE_DAY ? (m % 12) + 1 : m;
}

function approxEqual(a: number, b: number, tol = 1): boolean {
  return Math.abs(a - b) <= Math.max(tol, 0.005 * Math.max(Math.abs(a), Math.abs(b)));
}

// The work/eligibility month for a salary counted as `incomeMonth` income
// (the worked month is the month before; wraps Jan -> Dec).
function workMonthFor(incomeMonth: number): number {
  return ((incomeMonth - 2 + 12) % 12) + 1;
}

// עו"ש line-family matchers (spec §2.2). Matched against `תיאור פעולה`.
const isDirectAggregate = (d: string) => /ישראכרט.{0,3}דיירקט/.test(d);
const isCashWithdrawal = (d: string) => /משיכה.*בנקט/.test(d);
const isSalaryCredit = (d: string) => /משכורת/.test(d);
const isChildAllowance = (d: string) => /קצבת\s*ילדים/.test(d);
const isTransfer = (d: string) => /^\s*העברה/.test(d);
// Foreign-currency card settlement lines (קיזוז מטח). Like ישראכרט-דיירקט they
// are a bank-side settlement. A $/€ charge settles as a "קרן" (principal ₪)
// line plus an optional "עמלות" (fee ₪) line; the card row only has the foreign
// amount, so its ₪ comes from here.
const isForexSettlement = (d: string) => /קיזוז\s*מטח/.test(d);
const isForexFee = (d: string) => /עמלות|עמלה/.test(d);
// "קיזוז מטח או שח/קרן/USD/20/ILS/58.92/2.94" -> ["USD", "20", "58.92"]
const FOREX_PRINCIPAL_RE = /קרן\/([A-Za-z]{3})\/([\d.]+)\/ILS\/([\d.]+)/;
// The card's מטבע cell marks a row as foreign-currency (not ₪/ILS).
const isForeignCurrency = (c: string | null) =>
  c != null && c.trim() !== "" && !/₪|ils|שח|שקל|nis/i.test(c);

function transferName(d: string): string {
  const m = /העברה[\s/:.\-]+(.+)/.exec(d);
  return m ? m[1].trim() : "";
}

// Normalize an employer/description for matching: keep Hebrew letters only and
// collapse runs of the same letter, so "עיריית"/"עירית" and "מופ\"ת"/"מופת" match.
function normEmployer(s: string): string {
  return s.replace(/[^א-ת]/g, "").replace(/(.)\1+/g, "$1");
}

// Two descriptions are "similar" if one normalized form contains the other, or
// they share a token of length >= 3 — used for expense↔refund pairing.
function descSimilar(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[^א-תa-zA-Z]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  const tokens = (s: string) =>
    s.split(/[\s/]+/).map(norm).filter((t) => t.length >= 3);
  const sb = new Set(tokens(b));
  return tokens(a).some((t) => sb.has(t));
}

// The user uploads several overlapping statements (a charge can appear as a
// not-yet-final "עסקאות למועד חיוב" line in one sheet and finalized with a bank
// settlement date in another). De-dup by the unique voucher (מס' שובר), keeping
// the instance that carries a settlement date. Charges without a voucher can't be
// de-duped, so they are all kept.
function dedupCardCharges(charges: CardCharge[]): CardCharge[] {
  const byVoucher = new Map<string, CardCharge>();
  const noVoucher: CardCharge[] = [];
  for (const c of charges) {
    const v = c.voucher?.trim();
    if (!v) {
      noVoucher.push(c);
      continue;
    }
    const existing = byVoucher.get(v);
    if (!existing || (existing.settlementDate === null && c.settlementDate !== null)) {
      byVoucher.set(v, c);
    }
  }
  return [...byVoucher.values(), ...noVoucher];
}

// ----------------------------------------------------------------------------
// Reconcile
// ----------------------------------------------------------------------------

export function reconcile(input: {
  period: ReportPeriod;
  checkingTxns: BankTxn[];
  directCharges: CardCharge[];
  salarySlips: SalarySlip[];
}): ReconcileResult {
  const months = [input.period.month1, input.period.month2];
  const inPeriod = (m: number | null): m is number =>
    m !== null && months.includes(m);

  const expenseItems: ExpenseItem[] = [];
  const pending: ExpenseItem[] = [];
  const income: IncomeItem[] = [];
  const transfers: TransferItem[] = [];
  const reviewCredits: ReviewCredit[] = [];
  const cashByMonth = new Map<number, number>();
  let directAggregateSum = 0;
  // Latest bank card-settlement date (ישראכרט-דיירקט / קיזוז). A card charge that
  // settles after this hasn't posted to the bank yet → pending, excluded.
  let lastSettlementDate: string | null = null;

  // Foreign settlements parsed from קיזוז lines, used to give foreign card
  // charges their ₪ amount.
  const forexPrincipals: Array<{
    currency: string;
    foreignAmount: number;
    ils: number;
    date: string | null;
    matched: boolean;
  }> = [];
  const forexFees: Array<{ ils: number; date: string | null; used: boolean }> = [];

  const bankSalaries: { month: number; amount: number; desc: string }[] = [];

  // --- Checking account (עו"ש) ---
  for (const t of input.checkingTxns) {
    const desc = (t.description ?? "").trim();
    const amt = t.amount ?? 0;

    // Salaries are attributed by income month (deposit-day rule), before the
    // period filter, so a late prior-month deposit still lands in this period.
    if (amt > 0 && isSalaryCredit(desc)) {
      const incMonth = salaryIncomeMonth(t.date);
      if (incMonth !== null && months.includes(incMonth)) {
        income.push({
          month: incMonth,
          amount: amt,
          category: GOV_INCOME_CATEGORY.Salary,
          source: desc,
        });
        bankSalaries.push({ month: incMonth, amount: amt, desc });
      }
      continue;
    }

    // Card settlements — domestic (ישראכרט-דיירקט) and foreign (קיזוז מטח): never
    // an income/expense of their own (the card detail carries the per-merchant ₪).
    // Debits (חובה, negative) add to the checksum aggregate; a card-origin credit
    // (זכות, positive — a refund the bank posts back) nets AGAINST it, so the
    // aggregate matches what the card detail nets to. Track the latest date.
    if (isDirectAggregate(desc) || isForexSettlement(desc)) {
      directAggregateSum += amt < 0 ? Math.abs(amt) : -Math.abs(amt);
      if (t.date && (lastSettlementDate === null || t.date > lastSettlementDate)) {
        lastSettlementDate = t.date;
      }
      if (amt < 0 && isForexSettlement(desc)) {
        const km = FOREX_PRINCIPAL_RE.exec(desc);
        if (km) {
          forexPrincipals.push({
            currency: km[1].toUpperCase(),
            foreignAmount: Number(km[2]),
            ils: Math.abs(amt),
            date: t.date,
            matched: false,
          });
        } else if (isForexFee(desc)) {
          forexFees.push({ ils: Math.abs(amt), date: t.date, used: false });
        }
      }
      continue;
    }

    const month = monthOf(t.date);
    if (!inPeriod(month)) continue;

    if (amt < 0) {
      const abs = Math.abs(amt);
      if (isCashWithdrawal(desc)) {
        cashByMonth.set(month, (cashByMonth.get(month) ?? 0) + abs);
        continue;
      }
      expenseItems.push({
        month,
        amount: abs,
        description: desc,
        source: "checking",
        date: t.date ?? undefined,
      });
    } else if (amt > 0) {
      if (isChildAllowance(desc)) {
        income.push({
          month,
          amount: amt,
          category: GOV_INCOME_CATEGORY.NationalInsurance,
          source: desc,
        });
      } else if (isTransfer(desc)) {
        transfers.push({ month, amount: amt, name: transferName(desc), description: desc });
      } else {
        reviewCredits.push({ month, amount: amt, description: desc, source: "checking" });
      }
    }
  }

  // Attach each forex fee to its principal (same settlement date).
  for (const p of forexPrincipals) {
    const fee = forexFees.find((f) => !f.used && f.date === p.date);
    if (fee) {
      fee.used = true;
      p.ils += fee.ils;
    }
  }

  // --- Direct card charges ---
  // The bank is the source of truth: attribute each charge to a report month by
  // its BANK posting date (חיוב בחשבון הבנק), falling back to the transaction date
  // only when the card table has no settlement column (the "עסקאות למועד חיוב"
  // table, billed on this cycle). Use the card's ₪ "סכום חיוב" (for a foreign-
  // currency row swap in the ₪ from the matching קיזוז). A charge that posts after
  // the bank statement's last date hasn't cleared yet → pending.
  let directDetailSum = 0;
  for (const c of dedupCardCharges(input.directCharges)) {
    const bankDate = c.settlementDate ?? c.transactionDate;
    const month = monthOf(bankDate);
    if (!inPeriod(month)) continue;

    let amount = c.amount ?? 0;
    if (isForeignCurrency(c.currency)) {
      const p = forexPrincipals.find(
        (pp) => !pp.matched && approxEqual(pp.foreignAmount, Math.abs(amount), 0.5),
      );
      if (p) {
        p.matched = true;
        amount = amount < 0 ? -p.ils : p.ils;
      }
    }

    const description = (c.merchant ?? "").trim();
    const settled =
      c.settlementDate === null ||
      (lastSettlementDate !== null && c.settlementDate <= lastSettlementDate);
    if (!settled) {
      pending.push({ month, amount, description, source: "direct" });
      continue;
    }
    // Keep the amount (incl. refunds) in the card-detail checksum, but never emit
    // a negative expense: a card credit (refund) is surfaced as a review credit
    // tagged "direct" so it can cancel a matching charge or be routed by the user.
    directDetailSum += amount;
    if (amount < 0) {
      reviewCredits.push({ month, amount: -amount, description, source: "direct" });
    } else {
      expenseItems.push({
        month,
        amount,
        description,
        source: "direct",
        date: c.transactionDate ?? c.settlementDate ?? undefined,
      });
    }
  }

  // --- Auto-cancel expense ↔ credit pairs (same amount + similar name) ---
  // A credit that exactly offsets a charge is a voided expense → drop both sides.
  const excluded: ExcludedItem[] = [];
  const usedExpense = new Set<number>();
  const usedReview = new Set<number>();
  const usedTransfer = new Set<number>();

  // (b) a review credit (card refund or bank credit) paired with a positive expense
  for (let i = 0; i < reviewCredits.length; i++) {
    const credit = reviewCredits[i];
    if (usedReview.has(i)) continue;
    for (let j = 0; j < expenseItems.length; j++) {
      const charge = expenseItems[j];
      if (usedExpense.has(j) || charge.amount <= 0) continue;
      if (
        approxEqual(charge.amount, credit.amount) &&
        descSimilar(charge.description, credit.description)
      ) {
        usedExpense.add(j);
        usedReview.add(i);
        excluded.push({ ...charge, reason: "refund-pair" });
        excluded.push({
          month: credit.month,
          amount: credit.amount,
          description: credit.description,
          source: credit.source,
          reason: "refund-pair",
        });
        break;
      }
    }
  }

  // (c) a transfer credit (refund that arrived as העברה/) vs a positive expense
  for (let i = 0; i < transfers.length; i++) {
    const t = transfers[i];
    if (usedTransfer.has(i)) continue;
    for (let j = 0; j < expenseItems.length; j++) {
      const charge = expenseItems[j];
      if (usedExpense.has(j) || charge.amount <= 0) continue;
      if (
        approxEqual(charge.amount, t.amount) &&
        descSimilar(charge.description, t.description)
      ) {
        usedExpense.add(j);
        usedTransfer.add(i);
        excluded.push({ ...charge, reason: "refund-pair" });
        excluded.push({
          month: t.month,
          amount: t.amount,
          description: t.description,
          source: "checking",
          reason: "refund-pair",
        });
        break;
      }
    }
  }

  const keptExpenses = expenseItems.filter((_, i) => !usedExpense.has(i));
  const keptReview = reviewCredits.filter((_, i) => !usedReview.has(i));
  const keptTransfers = transfers.filter((_, i) => !usedTransfer.has(i));

  // --- Cash withdrawals per report month ---
  const cashWithdrawals: CashWithdrawal[] = months.map((m) => ({
    month: m,
    amount: cashByMonth.get(m) ?? 0,
  }));

  // --- Salary cross-check: bank credit vs slip net ---
  // Pair a bank salary only with a slip whose employer actually corresponds to
  // it (never fall back to an unrelated slip of the same month). Normalize to
  // tolerate spelling variants (gershayim, double-yud, slashes).
  const salaryCrossChecks: SalaryCrossCheck[] = bankSalaries.map((bs) => {
    const work = workMonthFor(bs.month);
    const nd = normEmployer(bs.desc);
    const slip =
      input.salarySlips.find(
        (s) =>
          s.month === work &&
          s.employer != null &&
          normEmployer(s.employer).length > 0 &&
          nd.includes(normEmployer(s.employer)),
      ) ?? null;
    const slipNet = slip?.net ?? null;
    return {
      month: bs.month,
      bankNet: bs.amount,
      slipNet,
      employer: slip?.employer ?? null,
      matches: slipNet !== null && approxEqual(bs.amount, slipNet),
    };
  });

  return {
    expenseItems: keptExpenses,
    income,
    transfers: keptTransfers,
    reviewCredits: keptReview,
    excluded,
    pending,
    cashWithdrawals,
    salaryCrossChecks,
    checksum: { directDetailSum, directAggregateSum },
  };
}
