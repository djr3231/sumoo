import type { BankTxn, Receipt } from "./types";

export interface MatchResult {
  matched: Array<{ receipt: Receipt; txn: BankTxn }>;
  missingReceipts: BankTxn[];
  unmatchedReceipts: Receipt[];
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(da - db) / 86_400_000;
}

function levenshtein(a: string, b: string): number {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function similarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const x = a.toLowerCase().replace(/\s+/g, " ").trim();
  const y = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const dist = levenshtein(x, y);
  const maxLen = Math.max(x.length, y.length);
  return 1 - dist / maxLen;
}

export function matchTxnsToReceipts(
  txns: BankTxn[],
  receipts: Receipt[],
  opts: { amountTolerancePct?: number; daysTolerance?: number } = {},
): MatchResult {
  const amountTolerancePct = opts.amountTolerancePct ?? 0.005;
  const daysTolerance = opts.daysTolerance ?? 3;

  const usedReceipts = new Set<string>();
  const matched: MatchResult["matched"] = [];
  const missingReceipts: BankTxn[] = [];

  for (const txn of txns) {
    if (txn.amount === null || !txn.date) {
      missingReceipts.push(txn);
      continue;
    }
    const txnAbs = Math.abs(txn.amount);

    let best: { receipt: Receipt; score: number } | null = null;
    for (const r of receipts) {
      if (usedReceipts.has(r.id)) continue;
      if (r.amount === null || !r.date) continue;
      const rAbs = Math.abs(r.amount);
      const amountDiff = Math.abs(txnAbs - rAbs) / Math.max(txnAbs, 1);
      if (amountDiff > amountTolerancePct) continue;
      const dDiff = daysBetween(txn.date, r.date);
      if (dDiff > daysTolerance) continue;

      const sim = similarity(txn.description, r.storeName);
      const score = 1 - amountDiff - dDiff * 0.05 + sim * 0.3;
      if (!best || score > best.score) best = { receipt: r, score };
    }

    if (best) {
      usedReceipts.add(best.receipt.id);
      matched.push({ receipt: best.receipt, txn: { ...txn, receiptId: best.receipt.id, status: "תואם" } });
    } else {
      missingReceipts.push({ ...txn, status: "חסרה קבלה" });
    }
  }

  const unmatchedReceipts = receipts.filter((r) => !usedReceipts.has(r.id));
  return { matched, missingReceipts, unmatchedReceipts };
}

export interface ReceiptLineMatch {
  byLine: Array<Receipt | null>; // best receipt per input line (aligned by index)
  unmatchedReceipts: Receipt[]; // receipts that matched no line (cash / unmatched)
}

export interface UnmatchedDiagnostic {
  receiptId: string;
  // "missing-fields": the receipt itself lacks an amount or date, so it can never
  // gate-match. "no-candidate": it has both but no line passed the gates.
  reason: "missing-fields" | "no-candidate";
  nearest: {
    lineIndex: number;
    amountDiffPct: number; // |line−receipt| / max(|line|, 1)
    daysDiff: number;
    lineHasReceipt: boolean; // the closest line was already taken by another receipt
  } | null;
}

// For receipts that matched no line, explain WHY: find the single closest line
// (ignoring the gates) and report the amount/date gaps. This is a diagnostic —
// it applies no tolerance, it just answers "what was nearest, and by how much".
export function diagnoseUnmatched(
  lines: Array<{
    date?: string | null;
    amount: number | null;
    description: string | null;
    receipt?: string | null;
  }>,
  unmatched: Receipt[],
): UnmatchedDiagnostic[] {
  return unmatched.map((r) => {
    if (r.amount === null || !r.date) {
      return { receiptId: r.id, reason: "missing-fields", nearest: null };
    }
    const rAbs = Math.abs(r.amount);
    let best: { lineIndex: number; amountDiffPct: number; daysDiff: number; score: number } | null =
      null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.amount === null || !line.date) continue;
      const amountDiffPct = Math.abs(Math.abs(line.amount) - rAbs) / Math.max(rAbs, 1);
      const daysDiff = daysBetween(line.date, r.date);
      const score = amountDiffPct + daysDiff * 0.05;
      if (!best || score < best.score) best = { lineIndex: i, amountDiffPct, daysDiff, score };
    }
    if (!best) return { receiptId: r.id, reason: "no-candidate", nearest: null };
    return {
      receiptId: r.id,
      reason: "no-candidate",
      nearest: {
        lineIndex: best.lineIndex,
        amountDiffPct: best.amountDiffPct,
        daysDiff: best.daysDiff,
        lineHasReceipt: Boolean(lines[best.lineIndex].receipt),
      },
    };
  });
}

