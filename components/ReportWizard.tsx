"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn, formatILS } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MatchWorkbench } from "@/components/report/MatchWorkbench";
import { Eye } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/lib/use-is-mobile";
import {
  GOV_EXPENSE_CATEGORIES,
  GOV_EXPENSE_CATEGORY,
  PAYMENT_METHOD,
  type GovExpenseCategory,
  type Receipt,
} from "@/lib/types";
import { matchReceiptsToLines, receiptLineDistance } from "@/lib/match";
import type { ReportFolders } from "@/lib/report/period";
import type { CategorizedExpense, ProcessResult } from "@/lib/report/process";
import type { ExpenseSource } from "@/lib/report/reconcile";
import {
  hydrateProgress,
  type ReceiptAttachment,
  type ReportProgress,
  type WizardProgressState,
} from "@/lib/report/progress";
import { useReportProgress } from "@/lib/report/use-report-progress";
import Link from "next/link";

// Six wizard steps — labels verbatim from the spec (§4.2).
const STEPS = [
  "בחירת תקופה",
  "העלאת מסמכים",
  "פירוק וסיווג",
  "התאמת קבלות",
  "מזומן",
  "הפקת דוח",
] as const;

// ISO YYYY-MM-DD → DD/MM/YYYY for display (— when absent).
function fmtDate(d?: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}

// A manual "+ הוסף שורה" row the user has not filled in yet. Draft rows sort
// to the END of the expense tables (directly above the add button) so adding
// one gives immediate visible feedback, and addExpense refuses to stack a
// second untouched draft.
function isDraftExpense(e: { amount: number; description: string }): boolean {
  return e.amount === 0 && e.description.trim() === "";
}

// Month number from an ISO date (null-safe).
function monthOfISO(d?: string | null): number | null {
  const m = d ? Number(d.slice(5, 7)) : NaN;
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : null;
}

const SOURCE_LABEL: Record<"direct" | "checking" | "cash" | "manual", string> =
  {
    direct: "כרטיס",
    checking: "בנק",
    cash: "מזומן",
    manual: "ידני",
  };

// Two-digit month label, e.g. 3 -> "03".
const pad2 = (n: number) => String(n).padStart(2, "0");

// The six bi-monthly periods of a year.
const MONTH_PAIRS = [
  { m1: 1, m2: 2 },
  { m1: 3, m2: 4 },
  { m1: 5, m2: 6 },
  { m1: 7, m2: 8 },
  { m1: 9, m2: 10 },
  { m1: 11, m2: 12 },
] as const;

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

