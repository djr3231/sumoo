// Pure bi-monthly-period helpers — no I/O, so client components can import
// them. lib/report/period.ts is the I/O half (it creates the Drive folder
// tree); this module holds the calendar facts that both the report wizard and
// the receipts table need, so neither has to redeclare them.

export interface MonthPair {
  m1: number;
  m2: number;
}

// The six bi-monthly reporting periods of a year.
export const MONTH_PAIRS: readonly MonthPair[] = [
  { m1: 1, m2: 2 },
  { m1: 3, m2: 4 },
  { m1: 5, m2: 6 },
  { m1: 7, m2: 8 },
  { m1: 9, m2: 10 },
  { m1: 11, m2: 12 },
];

// Two-digit month label, e.g. 3 -> "03".
export const pad2 = (n: number) => String(n).padStart(2, "0");

// Month number from an ISO date (null-safe).
export function monthOfISO(d?: string | null): number | null {
  const m = d ? Number(d.slice(5, 7)) : NaN;
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : null;
}

// The period a given 1-12 month falls in.
export function monthPairOf(month: number): MonthPair {
  return MONTH_PAIRS[Math.floor((month - 1) / 2)];
}

export function currentMonthPair(now: Date = new Date()): MonthPair {
  return monthPairOf(now.getMonth() + 1);
}

// Inclusive ISO date range covering both months of a period. Day 0 of the
// month after m2 is the last day of m2, which handles February and leap years
// without a table.
export function periodDateRange(
  year: number,
  pair: MonthPair,
): { from: string; to: string } {
  const lastDay = new Date(year, pair.m2, 0).getDate();
  return {
    from: `${year}-${pad2(pair.m1)}-01`,
    to: `${year}-${pad2(pair.m2)}-${pad2(lastDay)}`,
  };
}

export function periodLabel(year: number, pair: MonthPair): string {
  return `${pad2(pair.m1)}-${pad2(pair.m2)}/${year}`;
}

export const CURRENT_YEAR = new Date().getFullYear();
export const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
