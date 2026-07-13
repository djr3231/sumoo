// Pure category rollup for wizard step 6. Turns the wizard's decision state
// (live expenses + inclusion/routing maps) into the per-month figures written
// to the working sheet and the government report. Client-safe (no I/O) — the
// step-6 preview and the /api/report/generate route share this single source
// of truth, so what the user previews is exactly what gets written.
import {
  GOV_EXPENSE_CATEGORIES,
  GOV_EXPENSE_CATEGORY,
  GOV_INCOME_CATEGORIES,
  formatFoodCategory,
  type GovExpenseCategory,
  type GovIncomeCategory,
} from "@/lib/types";
import type { CategorizedExpense } from "@/lib/report/process";
import type {
  IncomeItem,
  ReviewCredit,
  TransferItem,
} from "@/lib/report/reconcile";

// Label for the income continuation row holding included family transfers +
// credits the user routed to income (no fixed gov row fits them; user-approved).
export const OTHER_INCOME_LABEL = "העברות ואחר";

export interface RollupInput {
  months: [number, number];
  expenses: CategorizedExpense[];
  income: IncomeItem[];
  transfers: TransferItem[];
  reviewCredits: ReviewCredit[];
  // Same semantics as the wizard state: absent expense/income key = included;
  // absent transfer key = excluded; absent credit key = excluded.
  expenseIncluded: Record<string, boolean>;
  incomeIncluded: Record<string, boolean>;
  transferInclude: Record<string, boolean>;
  creditRoute: Record<string, "income" | "expense" | "exclude">;
  householdSize: number;
}

// One working-sheet row, in the exact column order of the חיובים דיירקט tab.
export interface WorkingRow {
  merchant: string;
  amount: number;
  currency: string; // always "₪" — bank truth (see docs/reconciliation-source-of-truth.md)
  note: string;
  date: string; // DD/MM/YYYY or ""
  categoryLabel: string; // Food carries the household size
  receipt: string; // receipt fileName or "-"
}

export interface ReportRollup {
  months: [number, number];
  householdSize: number;
  incomeByCategory: Record<GovIncomeCategory, [number, number]>;
  otherIncome: [number, number];
  expenseByCategory: Record<GovExpenseCategory, [number, number]>;
  incomeTotals: [number, number];
  expenseTotals: [number, number];
  foodBreakdown: [FoodLine[], FoodLine[]];
  workingRows: WorkingRow[];
}

export interface FoodLine {
  date: string; // DD/MM/YYYY or ""
  amount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ddmmyyyy = (iso?: string) =>
  iso ? iso.split("-").reverse().join("/") : "";

export function buildReportRollup(input: RollupInput): ReportRollup {
  const { months, householdSize } = input;
  const monthIdx = (m: number): 0 | 1 | null =>
    m === months[0] ? 0 : m === months[1] ? 1 : null;
  const isExpenseIncluded = (id: string) => input.expenseIncluded[id] ?? true;
  const isIncomeIncluded = (id: string) => input.incomeIncluded[id] ?? true;
  const isTransferIncluded = (id: string) =>
    input.transferInclude[id] ?? false;

  const incomeByCategory = Object.fromEntries(
    GOV_INCOME_CATEGORIES.map((c) => [c, [0, 0]]),
  ) as Record<GovIncomeCategory, [number, number]>;
  for (const it of input.income) {
    const i = monthIdx(it.month);
    if (i === null || !isIncomeIncluded(it.lineId)) continue;
    incomeByCategory[it.category][i] += it.amount;
  }

  const otherIncome: [number, number] = [0, 0];
  for (const t of input.transfers) {
    const i = monthIdx(t.month);
    if (i === null || !isTransferIncluded(t.lineId)) continue;
    otherIncome[i] += t.amount;
  }
  for (const c of input.reviewCredits) {
    const i = monthIdx(c.month);
    if (i === null || input.creditRoute[c.lineId] !== "income") continue;
    otherIncome[i] += c.amount;
  }

  const expenseByCategory = Object.fromEntries(
    GOV_EXPENSE_CATEGORIES.map((c) => [c, [0, 0]]),
  ) as Record<GovExpenseCategory, [number, number]>;
  const included = input.expenses.filter((e) => isExpenseIncluded(e.lineId));
  for (const e of included) {
    const i = monthIdx(e.month);
    if (i === null) continue;
    expenseByCategory[e.category][i] += e.amount;
  }
  // Credits the user routed to "expense" are refunds: they reduce שונות so the
  // 23 category cells still sum to the on-screen expense total (user-approved).
  for (const c of input.reviewCredits) {
    const i = monthIdx(c.month);
    if (i === null || input.creditRoute[c.lineId] !== "expense") continue;
    expenseByCategory[GOV_EXPENSE_CATEGORY.Miscellaneous][i] -= c.amount;
  }

  const sum2 = (rec: Record<string, [number, number]>): [number, number] =>
    Object.values(rec).reduce<[number, number]>(
      (a, v) => [a[0] + v[0], a[1] + v[1]],
      [0, 0],
    );
  const incomeSums = sum2(incomeByCategory);
  const incomeTotals: [number, number] = [
    r2(incomeSums[0] + otherIncome[0]),
    r2(incomeSums[1] + otherIncome[1]),
  ];
  const expenseSums = sum2(expenseByCategory);
  const expenseTotals: [number, number] = [r2(expenseSums[0]), r2(expenseSums[1])];

  const foodBreakdown: [FoodLine[], FoodLine[]] = [[], []];
  for (const e of included) {
    const i = monthIdx(e.month);
    if (i === null || e.category !== GOV_EXPENSE_CATEGORY.Food) continue;
    foodBreakdown[i].push({ date: ddmmyyyy(e.date), amount: r2(e.amount) });
  }
  for (const list of foodBreakdown) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  const workingRows: WorkingRow[] = included
    .slice()
    .sort(
      (a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        a.description.localeCompare(b.description, "he"),
    )
    .map((e) => ({
      merchant: e.description,
      amount: r2(e.amount),
      currency: "₪",
      note: "",
      date: ddmmyyyy(e.date),
      categoryLabel:
        e.category === GOV_EXPENSE_CATEGORY.Food
          ? formatFoodCategory(householdSize)
          : e.category,
      receipt: e.receipt || "-",
    }));

  const round2All = (rec: Record<string, [number, number]>) => {
    for (const k of Object.keys(rec)) {
      rec[k] = [r2(rec[k][0]), r2(rec[k][1])];
    }
  };
  round2All(incomeByCategory);
  round2All(expenseByCategory);

  return {
    months,
    householdSize,
    incomeByCategory,
    otherIncome: [r2(otherIncome[0]), r2(otherIncome[1])],
    expenseByCategory,
    incomeTotals,
    expenseTotals,
    foodBreakdown,
    workingRows,
  };
}
