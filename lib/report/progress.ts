// Serializable wizard progress: the persistence layer for the report wizard.
// This module is pure (no I/O) — `serializeProgress`/`hydrateProgress` are
// exact inverses of each other over `WizardProgressState`. Storage backends
// (lib/report/progress-store.ts) move the serialized `ReportProgress` value
// in and out of a per-period Sheet tab (or, later, a DB).
//
// Scope: only the wizard's DECISION-BEARING state is persisted. Pure-UI state
// (uploaded `File[]`s, the open matching workbench, preview toggles, table
// filters/sort, in-flight/error flags) is excluded — it is either transient
// (files can't survive a reload anyway) or trivially reset on resume.

import type { ReportFolders } from "@/lib/report/period";
import type { CategorizedExpense, ProcessResult } from "@/lib/report/process";

// ----------------------------------------------------------------------------
// Wizard state shape (serialize input / hydrate output)
// ----------------------------------------------------------------------------

// Mirrors ReportWizard's `created` state (`CreatedPeriod`).
export interface WizardProgressPeriod {
  folderName: string;
  folders: ReportFolders;
}

// A single receipt attachment, keyed by the line it's attached to. Persisted
// by receipt `id` (not just fileName) so re-hydration survives fileName
// collisions and can drive a smart merge against a freshly-fetched receipt
// list (a future task). `receiptFileName` is kept alongside for display /
// to reconstruct the in-memory `.receipt` (fileName) field on the expense.
export interface ReceiptAttachment {
  lineId: string;
  receiptId: string;
  receiptFileName: string;
}

// The exact serialize input / hydrate output. Task 4's persistence hook reads
// this shape out of ReportWizard's state and writes it back on resume.
export interface WizardProgressState {
  step: number;
  maxStep: number;
  year: number;
  pair: { m1: number; m2: number } | null;
  created: WizardProgressPeriod | null;
  result: ProcessResult | null;
  expenses: CategorizedExpense[];
  expenseIncluded: Record<string, boolean>;
  incomeIncluded: Record<string, boolean>;
  transferInclude: Record<string, boolean>;
  creditRoute: Record<string, "income" | "expense" | "exclude">;
  cardGapAck: boolean;
  cashGapAck: boolean;
  matchRan: boolean;
  dismissedIds: Set<string>;
  receiptLinks: Record<string, string>;
  // Receipt-id-keyed attachment records, one per expense line that currently
  // carries a receipt (`expenses[i].receipt` set). Derived/maintained
  // alongside `expenses` by the wizard (Task 4) — kept as an explicit field
  // here rather than re-derived, since the fileName alone on `.receipt`
  // cannot recover the receipt `id` after the fact.
  attachments: ReceiptAttachment[];
  // Step-6 output: ids/urls of the generated artifacts (null until first generation).
  generated: {
    workingId: string; workingUrl: string;
    reportId: string; reportUrl: string;
    generatedAt: string; // ISO
  } | null;
}

// ----------------------------------------------------------------------------
// Serialized (on-disk) shape
// ----------------------------------------------------------------------------

export interface ReportProgress {
  schemaVersion: 1;
  step: number;
  maxStep: number;
  year: number;
  pair: { m1: number; m2: number } | null;
  created: WizardProgressPeriod | null;
  result: ProcessResult | null;
  expenses: CategorizedExpense[];
  expenseIncluded: Record<string, boolean>;
  incomeIncluded: Record<string, boolean>;
  transferInclude: Record<string, boolean>;
  creditRoute: Record<string, "income" | "expense" | "exclude">;
  cardGapAck: boolean;
  cashGapAck: boolean;
  matchRan: boolean;
  dismissedIds: string[];
  receiptLinks: Record<string, string>;
  attachments: ReceiptAttachment[];
  generated: {
    workingId: string; workingUrl: string;
    reportId: string; reportUrl: string;
    generatedAt: string; // ISO
  } | null;
}

// ----------------------------------------------------------------------------
// Pure (de)serialization — exact inverses
// ----------------------------------------------------------------------------

export function serializeProgress(state: WizardProgressState): ReportProgress {
  return {
    schemaVersion: 1,
    step: state.step,
    maxStep: state.maxStep,
    year: state.year,
    pair: state.pair,
    created: state.created,
    result: state.result,
    expenses: state.expenses,
    expenseIncluded: state.expenseIncluded,
    incomeIncluded: state.incomeIncluded,
    transferInclude: state.transferInclude,
    creditRoute: state.creditRoute,
    cardGapAck: state.cardGapAck,
    cashGapAck: state.cashGapAck,
    matchRan: state.matchRan,
    dismissedIds: Array.from(state.dismissedIds),
    receiptLinks: state.receiptLinks,
    attachments: state.attachments,
    generated: state.generated,
  };
}

export function hydrateProgress(progress: ReportProgress): WizardProgressState {
  return {
    step: progress.step,
    maxStep: progress.maxStep ?? progress.step,
    year: progress.year,
    pair: progress.pair,
    created: progress.created,
    result: progress.result,
    expenses: progress.expenses,
    expenseIncluded: progress.expenseIncluded,
    incomeIncluded: progress.incomeIncluded,
    transferInclude: progress.transferInclude,
    creditRoute: progress.creditRoute,
    cardGapAck: progress.cardGapAck,
    cashGapAck: progress.cashGapAck,
    matchRan: progress.matchRan,
    dismissedIds: new Set(progress.dismissedIds),
    receiptLinks: progress.receiptLinks,
    attachments: progress.attachments,
    generated: progress.generated ?? null,
  };
}
