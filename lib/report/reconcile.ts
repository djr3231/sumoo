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

function transferName(d: string): string {
  const m = /העברה[\s/:.\-]+(.+)/.exec(d);
  return m ? m[1].trim() : "";
}

// Normalize an employer/description for matching: keep Hebrew letters only and
// collapse runs of the same letter, so "עיריית"/"עירית" and "מופ\"ת"/"מופת" match.
function normEmployer(s: string): string {
  return s.replace(/[^א-ת]/g, "").replace(/(.)\1+/g, "$1");
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

    const month = monthOf(t.date);
    if (!inPeriod(month)) continue;

    if (amt < 0) {
      const abs = Math.abs(amt);
      if (isDirectAggregate(desc)) {
        directAggregateSum += abs; // dropped, kept only as checksum
        continue;
      }
      if (isCashWithdrawal(desc)) {
        cashByMonth.set(month, (cashByMonth.get(month) ?? 0) + abs);
        continue;
      }
      expenseItems.push({ month, amount: abs, description: desc, source: "checking" });
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
    expenseItems,
    income,
    transfers,
    reviewCredits,
    cashWithdrawals,
    salaryCrossChecks,
    checksum: { directDetailSum, directAggregateSum },
  };
}
