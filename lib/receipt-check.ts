// "Did I already scan this receipt?" — the ranking behind /check.
//
// The app's duplicate story is otherwise post-hoc: /api/dedup is a manual batch
// pass over rows that are already in the sheet. This module answers the same
// question interactively, BEFORE anything is written, for a single freshly
// scanned receipt.
//
// Deliberately deterministic — no LLM. It reuses the ranking primitives that
// already back the report's manual match workbench, so "amount is king"
// (user decision 2026-07-05) holds identically on both screens.

import {
  compareCandidates,
  receiptLineDistance,
  type CandidateDistance,
} from "./match";
import { DOCUMENT_TYPE, type Receipt } from "./types";

// A same-amount hit whose date drifts by more than this is a different
// purchase, not this document. Bank capture lag does not apply here: both
// sides are receipts, read off the paper itself.
export const MATCH_DAYS_TOL = 1;

export const CANDIDATE_COUNT = 3;

export interface ScoredReceipt {
  receipt: Receipt;
  distance: CandidateDistance;
}

export type CheckOutcome =
  // Confident hit. `candidates` are the runners-up with the match itself
  // removed, so rejecting it needs no re-ranking.
  | { kind: "match"; match: Receipt; candidates: ScoredReceipt[] }
  | { kind: "candidates"; candidates: ScoredReceipt[] }
  // The scan yielded no amount or no date, so nothing can be compared.
  | { kind: "unmatchable" };

// Mirrors `activeReceipts` in /api/dedup: rows already stamped as duplicates,
// and the secondary rows of a mixed payment, are noise as suggestions — their
// primary is in the pool and represents them.
function isComparable(r: Receipt): boolean {
  return r.documentType !== DOCUMENT_TYPE.Duplicate && !r.linkedTo;
}

export function checkScannedReceipt(
  scanned: Receipt,
  pool: readonly Receipt[],
): CheckOutcome {
  if (scanned.amount === null || !scanned.date) return { kind: "unmatchable" };

  // receiptLineDistance compares an expense LINE to a receipt, so the scanned
  // receipt takes the line's shape here: its store name plays the description,
  // which makes the name similarity a storeName-to-storeName comparison.
  const line = {
    date: scanned.date,
    amount: scanned.amount,
    description: scanned.storeName,
  };

  const ranked = pool
    .filter(isComparable)
    .map((receipt) => ({ receipt, distance: receiptLineDistance(line, receipt) }))
    // Rows without an amount or a date cannot be near anything; offering them
    // as "most similar" would be noise.
    .filter((c): c is ScoredReceipt => c.distance !== null)
    .sort((a, b) => compareCandidates(a.distance, b.distance));

  // Same amount to the agora, same store, essentially the same day. Several
  // rows can qualify when the sheet already holds a duplicate pair; they all
  // mean the same thing, so the best-ordered one answers the question.
  const match = ranked.find(
    (c) =>
      c.distance.sameAmount &&
      c.distance.nameRelated &&
      c.distance.daysDiff <= MATCH_DAYS_TOL,
  );

  if (match) {
    return {
      kind: "match",
      match: match.receipt,
      candidates: ranked
        .filter((c) => c.receipt.id !== match.receipt.id)
        .slice(0, CANDIDATE_COUNT),
    };
  }

  // No confident hit: the nearest few, ungated. Unlike the report workbench
  // this does NOT require sameAmount — the user asked to see the closest
  // receipts precisely when none of them is an exact match.
  return { kind: "candidates", candidates: ranked.slice(0, CANDIDATE_COUNT) };
}