interface CreatedPeriod {
  folderName: string;
  folders: ReportFolders;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

// A labeled file slot (hidden native input opened by a button).
function FileSlot({
  label,
  hint,
  accept,
  multiple,
  files,
  onChange,
}: {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2 border border-border p-4">
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => onChange(Array.from(e.target.files ?? []))}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          type="button"
          onClick={() => ref.current?.click()}
        >
          בחר קובץ
        </Button>
        {files.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground underline"
          >
            נקה
          </button>
        ) : null}
      </div>
      {files.length > 0 ? (
        <ul className="text-xs text-muted-foreground">
          {files.map((f, i) => (
            <li key={i}>{f.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// One row of the step-2 expense classify table. Memoized because real
// reports have ~200-300 rows, each with two Radix `Select`s — without
// memoization, every keystroke in one row re-renders all of them. Relies on
// `patchExpense` preserving referential identity for unchanged rows (see
// `setExpenses` in `ReportWizard`), so an edit to row A leaves row B's `e`
// (and every other prop here) referentially unchanged and this component
// skips re-rendering.
const ExpenseRow = memo(function ExpenseRow({
  e,
  included,
  months,
  categories,
  onPatch,
  onDelete,
  onToggleInclude,
}: {
  e: CategorizedExpense;
  included: boolean;
  months: number[];
  categories: readonly GovExpenseCategory[];
  onPatch: (lineId: string, patch: Partial<CategorizedExpense>) => void;
  onDelete: (lineId: string) => void;
  onToggleInclude: (lineId: string, checked: boolean) => void;
}) {
  return (
    <TableRow className={included ? "" : "opacity-50"}>
      <TableCell>
        <Checkbox
          checked={included}
          onCheckedChange={(v) => onToggleInclude(e.lineId, v === true)}
        />
      </TableCell>
      <TableCell>
        <Input
          value={e.description}
          onChange={(ev) => onPatch(e.lineId, { description: ev.target.value })}
          className="min-w-40"
        />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {SOURCE_LABEL[e.source]}
      </TableCell>
      <TableCell>
        <Select
          value={String(e.month)}
          onValueChange={(v) => onPatch(e.lineId, { month: Number(v) })}
        >
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
        {fmtDate(e.date)}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={e.amount}
          onChange={(ev) =>
            onPatch(e.lineId, { amount: ev.target.valueAsNumber || 0 })
          }
          className="w-24 tabular-nums"
        />
      </TableCell>
      <TableCell>
        <Select
          value={e.category}
          onValueChange={(v) =>
            onPatch(e.lineId, { category: v as GovExpenseCategory })
          }
        >
          <SelectTrigger className="w-full min-w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="sm" onClick={() => onDelete(e.lineId)}>
          מחק
        </Button>
      </TableCell>
    </TableRow>
  );
});

export function ReportWizard() {
  const [step, setStep] = useState(0);
  // Highest step the user has reached. Adjusted during render (React's
  // "adjust state while rendering" pattern — see the You-Might-Not-Need-an-Effect
  // docs) rather than in an effect: it never lowers, resume (which calls
  // setStep(hydrated.step)) lifts it on the next render, and it stays out of
  // WizardProgressState so no persistence is needed.
  const [maxStep, setMaxStep] = useState(0);
  if (step > maxStep) {
    setMaxStep(step);
  }
  const isMobile = useIsMobile();

  // Step 1 (period) form state.
  const [year, setYear] = useState(CURRENT_YEAR);
  const [pair, setPair] = useState<{ m1: number; m2: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPeriod | null>(null);
  // Set on a successful resume-from-saved-progress (createPeriod's GET below),
  // to the restored step index — drives the "resumed" banner. Stays set for
  // the rest of the session (marks "this flow was resumed") until the user
  // discards via התחל מחדש. Null on a fresh flow (no saved progress found).
  const [resumedStep, setResumedStep] = useState<number | null>(null);

  // Step 2 (upload) — source docs held in state until step 3 processes them.
  const [checkingFiles, setCheckingFiles] = useState<File[]>([]);
  const [directFiles, setDirectFiles] = useState<File[]>([]);
  const [salaryFiles, setSalaryFiles] = useState<File[]>([]);

  // Step 3 (process + classify).
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [expenses, setExpenses] = useState<CategorizedExpense[]>([]);
  // Always holds the latest committed `expenses`, kept in sync by the effect
  // below. Used by mergeNewReceipts to check line-existence against genuinely
  // live state instead of the stale pre-fetch closure value — see that
  // function for why the closure value can't be trusted for this check.
  const expensesRef = useRef(expenses);
  useEffect(() => {
    expensesRef.current = expenses;
  }, [expenses]);
  // Decision state below is keyed by the line's stable `lineId`, not its array
  // index — indexes shift on add/delete/re-process, lineId doesn't. Absent key
  // falls back to each map's original default (expense/income: included;
  // transfer: excluded — same defaults as the old index-keyed boolean[]s).
  const [transferInclude, setTransferInclude] = useState<
    Record<string, boolean>
  >({});
  const [expenseIncluded, setExpenseIncluded] = useState<
    Record<string, boolean>
  >({});
  const [incomeIncluded, setIncomeIncluded] = useState<Record<string, boolean>>(
    {},
  );
  const [cardGapAck, setCardGapAck] = useState(false);
  // Receipt matching (step 3): pulled from the "Receipts – sumoo" sheet on demand.
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [matchRan, setMatchRan] = useState(false);
  // Bumped at the end of every runReceiptMatch (including re-runs where
  // matchRan was already true) so the save-on-transition effect below fires
  // even when a re-match doesn't change matchRan's boolean value.
  const [matchGeneration, setMatchGeneration] = useState(0);
  const [unmatchedReceipts, setUnmatchedReceipts] = useState<Receipt[]>([]);
  const [receiptLinks, setReceiptLinks] = useState<Record<string, string>>({});
  // All receipts fetched from the sheet (needed to return a detached receipt to
  // the unmatched list).
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  // Receipt-id-keyed attachment records, kept as a faithful parallel mirror of
  // the fileName-based `expense.receipt` field (which loses the receipt id).
  // Persisted alongside the wizard progress (lib/report/progress.ts); not
  // used for any in-wizard display logic.
  const [attachments, setAttachments] = useState<ReceiptAttachment[]>([]);
  const [addingCashId, setAddingCashId] = useState<string | null>(null);
  const [cashGapAck, setCashGapAck] = useState(false);
  // The unmatched receipt open in the matching workbench (null = closed),
  // and whether its Drive preview iframe is shown.
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Receipts the user pulled out of the matching flow (next-period charge,
  // credit confirmation, or a split receipt whose lines are all attached).
  // Client-side only — the sheet is untouched; restore brings them all back.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // Per-review-credit routing: where the user sends each זיכוי לבדיקה. Unset =
  // still under review (counted in neither total). Never affects the card gap.
  const [creditRoute, setCreditRoute] = useState<
    Record<string, "income" | "expense" | "exclude">
  >({});
  const [expenseFilter, setExpenseFilter] = useState("");
  const [expenseSourceFilter, setExpenseSourceFilter] = useState<
    "all" | "direct" | "checking" | "cash" | "manual"
  >("all");
  const [receiptMatchFilter, setReceiptMatchFilter] = useState<
    "all" | "matched" | "unmatched"
  >("all");
  const [expenseSort, setExpenseSort] = useState<{
    key:
      | "month"
      | "amount"
      | "description"
      | "source"
      | "category"
      | "date"
      | "receipt";
    dir: "asc" | "desc";
  }>({ key: "month", dir: "asc" });

  const canCreate = pair !== null && !creating;

  async function createPeriod() {
    if (!pair) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/report/period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month1: pair.m1, month2: pair.m2 }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "שגיאה ביצירת התיקייה");
      }
      setCreated({ folderName: data.folderName, folders: data.folders });

      // Resume-on-entry: look up saved progress for this period. Files (any
      // uploaded so far in THIS browser session) are irrelevant to this
      // lookup — a resumed flow always starts with empty file slots since
      // File objects never survive a reload; the restored `result` is
      // authoritative for steps 2-5 (see WizardProgressState doc comment).
      let resumed = false;
      try {
        const progRes = await fetch(
          `/api/report/progress?period=${encodeURIComponent(data.folderName)}`,
        );
        const progData = await progRes.json().catch(() => null);
        const progress = (progData?.progress ?? null) as ReportProgress | null;
        if (progRes.ok && progData?.ok && progress) {
          const hydrated = hydrateProgress(progress);
          setYear(hydrated.year);
          setPair(hydrated.pair);
          setCreated(hydrated.created);
          setResult(hydrated.result);
          setExpenses(hydrated.expenses);
          setExpenseIncluded(hydrated.expenseIncluded);
          setIncomeIncluded(hydrated.incomeIncluded);
          setTransferInclude(hydrated.transferInclude);
          setCreditRoute(hydrated.creditRoute);
          setCardGapAck(hydrated.cardGapAck);
          setCashGapAck(hydrated.cashGapAck);
          setMatchRan(hydrated.matchRan);
          setDismissedIds(hydrated.dismissedIds);
          setReceiptLinks(hydrated.receiptLinks);
          setAttachments(hydrated.attachments);
          setResumedStep(hydrated.step);
          setStep(hydrated.step);
          setMaxStep(hydrated.maxStep);
          resumed = true;
        }
      } catch {
        // Resume lookup is best-effort — fall through to the fresh flow below.
      }
      if (!resumed) {
        setStep(1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function processDocs() {
    if (!created || !pair) return;
    setProcessing(true);
    setProcessError(null);
    try {
      const fd = new FormData();
      fd.append(
        "period",
        JSON.stringify({
          year,
          month1: pair.m1,
          month2: pair.m2,
          folderName: created.folderName,
        }),
      );
      fd.append("sourceFolderId", created.folders.sourceId);
      for (const f of checkingFiles) fd.append("checking", f);
      for (const f of directFiles) fd.append("direct", f);
      for (const f of salaryFiles) fd.append("salary", f);

      const res = await fetch("/api/report/process", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "שגיאה בעיבוד המסמכים");
      }
      const r = data as ProcessResult;
      setResult(r);
      setExpenses(r.expenses);
      setExpenseIncluded({});
      setIncomeIncluded({});
      setTransferInclude({});
      setCreditRoute({});
      setCardGapAck(false);
      setCashGapAck(false);
      setMatchRan(false);
      setUnmatchedReceipts([]);
      setReceiptLinks({});
      setAllReceipts([]);
      setDismissedIds(new Set());
      setAttachments([]);
    } catch (e) {
      setProcessError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  // התחל מחדש: cancel any pending/armed autosave FIRST — a debounce timer
  // armed from a prior edit can fire while the DELETE below is in flight
  // (network await), which would otherwise POST the stale pre-discard
  // snapshot back with no ordering guarantee vs the DELETE. Then clear the
  // saved tab server-side, then reset every piece of state the wizard
  // tracks (processDocs's reset block plus everything resume can set) back
  // to a fresh flow. `created`/`result` are nulled before anything else so
  // the autosave hook's `enabled` flips false before any other setter could
  // otherwise trigger a re-save of an almost-empty snapshot.
  const [restarting, setRestarting] = useState(false);
  async function discardProgress() {
    if (!created) return;
    if (!window.confirm("למחוק את ההתקדמות השמורה ולהתחיל תקופה מחדש?")) return;
    cancelProgressSave();
    setRestarting(true);
    try {
      await fetch(
        `/api/report/progress?period=${encodeURIComponent(created.folderName)}`,
        { method: "DELETE" },
      );
    } catch {
      // Best-effort — proceed with the local reset regardless.
    } finally {
      setRestarting(false);
    }
    setCreated(null);
    setResult(null);
    setPair(null);
    setExpenses([]);
    setExpenseIncluded({});
    setIncomeIncluded({});
    setTransferInclude({});
    setCreditRoute({});
    setCardGapAck(false);
    setCashGapAck(false);
    setMatchRan(false);
    setUnmatchedReceipts([]);
    setReceiptLinks({});
    setAllReceipts([]);
    setDismissedIds(new Set());
    setAttachments([]);
    setCheckingFiles([]);
    setDirectFiles([]);
    setSalaryFiles([]);
    setResumedStep(null);
    setSelectedReceipt(null);
    setPreviewOpen(false);
    setAddingCashId(null);
    setStep(0);
    setMaxStep(0);
  }

  const patchExpense = useCallback(
    (lineId: string, patch: Partial<CategorizedExpense>) => {
      setExpenses((prev) =>
        prev.map((e) => (e.lineId === lineId ? { ...e, ...patch } : e)),
      );
    },
    [],
  );

  // Merge freshly-fetched receipts into the current match state WITHOUT
  // touching anything the user already decided on (manual attach/dismiss/
  // split/edit). Idempotent: receipts already dismissed, already attached
  // (by id), or already reflected on a line (by fileName, a fallback for
  // robustness) are excluded from matching entirely, and a match is only
  // ever assigned to a line that has no `.receipt` yet — an existing
  // attachment is never overwritten. On the very first run nothing is
  // handled yet and no line has a receipt, so this reduces to "match
  // everything", identical to the old behavior; every later run is
  // additive-only.
  function mergeNewReceipts(
    receipts: Receipt[],
    expensesSnapshot: CategorizedExpense[],
  ) {
    // Foreign-card receipts can't serve as proof of purchase (documentation
    // only) — keep them out of the matching pool, surfaced as a count below.
    const evidence = receipts.filter(
      (r) => r.paymentMethod !== PAYMENT_METHOD.ForeignCard,
    );

    // A receipt is genuinely "handled" — and must never re-enter matching —
    // only when it's already attached to a line (or sits on a line). Dismissed
    // receipts are a SEPARATE class: they're withheld from *consuming* a match,
    // but must stay in the unmatched pool so the "restore dismissed" row keeps
    // working after a merge (see the `dismissed` re-add below).
    const isAttached = (r: Receipt) =>
      attachments.some((a) => a.receiptId === r.id) ||
      expensesSnapshot.some((e) => e.receipt === r.fileName);
    const matchable = evidence.filter(
      (r) => !isAttached(r) && !dismissedIds.has(r.id),
    );

    // Match only against lines that still have NO receipt. A line that already
    // carries a receipt must never *consume* (and thereby swallow) a candidate:
    // the matcher would mark the receipt used, but the apply step won't write to
    // a filled line, so the receipt would vanish from both the line and the
    // unmatched pool. Excluding filled lines up front makes that impossible, and
    // keeps `byLine` index-aligned to `emptyLines` for the lineId-keyed apply.
    const emptyLines = expensesSnapshot.filter((e) => !e.receipt);

    const { byLine, unmatchedReceipts: leftover } = matchReceiptsToLines(
      emptyLines.map((e) => ({
        date: e.date,
        amount: e.amount,
        description: e.description,
      })),
      matchable,
    );

    // `emptyLines`/`byLine` are aligned to the render that kicked off the
    // receipts fetch. Key the result by lineId (not array index) because the
    // `setExpenses` functional update below runs against whatever `expenses`
    // is CURRENT when the update is applied. If the user adds/removes/
    // reorders a line while the fetch is in flight, an index-based write
    // would land on the wrong line. Keying by lineId makes that impossible:
    // the write only ever lands on the line it was actually matched against
    // (or is a no-op if that line no longer exists).
    const applied = new Map<
      string,
      { fileName: string; receiptId: string; driveFileId: string | null }
    >();
    byLine.forEach((r, i) => {
      if (r) {
        applied.set(emptyLines[i].lineId, {
          fileName: r.fileName,
          receiptId: r.id,
          driveFileId: r.driveFileId ?? null,
        });
      }
    });

    setExpenses((prev) =>
      prev.map((e) =>
        applied.has(e.lineId) && !e.receipt
          ? { ...e, receipt: applied.get(e.lineId)!.fileName }
          : e,
      ),
    );

    const newLinks: Record<string, string> = {};
    applied.forEach(({ fileName, driveFileId }) => {
      if (driveFileId) {
        newLinks[fileName] =
          `https://drive.google.com/file/d/${driveFileId}/view`;
      }
    });
    setReceiptLinks((prev) => ({ ...prev, ...newLinks }));

    // Skip lines that no longer exist (e.g. deleted mid-fetch) so an
    // attachment is never created for a line that isn't there anymore.
    // `expensesRef.current` reflects genuinely live state (kept in sync by an
    // effect), unlike `expenses`/`expensesSnapshot` here, which are both the
    // same stale pre-fetch closure value — so this check actually works.
    const liveLineIds = new Set(expensesRef.current.map((e) => e.lineId));
    const newAttachments: ReceiptAttachment[] = Array.from(applied.entries())
      .filter(([lineId]) => liveLineIds.has(lineId))
      .map(([lineId, { receiptId, fileName }]) => ({
        lineId,
        receiptId,
        receiptFileName: fileName,
      }));
    setAttachments((prev) => [...prev, ...newAttachments]);

    setAllReceipts(receipts);
    // Dismissed receipts were held out of matching (they can't consume a line)
    // but must remain in the unmatched pool so the "N קבלות הוסרו מההתאמה"
    // restore row survives a merge — the UI derives `dismissedCount` from
    // `unmatchedReceipts`. They can't overlap `leftover` (dismissed are excluded
    // from `matchable`); attached ones stay filtered out as genuinely handled.
    const dismissed = evidence.filter(
      (r) => dismissedIds.has(r.id) && !isAttached(r),
    );
    setUnmatchedReceipts([...leftover, ...dismissed]);
    setMatchRan(true);
    setMatchGeneration((g) => g + 1);
  }

  // Fetch the OCR'd receipts and merge new matches into the current state.
  // First run: nothing is handled yet, so this matches everything (same as
  // the old destructive behavior). Later runs: only newly-scanned receipts
  // get auto-placed, and only onto lines with no receipt yet — manual
  // attach/dismiss/split/edit work from prior runs is left untouched.
  async function runReceiptMatch() {
    setReceiptsLoading(true);
    setReceiptsError(null);
    try {
      const res = await fetch("/api/report/receipts");
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error ?? "שגיאה בטעינת הקבלות");
      const receipts = data.receipts as Receipt[];
      mergeNewReceipts(receipts, expenses);
    } catch (e) {
      setReceiptsError((e as Error).message);
    } finally {
      setReceiptsLoading(false);
    }
  }

  // Turn an unmatched receipt into a real expense line (auto-classified,
  // best-effort). Cash receipts reduce the month's cash-withdrawal residual in
  // the מזומן step; non-cash receipts land as a "manual" line the user should
  // double-check isn't already covered by the bank/card detail.
  async function addReceiptExpense(r: Receipt) {
    const month = monthOfISO(r.date);
    if (r.amount === null || month === null) return;
    const amount = Math.abs(r.amount);
    const description = r.storeName ?? r.fileName;
    const source: ExpenseSource =
      r.paymentMethod === PAYMENT_METHOD.Cash ? "cash" : "manual";
    setAddingCashId(r.id);
    let category: GovExpenseCategory = GOV_EXPENSE_CATEGORY.Miscellaneous;
    try {
      const res = await fetch("/api/report/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ description, amount }] }),
      });
      const data = await res.json();
      if (res.ok && data.ok && typeof data.categories?.[0] === "string") {
        category = data.categories[0] as GovExpenseCategory;
      }
    } catch {
      // classification is best-effort — the line stays editable under שונות
    }
    const lineId = crypto.randomUUID();
    setExpenses((prev) => [
      ...prev,
      {
        lineId,
        month,
        amount,
        description,
        category,
        source,
        date: r.date ?? undefined,
        receipt: r.fileName,
      },
    ]);
    setAttachments((prev) => [
      ...prev,
      { lineId, receiptId: r.id, receiptFileName: r.fileName },
    ]);
    if (r.driveFileId) {
      setReceiptLinks((prev) => ({
        ...prev,
        [r.fileName]: `https://drive.google.com/file/d/${r.driveFileId}/view`,
      }));
    }
    setUnmatchedReceipts((prev) => prev.filter((x) => x.id !== r.id));
    setSelectedReceipt((prev) => (prev?.id === r.id ? null : prev));
    setAddingCashId(null);
  }

  // Manually attach an unmatched receipt to an expense line. If the line already
  // holds a receipt, that one is returned to the unmatched list (a swap).
  // keepAvailable (split receipt): the receipt stays in the unmatched list and
  // the workbench stays open, so the next charge can be attached to it too.
  function attachReceipt(r: Receipt, lineId: string, keepAvailable = false) {
    const nextExpenses = expenses.map((e) =>
      e.lineId === lineId ? { ...e, receipt: r.fileName } : e,
    );
    const prevFile = expenses.find((e) => e.lineId === lineId)?.receipt;
    if (prevFile) {
      const displaced = allReceipts.find((x) => x.fileName === prevFile);
      if (displaced && displaced.id !== r.id) {
        setUnmatchedReceipts((prev) =>
          prev.some((x) => x.id === displaced.id) ? prev : [...prev, displaced],
        );
      }
    }
    setExpenses(nextExpenses);
    setAttachments((prev) => [
      ...prev.filter((a) => a.lineId !== lineId),
      { lineId, receiptId: r.id, receiptFileName: r.fileName },
    ]);
    if (r.driveFileId) {
      setReceiptLinks((prev) => ({
        ...prev,
        [r.fileName]: `https://drive.google.com/file/d/${r.driveFileId}/view`,
      }));
    }
    if (!keepAvailable) {
      setUnmatchedReceipts((prev) => prev.filter((x) => x.id !== r.id));
      setSelectedReceipt(null);
    }
  }

  // Pull a receipt out of the matching flow without touching the sheet.
  function dismissReceipt(r: Receipt) {
    setDismissedIds((prev) => new Set(prev).add(r.id));
    setSelectedReceipt((prev) => (prev?.id === r.id ? null : prev));
  }

  // Detach the receipt on a line, returning it to the unmatched list.
  function detachReceipt(lineId: string) {
    const file = expenses.find((e) => e.lineId === lineId)?.receipt;
    if (!file) return;
    const receipt = allReceipts.find((x) => x.fileName === file);
    const nextExpenses = expenses.map((e) =>
      e.lineId === lineId ? { ...e, receipt: undefined } : e,
    );
    if (receipt) {
      setUnmatchedReceipts((prev) =>
        prev.some((x) => x.id === receipt.id) ? prev : [...prev, receipt],
      );
    }
    setExpenses(nextExpenses);
    setAttachments((prev) => prev.filter((a) => a.lineId !== lineId));
  }

  const deleteExpense = useCallback((lineId: string) => {
    setExpenses((prev) => prev.filter((e) => e.lineId !== lineId));
    setExpenseIncluded((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setAttachments((prev) => prev.filter((a) => a.lineId !== lineId));
  }, []);

  const onToggleExpenseInclude = useCallback(
    (lineId: string, checked: boolean) => {
      setExpenseIncluded((p) => ({ ...p, [lineId]: checked }));
    },
    [],
  );

  function addExpense() {
    setExpenses((prev) => {
      // One untouched draft at a time: repeated clicks (e.g. when the user
      // didn't notice the row appear) must not stack empty rows.
      if (prev.some(isDraftExpense)) return prev;
      return [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          month: pair?.m1 ?? 1,
          amount: 0,
          description: "",
          category: GOV_EXPENSE_CATEGORY.Miscellaneous,
          source: "direct",
        },
      ];
    });
  }

  const periodMonths = useMemo(() => (pair ? [pair.m1, pair.m2] : []), [pair]);

  // Persisted wizard progress (lib/report/progress.ts). Enabled only once a
  // period folder exists AND documents have been processed — nothing worth
  // persisting before that (and saving earlier risks clobbering a previously
  // saved snapshot with an empty one).
  const progressState: WizardProgressState = {
    step,
    maxStep,
    year,
    pair,
    created,
    result,
    expenses,
    expenseIncluded,
    incomeIncluded,
    transferInclude,
    creditRoute,
    cardGapAck,
    cashGapAck,
    matchRan,
    dismissedIds,
    receiptLinks,
    attachments,
  };
  const {
    status: progressStatus,
    saveNow: saveProgressNow,
    cancel: cancelProgressSave,
  } = useReportProgress({
    periodKey: created?.folderName,
    state: progressState,
    enabled: Boolean(created && result),
  });

  // Save-on-transition: `step`/`result`/`matchRan` are committed state by the
  // time this effect runs (React flushes state updates before effects fire),
  // so reading them here — rather than calling saveNow() synchronously right
  // after setStep()/setMatchRan() in the button/processDocs handlers —
  // guarantees the persisted snapshot reflects the post-update state (e.g.
  // the step actually displayed), not the pre-transition one. `result` is
  // included so the end of processDocs (which flips `enabled` true) also
  // triggers an immediate save rather than waiting for the debounce.
  useEffect(() => {
    saveProgressNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-fires on step/result/matchRan/matchGeneration; saveProgressNow reads the latest state via its own ref.
  }, [step, result, matchRan, matchGeneration]);

  // Absent key = included by default (expense/income lines start included).
  const isExpenseIncluded = (lineId: string) => expenseIncluded[lineId] ?? true;
  const isIncomeIncluded = (lineId: string) => incomeIncluded[lineId] ?? true;
  // Absent key = excluded by default (transfers start unchecked).
  const isTransferIncluded = (lineId: string) =>
    transferInclude[lineId] ?? false;

  // Card reconciliation: live card-detail total (editable direct lines) vs the
  // bank ישראכרט-דיירקט settlements. Updates as the user adds/edits/deletes.
  // Card refunds are surfaced as "direct" review credits (not negative expenses),
  // so subtract them here to keep the detail total = the net card charges.
  const CARD_GAP_TOLERANCE = 1;
  const liveCardDetailSum =
    expenses.reduce(
      (a, e) =>
        a +
        (e.source === "direct" && isExpenseIncluded(e.lineId) ? e.amount : 0),
      0,
    ) -
    (result?.reviewCredits ?? []).reduce(
      (a, c) => a + (c.source === "direct" ? c.amount : 0),
      0,
    );
  const cardGap = result
    ? liveCardDetailSum - result.checksum.directAggregateSum
    : 0;
  const cardGapBlocking =
    result != null && Math.abs(cardGap) > CARD_GAP_TOLERANCE && !cardGapAck;

  // Shared expense comparator (used by the classify table and the receipts table).
  const compareExpense = (
    a: { e: CategorizedExpense },
    b: { e: CategorizedExpense },
  ) => {
    // Draft rows always sort last, regardless of key/direction, so a freshly
    // added row lands next to the "+ הוסף שורה" button instead of vanishing
    // into the middle of the month-sorted table.
    const aDraft = isDraftExpense(a.e);
    const bDraft = isDraftExpense(b.e);
    if (aDraft !== bDraft) return aDraft ? 1 : -1;
    const k = expenseSort.key;
    if (k === "receipt") {
      // Matched rows (have a receipt file) first, "—" rows last.
      const cmp = (a.e.receipt ? 0 : 1) - (b.e.receipt ? 0 : 1);
      return expenseSort.dir === "asc" ? cmp : -cmp;
    }
    const cmp =
      k === "amount" || k === "month"
        ? a.e[k] - b.e[k]
        : String(a.e[k] ?? "").localeCompare(String(b.e[k] ?? ""), "he");
    return expenseSort.dir === "asc" ? cmp : -cmp;
  };

  // Filtered + sorted view of expenses. Rows carry `e.lineId` (stable across
  // add/delete/re-process) so the include/edit/delete handlers and React keys
  // target the right row regardless of array position.
  const expenseView = expenses
    .map((e) => ({ e }))
    .filter(
      ({ e }) =>
        (expenseSourceFilter === "all" || e.source === expenseSourceFilter) &&
        (expenseFilter === "" ||
          e.description.includes(expenseFilter) ||
          e.category.includes(expenseFilter)),
    )
    .sort(compareExpense);

  // Receipts step (3): all expenses, sorted the same way (no classify filter).
  const receiptView = expenses
    .map((e) => ({ e }))
    .filter(({ e }) =>
      receiptMatchFilter === "all"
        ? true
        : receiptMatchFilter === "matched"
          ? Boolean(e.receipt)
          : !e.receipt,
    )
    .sort(compareExpense);

  // Receipts that matched no charge: cash ones dated in-period become expense
  // candidates; the rest are surfaced for manual review (never auto-added).
  const cashCandidates = unmatchedReceipts.filter((r) => {
    const m = monthOfISO(r.date);
    return (
      r.paymentMethod === PAYMENT_METHOD.Cash &&
      r.amount !== null &&
      m !== null &&
      periodMonths.includes(m)
    );
  });
  const otherUnmatched = unmatchedReceipts.filter(
    (r) => !cashCandidates.includes(r),
  );
  // For display, non-cash unmatched receipts split into in-period (real "no
  // match" cases worth diagnosing) and out-of-period (the "Receipts – sumoo"
  // sheet holds every receipt ever scanned — these can never match; not failures).
  const isInPeriod = (r: Receipt) => {
    const m = monthOfISO(r.date);
    return m !== null && periodMonths.includes(m);
  };
  // Default-gate candidates for a receipt: exact amount + related name.
  const candidateCount = (r: Receipt): number =>
    expenses.reduce((n, e) => {
      const d = receiptLineDistance(e, r);
      return n + (d && d.sameAmount && d.nameRelated ? 1 : 0);
    }, 0);
  const candidateCountLabel = (r: Receipt): string =>
    r.amount === null || !r.date
      ? "חסר סכום/תאריך בקבלה"
      : String(candidateCount(r));
  const unmatchedInPeriod = otherUnmatched.filter(
    (r) => isInPeriod(r) && !dismissedIds.has(r.id),
  );
  const dismissedCount = otherUnmatched.filter(
    (r) => isInPeriod(r) && dismissedIds.has(r.id),
  ).length;
  const unmatchedOutOfPeriod = otherUnmatched.filter((r) => !isInPeriod(r));
  // Foreign-card receipts in the period — excluded from matching (no proof
  // value), counted here so they don't vanish silently.
  const foreignInPeriod = allReceipts.filter(
    (r) => r.paymentMethod === PAYMENT_METHOD.ForeignCard && isInPeriod(r),
  );

  // Cash coverage per month (the מזומן step): withdrawn − Σ included cash lines.
  const cashRows = (result?.cashWithdrawals ?? []).map((c) => {
    const covered = expenses.reduce(
      (a, e) =>
        a +
        (e.source === "cash" &&
        isExpenseIncluded(e.lineId) &&
        e.month === c.month
          ? e.amount
          : 0),
      0,
    );
    return {
      month: c.month,
      withdrawn: c.amount,
      covered,
      residual: c.amount - covered,
    };
  });
  // Period totals for the live cash summary (updates as receipts are added).
  const cashTotals = cashRows.reduce(
    (a, r) => ({
      withdrawn: a.withdrawn + r.withdrawn,
      covered: a.covered + r.covered,
      residual: a.residual + r.residual,
    }),
    { withdrawn: 0, covered: 0, residual: 0 },
  );
  const cashGapBlocking =
    result != null &&
    cashRows.some((r) => Math.abs(r.residual) > CARD_GAP_TOLERANCE) &&
    !cashGapAck;

  function toggleSort(key: typeof expenseSort.key) {
    setExpenseSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }
  const sortArrow = (key: typeof expenseSort.key) =>
    expenseSort.key === key ? (expenseSort.dir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div className="space-y-6">
      {/* Stepper header */}
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => {
          const reachable = i <= maxStep;
          const active = i === step;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                disabled={!reachable}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 border px-3 py-2 text-xs transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : reachable
                      ? "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                      : "border-border text-muted-foreground opacity-50 cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center text-[11px] font-semibold",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {resumedStep !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-muted p-3 text-sm text-muted-foreground">
          <span>נמצאה התקדמות שמורה · ממשיך משלב {STEPS[resumedStep]}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={discardProgress}
            disabled={restarting}
          >
            התחל מחדש
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 0 ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>שנה</Label>
                <div className="flex flex-wrap gap-2">
                  {YEAR_OPTIONS.map((y) => (
                    <Button
                      key={y}
                      variant={y === year ? "default" : "outline"}
                      onClick={() => setYear(y)}
                    >
                      {y}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>תקופה (חודשיים)</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {MONTH_PAIRS.map((p) => {
                    const selected = pair?.m1 === p.m1 && pair?.m2 === p.m2;
                    return (
                      <Button
                        key={`${p.m1}-${p.m2}`}
                        variant={selected ? "default" : "outline"}
                        className="w-full"
                        onClick={() => setPair({ m1: p.m1, m2: p.m2 })}
                      >
                        {pad2(p.m1)}-{pad2(p.m2)}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}

              {created ? (
                <p className="text-sm text-muted-foreground">
                  נוצרה תיקייה: {created.folderName}
                </p>
              ) : null}

              <Button onClick={createPeriod} disabled={!canCreate}>
                צור תיקייה והמשך
              </Button>
            </div>
          ) : step === 1 ? (
            <div className="space-y-4">
              {created ? (
                <p className="text-sm text-muted-foreground">
                  תיקיית הדו&quot;ח: {created.folderName}
                </p>
              ) : null}
              <FileSlot
                label='עובר ושב (עו"ש)'
                hint="XLS או PDF — אפשר קובץ לכל חודש"
                accept=".xls,.xlsx,.pdf,application/pdf"
                multiple
                files={checkingFiles}
                onChange={setCheckingFiles}
              />
              <FileSlot
                label="פירוט חיובים — דיירקט"
                hint="XLS או PDF — אפשר קובץ לכל חודש"
                accept=".xls,.xlsx,.pdf,application/pdf"
                multiple
                files={directFiles}
                onChange={setDirectFiles}
              />
              <FileSlot
                label="תלושי שכר"
                hint="PDF — ניתן לבחור כמה"
                accept=".pdf,application/pdf"
                multiple
                files={salaryFiles}
                onChange={setSalaryFiles}
              />
            </div>
          ) : step === 2 ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={processDocs} disabled={processing}>
                  {processing ? "מעבד…" : "עבד מסמכים"}
                </Button>
                {created ? (
                  <span className="text-sm text-muted-foreground">
                    תיקיית הדו&quot;ח: {created.folderName}
                  </span>
                ) : null}
              </div>

              {processError ? (
                <p className="text-sm text-destructive">{processError}</p>
              ) : null}

              {result ? (
                <div className="space-y-8">
                  <Section title="סיכום לפי חודש">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>חודש</TableHead>
                          <TableHead>סה&quot;כ הכנסות</TableHead>
                          <TableHead>סה&quot;כ הוצאות</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {periodMonths.map((m) => {
                          const incomeTotal =
                            result.income.reduce(
                              (a, x) =>
                                a +
                                (isIncomeIncluded(x.lineId) && x.month === m
                                  ? x.amount
                                  : 0),
                              0,
                            ) +
                            result.transfers
                              .filter(
                                (t) =>
                                  isTransferIncluded(t.lineId) && t.month === m,
                              )
                              .reduce((a, t) => a + t.amount, 0) +
                            result.reviewCredits.reduce(
                              (a, c) =>
                                a +
                                (creditRoute[c.lineId] === "income" &&
                                c.month === m
                                  ? c.amount
                                  : 0),
                              0,
                            );
                          // Credits routed to "expense" are a minus (a refund), so
                          // they REDUCE the expense total — never add to it.
                          const expenseTotal =
                            expenses.reduce(
                              (a, e) =>
                                a +
                                (isExpenseIncluded(e.lineId) && e.month === m
                                  ? e.amount
                                  : 0),
                              0,
                            ) -
                            result.reviewCredits.reduce(
                              (a, c) =>
                                a +
                                (creditRoute[c.lineId] === "expense" &&
                                c.month === m
                                  ? c.amount
                                  : 0),
                              0,
                            );
                          return (
                            <TableRow key={m}>
                              <TableCell>{m}</TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(incomeTotal)}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(expenseTotal)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Section>

                  <Section title="התאמת כרטיס אשראי">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>סה&quot;כ חיובים בפירוט הכרטיס</span>
                        <span className="tabular-nums">
                          {formatILS(liveCardDetailSum)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>סה&quot;כ ישראכרט-דיירקט בבנק</span>
                        <span className="tabular-nums">
                          {formatILS(result.checksum.directAggregateSum)}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span>הפרש</span>
                        <span className="tabular-nums">
                          {formatILS(cardGap)}
                        </span>
                      </div>
                      {Math.abs(cardGap) > CARD_GAP_TOLERANCE ? (
                        <div className="space-y-2 border border-destructive p-3 text-destructive">
                          <p>
                            קיים פער בין חיובי הכרטיס לבנק. ודא שכל החיובים
                            נקלטו לפני המשך.
                          </p>
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={cardGapAck}
                              onCheckedChange={(v) => setCardGapAck(v === true)}
                            />
                            <span>אני מודע/ת לפער ומאשר/ת להמשיך</span>
                          </label>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">
                          החיובים תואמים את הבנק ✓
                        </p>
                      )}
                    </div>
                  </Section>

                  <Section title="הכנסות">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>כלול</TableHead>
                          <TableHead>מקור</TableHead>
                          <TableHead>חודש</TableHead>
                          <TableHead>סכום</TableHead>
                          <TableHead>קטגוריה</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.income.map((x) => (
                          <TableRow
                            key={x.lineId}
                            className={
                              isIncomeIncluded(x.lineId) ? "" : "opacity-50"
                            }
                          >
                            <TableCell>
                              <Checkbox
                                checked={isIncomeIncluded(x.lineId)}
                                onCheckedChange={(v) =>
                                  setIncomeIncluded((p) => ({
                                    ...p,
                                    [x.lineId]: v === true,
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell>{x.source}</TableCell>
                            <TableCell>{x.month}</TableCell>
                            <TableCell className="tabular-nums">
                              {formatILS(x.amount)}
                            </TableCell>
                            <TableCell>{x.category}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Section>

                  <Section title="הוצאות">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={expenseFilter}
                        onChange={(ev) => setExpenseFilter(ev.target.value)}
                        placeholder="סינון לפי תיאור/קטגוריה"
                        className="w-64"
                      />
                      <Select
                        value={expenseSourceFilter}
                        onValueChange={(v) =>
                          setExpenseSourceFilter(
                            v as
                              | "all"
                              | "direct"
                              | "checking"
                              | "cash"
                              | "manual",
                          )
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">הכל</SelectItem>
                          <SelectItem value="direct">כרטיס</SelectItem>
                          <SelectItem value="checking">בנק</SelectItem>
                          <SelectItem value="cash">מזומן</SelectItem>
                          <SelectItem value="manual">ידני</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>כלול</TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("description")}
                          >
                            תיאור{sortArrow("description")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("source")}
                          >
                            מקור{sortArrow("source")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("month")}
                          >
                            חודש{sortArrow("month")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("date")}
                          >
                            תאריך{sortArrow("date")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("amount")}
                          >
                            סכום{sortArrow("amount")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("category")}
                          >
                            קטגוריה{sortArrow("category")}
                          </TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {expenseView.map(({ e }) => (
                          <ExpenseRow
                            key={e.lineId}
                            e={e}
                            included={isExpenseIncluded(e.lineId)}
                            months={periodMonths}
                            categories={GOV_EXPENSE_CATEGORIES}
                            onPatch={patchExpense}
                            onDelete={deleteExpense}
                            onToggleInclude={onToggleExpenseInclude}
                          />
                        ))}
                      </TableBody>
                    </Table>
                    <Button variant="outline" size="sm" onClick={addExpense}>
                      + הוסף שורה
                    </Button>
                  </Section>

                  {result.excluded.length > 0 ? (
                    <Section title="לא ייכלל בחישוב (זוהו אוטומטית)">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>חודש</TableHead>
                            <TableHead>תיאור</TableHead>
                            <TableHead>סכום</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.excluded.map((x, i) => (
                            <TableRow key={i}>
                              <TableCell>{x.month}</TableCell>
                              <TableCell>{x.description}</TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(x.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}

                  {result.pending.length > 0 ? (
                    <Section title="ממתין לאישור (טרם נקלט בבנק)">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>חודש</TableHead>
                            <TableHead>תיאור</TableHead>
                            <TableHead>סכום</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.pending.map((x, i) => (
                            <TableRow key={i}>
                              <TableCell>{x.month}</TableCell>
                              <TableCell>{x.description}</TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(x.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}

                  {result.transfers.length > 0 ? (
                    <Section title="העברות — להחלטה">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>שם</TableHead>
                            <TableHead>חודש</TableHead>
                            <TableHead>סכום</TableHead>
                            <TableHead>לכלול כהכנסה</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.transfers.map((t) => (
                            <TableRow key={t.lineId}>
                              <TableCell>{t.name || t.description}</TableCell>
                              <TableCell>{t.month}</TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(t.amount)}
                              </TableCell>
                              <TableCell>
                                <Checkbox
                                  checked={isTransferIncluded(t.lineId)}
                                  onCheckedChange={(v) =>
                                    setTransferInclude((prev) => ({
                                      ...prev,
                                      [t.lineId]: v === true,
                                    }))
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}

                  <Section title="מזומן (משיכות לפי חודש)">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>חודש</TableHead>
                          <TableHead>משיכה</TableHead>
                          <TableHead>נצבר בקבלות</TableHead>
                          <TableHead>יתרה</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cashRows.map((c) => (
                          <TableRow key={c.month}>
                            <TableCell>{c.month}</TableCell>
                            <TableCell className="tabular-nums">
                              {formatILS(c.withdrawn)}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatILS(c.covered)}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatILS(c.residual)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Section>

                  {result.salaryCrossChecks.length > 0 ? (
                    <Section title="אימות שכר (בנק מול תלוש)">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>חודש</TableHead>
                            <TableHead>נטו בנק</TableHead>
                            <TableHead>נטו תלוש</TableHead>
                            <TableHead>מעסיק</TableHead>
                            <TableHead>תואם</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.salaryCrossChecks.map((s, i) => (
                            <TableRow key={i}>
                              <TableCell>{s.month}</TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(s.bankNet)}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {s.slipNet == null ? "—" : formatILS(s.slipNet)}
                              </TableCell>
                              <TableCell>{s.employer ?? "—"}</TableCell>
                              <TableCell>{s.matches ? "✓" : "✗"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}

                  {result.reviewCredits.length > 0 ? (
                    <Section title="זיכויים לבדיקה">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>חודש</TableHead>
                            <TableHead>סכום</TableHead>
                            <TableHead>תיאור</TableHead>
                            <TableHead>ניתוב</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.reviewCredits.map((c) => (
                            <TableRow key={c.lineId}>
                              <TableCell>{c.month}</TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(c.amount)}
                              </TableCell>
                              <TableCell>{c.description}</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  {(
                                    [
                                      ["income", "הכנסה"],
                                      ["expense", "הוצאה"],
                                      ["exclude", "לא לכלול"],
                                    ] as const
                                  ).map(([route, label]) => (
                                    <Button
                                      key={route}
                                      size="sm"
                                      variant={
                                        creditRoute[c.lineId] === route
                                          ? "default"
                                          : "outline"
                                      }
                                      onClick={() =>
                                        setCreditRoute((prev) => {
                                          const next = { ...prev };
                                          if (next[c.lineId] === route)
                                            delete next[c.lineId];
                                          else next[c.lineId] = route;
                                          return next;
                                        })
                                      }
                                    >
                                      {label}
                                    </Button>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : step === 3 ? (
            result ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button onClick={runReceiptMatch} disabled={receiptsLoading}>
                    {receiptsLoading
                      ? "מתאים…"
                      : matchRan
                        ? "התאם קבלות חדשות"
                        : "התאם קבלות"}
                  </Button>
                  {matchRan ? (
                    <span className="text-sm text-muted-foreground">
                      {expenses.filter((e) => e.receipt).length} מתוך{" "}
                      {expenses.length} חיובים עם קבלה
                      {unmatchedReceipts.length > 0
                        ? ` · ${unmatchedReceipts.length} קבלות ללא התאמה`
                        : ""}
                    </span>
                  ) : null}
                </div>
                {receiptsError ? (
                  <p className="text-sm text-destructive">{receiptsError}</p>
                ) : null}
                {matchRan ? (
                  <div>
                    <Select
                      value={receiptMatchFilter}
                      onValueChange={(v) =>
                        setReceiptMatchFilter(
                          v as "all" | "matched" | "unmatched",
                        )
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">הכל</SelectItem>
                        <SelectItem value="matched">עם קבלה</SelectItem>
                        <SelectItem value="unmatched">ללא קבלה</SelectItem>
                      </SelectContent>
                    </Select>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("month")}
                          >
                            חודש{sortArrow("month")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("date")}
                          >
                            תאריך{sortArrow("date")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("description")}
                          >
                            תיאור{sortArrow("description")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("amount")}
                          >
                            סכום{sortArrow("amount")}
                          </TableHead>
                          <TableHead
                            className="cursor-pointer"
                            onClick={() => toggleSort("receipt")}
                          >
                            {sortArrow("receipt")}קבלה
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receiptView.map(({ e }) => (
                          <TableRow key={e.lineId}>
                            <TableCell>{e.month}</TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {fmtDate(e.date)}
                            </TableCell>
                            <TableCell>{e.description}</TableCell>
                            <TableCell className="tabular-nums">
                              {formatILS(e.amount)}
                            </TableCell>
                            <TableCell>
                              {e.receipt ? (
                                <span className="flex items-center justify-between b gap-2 min-w-0 ">
                                  {receiptLinks[e.receipt] ? (
                                    <Link
                                      href={receiptLinks[e.receipt]}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={e.receipt}
                                      className="underline truncate min-w-0 max-w-70"
                                    >
                                      {e.receipt}
                                    </Link>
                                  ) : (
                                    <span
                                      className="truncate min-w-0"
                                      title={e.receipt}
                                    >
                                      {e.receipt}
                                    </span>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="shrink-0 max-h-fit"
                                    onClick={() => detachReceipt(e.lineId)}
                                  >
                                    בטל
                                  </Button>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}

                {matchRan && cashCandidates.length > 0 ? (
                  <Section title="קבלות מזומן">
                    <p className="mb-2 text-sm text-muted-foreground">
                      קבלות שלא תואמות אף חיוב — הוספה תיצור שורת הוצאה ותקטין
                      את יתרת המזומן של החודש.
                    </p>
                    <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium tabular-nums">
                      <span>משיכות: {formatILS(cashTotals.withdrawn)}</span>
                      <span>נצבר בקבלות: {formatILS(cashTotals.covered)}</span>
                      <span>נותר: {formatILS(cashTotals.residual)}</span>
                    </p>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>תאריך</TableHead>
                            <TableHead>בית עסק</TableHead>
                            <TableHead>סכום</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cashCandidates.map((r) => (
                            <Fragment key={r.id}>
                              <TableRow>
                                <TableCell className="whitespace-nowrap tabular-nums">
                                  {fmtDate(r.date)}
                                </TableCell>
                                <TableCell>
                                  {r.storeName ?? r.fileName}
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {formatILS(Math.abs(r.amount ?? 0))}
                                </TableCell>
                                <TableCell>
                                  <span className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => addReceiptExpense(r)}
                                      disabled={addingCashId !== null}
                                    >
                                      {addingCashId === r.id
                                        ? "מוסיף…"
                                        : "הוסף כהוצאה"}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedReceipt(r);
                                        setPreviewOpen(false);
                                      }}
                                    >
                                      התאם ידנית
                                    </Button>
                                  </span>
                                </TableCell>
                              </TableRow>
                              {!isMobile && selectedReceipt?.id === r.id ? (
                                <TableRow
                                  key={`${r.id}-workbench`}
                                  className="hover:bg-transparent"
                                >
                                  <TableCell colSpan={4} className="p-0">
                                    <MatchWorkbench
                                      receipt={selectedReceipt}
                                      expenses={expenses}
                                      onAttach={(lineId, keep) =>
                                        attachReceipt(
                                          selectedReceipt,
                                          lineId,
                                          keep,
                                        )
                                      }
                                      onClose={() => setSelectedReceipt(null)}
                                      previewOpen={previewOpen}
                                      onTogglePreview={() =>
                                        setPreviewOpen((v) => !v)
                                      }
                                    />
                                  </TableCell>
                                </TableRow>
                              ) : null}
                            </Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="block space-y-3 md:hidden">
                      {cashCandidates.map((r) => (
                        <div
                          key={r.id}
                          className="space-y-2 border border-border p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {r.storeName ?? r.fileName}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatILS(Math.abs(r.amount ?? 0))}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {fmtDate(r.date)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() => addReceiptExpense(r)}
                              disabled={addingCashId !== null}
                            >
                              {addingCashId === r.id ? "מוסיף…" : "הוסף כהוצאה"}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setSelectedReceipt(r);
                                setPreviewOpen(false);
                              }}
                            >
                              התאם ידנית
                            </Button>
                          </div>
                          {isMobile && selectedReceipt?.id === r.id ? (
                            <MatchWorkbench
                              receipt={selectedReceipt}
                              expenses={expenses}
                              onAttach={(lineId, keep) =>
                                attachReceipt(selectedReceipt, lineId, keep)
                              }
                              onClose={() => setSelectedReceipt(null)}
                              previewOpen={previewOpen}
                              onTogglePreview={() => setPreviewOpen((v) => !v)}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </Section>
                ) : null}

                {matchRan &&
                (unmatchedInPeriod.length > 0 || dismissedCount > 0) ? (
                  <Section title="קבלות ללא התאמה">
                    <p className="mb-2 text-sm text-muted-foreground">
                      הוספת קבלה שאינה מזומן יוצרת שורה ידנית — ודא/י שהחיוב
                      אינו כבר בפירוט הבנק.
                    </p>
                    <div className="hidden md:block">
                      <TooltipProvider>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>תאריך</TableHead>
                              <TableHead>בית עסק</TableHead>
                              <TableHead>סכום</TableHead>
                              <TableHead>אמצעי תשלום</TableHead>
                              <TableHead>מועמדים</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unmatchedInPeriod.map((r) => (
                              <Fragment key={r.id}>
                                <TableRow>
                                  <TableCell className="whitespace-nowrap tabular-nums">
                                    {fmtDate(r.date)}
                                  </TableCell>
                                  <TableCell>
                                    {r.storeName ?? r.fileName}
                                  </TableCell>
                                  <TableCell className="tabular-nums">
                                    {formatILS(Math.abs(r.amount ?? 0))}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {r.paymentMethod}
                                  </TableCell>
                                  <TableCell className="tabular-nums">
                                    {candidateCountLabel(r)}
                                  </TableCell>
                                  <TableCell>
                                    <span className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => addReceiptExpense(r)}
                                        disabled={addingCashId !== null}
                                      >
                                        {addingCashId === r.id
                                          ? "מוסיף…"
                                          : "הוסף כהוצאה"}
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setSelectedReceipt(r);
                                          setPreviewOpen(false);
                                        }}
                                      >
                                        התאם ידנית
                                      </Button>
                                      {r.driveFileId ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => {
                                                setSelectedReceipt(r);
                                                setPreviewOpen(true);
                                              }}
                                              aria-label="הצג קבלה"
                                            >
                                              <Eye />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            הצג קבלה
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : null}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => dismissReceipt(r)}
                                      >
                                        הסר מההתאמה
                                      </Button>
                                    </span>
                                  </TableCell>
                                </TableRow>
                                {!isMobile && selectedReceipt?.id === r.id ? (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={6} className="p-0">
                                      <MatchWorkbench
                                        receipt={selectedReceipt}
                                        expenses={expenses}
                                        onAttach={(lineId, keep) =>
                                          attachReceipt(
                                            selectedReceipt,
                                            lineId,
                                            keep,
                                          )
                                        }
                                        onClose={() => setSelectedReceipt(null)}
                                        previewOpen={previewOpen}
                                        onTogglePreview={() =>
                                          setPreviewOpen((v) => !v)
                                        }
                                      />
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      </TooltipProvider>
                    </div>

                    <div className="block space-y-3 md:hidden">
                      {unmatchedInPeriod.map((r) => (
                        <div
                          key={r.id}
                          className="space-y-2 border border-border p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {r.storeName ?? r.fileName}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatILS(Math.abs(r.amount ?? 0))}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {fmtDate(r.date)} · {r.paymentMethod}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            מועמדים: {candidateCountLabel(r)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() => addReceiptExpense(r)}
                              disabled={addingCashId !== null}
                            >
                              {addingCashId === r.id ? "מוסיף…" : "הוסף כהוצאה"}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setSelectedReceipt(r);
                                setPreviewOpen(false);
                              }}
                            >
                              התאם ידנית
                            </Button>
                            {r.driveFileId ? (
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setSelectedReceipt(r);
                                  setPreviewOpen(true);
                                }}
                                aria-label="הצג קבלה"
                              >
                                <Eye />
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              onClick={() => dismissReceipt(r)}
                            >
                              הסר מההתאמה
                            </Button>
                          </div>
                          {isMobile && selectedReceipt?.id === r.id ? (
                            <MatchWorkbench
                              receipt={selectedReceipt}
                              expenses={expenses}
                              onAttach={(lineId, keep) =>
                                attachReceipt(selectedReceipt, lineId, keep)
                              }
                              onClose={() => setSelectedReceipt(null)}
                              previewOpen={previewOpen}
                              onTogglePreview={() => setPreviewOpen((v) => !v)}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {dismissedCount > 0 ? (
                      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        {dismissedCount} קבלות הוסרו מההתאמה
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDismissedIds(new Set())}
                        >
                          שחזר
                        </Button>
                      </p>
                    ) : null}
                  </Section>
                ) : null}

                {matchRan && unmatchedOutOfPeriod.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {unmatchedOutOfPeriod.length} קבלות מחוץ לתקופה
                  </p>
                ) : null}

                {matchRan && foreignInPeriod.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {foreignInPeriod.length} קבלות ב{PAYMENT_METHOD.ForeignCard}{" "}
                    — לתיעוד בלבד
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                עבד/י מסמכים תחילה בשלב פירוק וסיווג.
              </p>
            )
          ) : step === 4 ? (
            result ? (
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>חודש</TableHead>
                      <TableHead>נמשך</TableHead>
                      <TableHead>כוסה בקבלות</TableHead>
                      <TableHead>יתרה לא מוסברת</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashRows.map((r) => (
                      <TableRow key={r.month}>
                        <TableCell>{r.month}</TableCell>
                        <TableCell className="tabular-nums">
                          {formatILS(r.withdrawn)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatILS(r.covered)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "tabular-nums",
                            r.residual < -CARD_GAP_TOLERANCE
                              ? "text-destructive"
                              : "",
                          )}
                        >
                          {formatILS(r.residual)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {cashRows.some((r) => r.residual < -CARD_GAP_TOLERANCE) ? (
                  <p className="text-sm text-destructive">
                    סכום קבלות המזומן עולה על סכום המשיכות — בדוק/י את הקבלות.
                  </p>
                ) : null}
                {cashRows.some(
                  (r) => Math.abs(r.residual) > CARD_GAP_TOLERANCE,
                ) ? (
                  <div className="space-y-2 border border-destructive p-3 text-sm text-destructive">
                    <p>קיימת יתרת מזומן שאינה מכוסה בקבלות.</p>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={cashGapAck}
                        onCheckedChange={(v) => setCashGapAck(v === true)}
                      />
                      <span>אני מודע/ת לפער ומאשר/ת להמשיך</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    כל המשיכות מכוסות בקבלות ✓
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                עבד/י מסמכים תחילה בשלב פירוק וסיווג.
              </p>
            )
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              {created ? <p>תיקיית הדו&quot;ח: {created.folderName}</p> : null}
              <p>שלב זה ייבנה בהמשך.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer navigation (period step uses its own button to advance). */}
      {progressStatus !== "idle" ? (
        <p className="text-end text-xs text-muted-foreground">
          {progressStatus === "saving"
            ? "שומר…"
            : progressStatus === "saved"
              ? "נשמר"
              : "שמירה נכשלה — ננסה שוב"}
        </p>
      ) : null}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          חזור
        </Button>
        {step > 0 && step < STEPS.length - 1 ? (
          <Button
            variant="outline"
            disabled={
              (step === 2 && cardGapBlocking) || (step === 4 && cashGapBlocking)
            }
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            המשך
          </Button>
        ) : null}
      </div>
    </div>
  );
}
