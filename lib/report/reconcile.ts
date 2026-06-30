import {
  GOV_INCOME_CATEGORY,
  type BankTxn,
  type GovIncomeCategory,
  type ReportPeriod,
} from "@/lib/types";
import type { SalarySlip } from "@/lib/ai";

// ----------------------------------------------------------------------------
// Output shapes
// ----------------------------------------------------------------------------

// An expense line, NOT yet mapped to a government category — Step 5 (classify)
// assigns the GOV_EXPENSE_CATEGORY and sums.
export interface ExpenseItem {
  month: number; // report month (one of the period's two months)
  amount: number; // ₪ expense (negative for a direct refund/credit)
  description: string;
  source: "direct" | "checking";
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
// Foreign-currency settlement lines (the ₪ value of $/€ card charges).
const isForexSettlement = (d: string) => /קיזוז\s*מטח/.test(d);

// Turn the cryptic forex line into a readable expense label.
// e.g. "קיזוז מטח או שח/קרן/USD/20/ILS/61.83/3.09" -> "חיוב מטבע חוץ USD 20".
function forexLabel(d: string): string {
  if (/עמלות|עמלה/.test(d)) return "עמלת מטבע חוץ";
  const m = /\/([A-Z]{3})\/([\d.]+)\/ILS/.exec(d);
  return m ? `חיוב מטבע חוץ ${m[1]} ${m[2]}` : "חיוב מטבע חוץ";
}

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

// ----------------------------------------------------------------------------
// Reconcile
// ----------------------------------------------------------------------------

export function reconcile(input: {
  period: ReportPeriod;
  checkingTxns: BankTxn[];
  directCharges: BankTxn[];
  salarySlips: SalarySlip[];
}): ReconcileResult {
  const months = [input.period.month1, input.period.month2];
  const inPeriod = (m: number | null): m is number =>
    m !== null && months.includes(m);

  const expenseItems: ExpenseItem[] = [];
  const income: IncomeItem[] = [];
  const transfers: TransferItem[] = [];
  const reviewCredits: ReviewCredit[] = [];
  const cashByMonth = new Map<number, number>();
  let directAggregateSum = 0;

  const bankSalaries: { month: number; amount: number; desc: string }[] = [];

  // --- Checking account (עו"ש) ---
  for (const t of input.checkingTxns) {
    const desc = (t.description ?? "").trim();
    const amt = t.amount ?? 0;

    // Salaries are attributed by income month (deposit-day rule), which can
    // differ from the deposit month — handle before the period filter so a
    // salary deposited late in the prior month still lands in this period.
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

    // Direct-card settlement aggregates: never an expense; sum ALL of them
    // (regardless of period) as the card checksum vs the card detail.
    if (amt < 0 && isDirectAggregate(desc)) {
      directAggregateSum += Math.abs(amt);
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
      const label = isForexSettlement(desc) ? forexLabel(desc) : desc;
      expenseItems.push({ month, amount: abs, description: label, source: "checking" });
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
        reviewCredits.push({ month, amount: amt, description: desc });
      }
    }
  }

  // --- Direct card (דיירקט) merchant-level charges ---
  // Convention: positive = money spent, negative = refund/credit. The net sum
  // should tie out against the bank's ישראכרט-דיירקט settlements (checksum).
  let directDetailSum = 0;
  for (const c of input.directCharges) {
    const spent = c.amount ?? 0;
    directDetailSum += spent;
    const month = monthOf(c.date);
    if (!inPeriod(month)) continue;
    expenseItems.push({
      month,
      amount: spent,
      description: (c.description ?? "").trim(),
      source: "direct",
    });
  }

  // --- Auto-cancel expense ↔ refund pairs (same amount + similar name) ---
  const excluded: ExcludedItem[] = [];
  const usedExpense = new Set<number>();
  const usedReview = new Set<number>();

  // (a) a negative expense (direct refund) paired with a positive expense
  for (let i = 0; i < expenseItems.length; i++) {
    const refund = expenseItems[i];
    if (usedExpense.has(i) || refund.amount >= 0) continue;
    for (let j = 0; j < expenseItems.length; j++) {
      const charge = expenseItems[j];
      if (j === i || usedExpense.has(j) || charge.amount <= 0) continue;
      if (
        approxEqual(charge.amount, -refund.amount) &&
        descSimilar(charge.description, refund.description)
      ) {
        usedExpense.add(i);
        usedExpense.add(j);
        excluded.push({ ...charge, reason: "refund-pair" });
        excluded.push({ ...refund, reason: "refund-pair" });
        break;
      }
    }
  }

  // (b) a review credit (checking refund) paired with a positive expense
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
          source: "checking",
          reason: "refund-pair",
        });
        break;
      }
    }
  }

  const keptExpenses = expenseItems.filter((_, i) => !usedExpense.has(i));
  const keptReview = reviewCredits.filter((_, i) => !usedReview.has(i));

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
    transfers,
    reviewCredits: keptReview,
    excluded,
    cashWithdrawals,
    salaryCrossChecks,
    checksum: { directDetailSum, directAggregateSum },
  };
}