// Attach receipts to expense LINES (amount ±tol, date ±days, fuzzy name). Each
// receipt is used at most once. Returns the best receipt per line (or null) and
// the receipts left over — the cash-purchase / unmatched-credit candidates.
export function matchReceiptsToLines(
  lines: Array<{
    date?: string | null;
    amount: number | null;
    description: string | null;
  }>,
  receipts: Receipt[],
  opts: { amountTolerancePct?: number; daysTolerance?: number } = {},
): ReceiptLineMatch {
  const amountTolerancePct = opts.amountTolerancePct ?? 0.005;
  const daysTolerance = opts.daysTolerance ?? 3;
  const used = new Set<string>();
  const byLine: Array<Receipt | null> = lines.map(() => null);

  lines.forEach((line, i) => {
    if (line.amount === null || !line.date) return;
    const lineAbs = Math.abs(line.amount);
    let best: { receipt: Receipt; score: number } | null = null;
    for (const r of receipts) {
      if (used.has(r.id) || r.amount === null || !r.date) continue;
      const amountDiff = Math.abs(lineAbs - Math.abs(r.amount)) / Math.max(lineAbs, 1);
      if (amountDiff > amountTolerancePct) continue;
      const dDiff = daysBetween(line.date, r.date);
      if (dDiff > daysTolerance) continue;
      const sim = similarity(line.description, r.storeName);
      const score = 1 - amountDiff - dDiff * 0.05 + sim * 0.3;
      if (!best || score > best.score) best = { receipt: r, score };
    }
    if (best) {
      used.add(best.receipt.id);
      byLine[i] = best.receipt;
    }
  });

  return { byLine, unmatchedReceipts: receipts.filter((r) => !used.has(r.id)) };
}

// ----------------------------------------------------------------------------
// Candidate suggestions ("amount is king", user decision 2026-07-05)
// ----------------------------------------------------------------------------

// A line is only worth OFFERING for a receipt when the amount is exactly equal
// (float-safe to the agora) — a different amount ≈ not this invoice. The date
// may lag (bank capture); it only orders candidates. An unrelated store name
// disqualifies a line entirely.
export const AMOUNT_EXACT_TOL = 0.005;
export const NAME_SIMILARITY_MIN = 0.5;

export interface CandidateDistance {
  amountDiff: number;
  daysDiff: number;
  sameAmount: boolean;
  nameRelated: boolean;
}

// Null when either side lacks an amount or a date — such lines can only appear
// in the "show all" view, sorted last.
export function receiptLineDistance(
  line: { date?: string | null; amount: number | null; description: string | null },
  r: Receipt,
): CandidateDistance | null {
  if (r.amount === null || !r.date || line.amount === null || !line.date) return null;
  const amountDiff = Math.abs(Math.abs(line.amount) - Math.abs(r.amount));
  return {
    amountDiff,
    daysDiff: daysBetween(line.date, r.date),
    sameAmount: amountDiff <= AMOUNT_EXACT_TOL,
    nameRelated: similarity(line.description, r.storeName) >= NAME_SIMILARITY_MIN,
  };
}

// Lexicographic ordering: nulls last; same-amount lines first, ordered by day
// gap; all other lines after, ordered by amount gap (day gap breaks ties).
export function compareCandidates(
  a: CandidateDistance | null,
  b: CandidateDistance | null,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.sameAmount !== b.sameAmount) return a.sameAmount ? -1 : 1;
  if (a.sameAmount) return a.daysDiff - b.daysDiff;
  return a.amountDiff - b.amountDiff || a.daysDiff - b.daysDiff;
}
