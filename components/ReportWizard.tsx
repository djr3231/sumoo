"use client";

import { useRef, useState, type ReactNode } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

// Month number from an ISO date (null-safe).
function monthOfISO(d?: string | null): number | null {
  const m = d ? Number(d.slice(5, 7)) : NaN;
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : null;
}

const SOURCE_LABEL: Record<"direct" | "checking" | "cash" | "manual", string> = {
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
        <Button variant="outline" type="button" onClick={() => ref.current?.click()}>
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

export function ReportWizard() {
  const [step, setStep] = useState(0);

  // Step 1 (period) form state.
  const [year, setYear] = useState(CURRENT_YEAR);
  const [pair, setPair] = useState<{ m1: number; m2: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPeriod | null>(null);

  // Step 2 (upload) — source docs held in state until step 3 processes them.
  const [checkingFiles, setCheckingFiles] = useState<File[]>([]);
  const [directFiles, setDirectFiles] = useState<File[]>([]);
  const [salaryFiles, setSalaryFiles] = useState<File[]>([]);

  // Step 3 (process + classify).
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [expenses, setExpenses] = useState<CategorizedExpense[]>([]);
  const [transferInclude, setTransferInclude] = useState<boolean[]>([]);
  const [expenseIncluded, setExpenseIncluded] = useState<boolean[]>([]);
  const [incomeIncluded, setIncomeIncluded] = useState<boolean[]>([]);
  const [cardGapAck, setCardGapAck] = useState(false);
  // Receipt matching (step 3): pulled from the "Receipts – sumoo" sheet on demand.
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [matchRan, setMatchRan] = useState(false);
  const [unmatchedReceipts, setUnmatchedReceipts] = useState<Receipt[]>([]);
  const [receiptLinks, setReceiptLinks] = useState<Record<string, string>>({});
  // All receipts fetched from the sheet (needed to return a detached receipt to
  // the unmatched list).
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [addingCashId, setAddingCashId] = useState<string | null>(null);
  const [cashGapAck, setCashGapAck] = useState(false);
  // The unmatched receipt open in the matching workbench (null = closed),
  // and whether its Drive preview iframe is shown.
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Per-review-credit routing: where the user sends each זיכוי לבדיקה. Unset =
  // still under review (counted in neither total). Never affects the card gap.
  const [creditRoute, setCreditRoute] = useState<
    Record<number, "income" | "expense" | "exclude">
  >({});
  const [expenseFilter, setExpenseFilter] = useState("");
  const [expenseSourceFilter, setExpenseSourceFilter] = useState<
    "all" | "direct" | "checking" | "cash" | "manual"
  >("all");
  const [expenseSort, setExpenseSort] = useState<{
    key: "month" | "amount" | "description" | "source" | "category" | "date";
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
      setStep(1);
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

      const res = await fetch("/api/report/process", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "שגיאה בעיבוד המסמכים");
      }
      const r = data as ProcessResult;
      setResult(r);
      setExpenses(r.expenses);
      setExpenseIncluded(r.expenses.map(() => true));
      setIncomeIncluded(r.income.map(() => true));
      setTransferInclude(r.transfers.map(() => false));
      setCreditRoute({});
      setCardGapAck(false);
      setCashGapAck(false);
      setMatchRan(false);
      setUnmatchedReceipts([]);
      setReceiptLinks({});
      setAllReceipts([]);
    } catch (e) {
      setProcessError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  function patchExpense(i: number, patch: Partial<CategorizedExpense>) {
    setExpenses((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  // Fetch the OCR'd receipts and attach each to its matching charge (by amount +
  // date + name). Leftover receipts (matched no charge) are the cash / unmatched
  // candidates handled in the cash step.
  async function runReceiptMatch() {
    setReceiptsLoading(true);
    setReceiptsError(null);
    try {
      const res = await fetch("/api/report/receipts");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "שגיאה בטעינת הקבלות");
      const receipts = data.receipts as Receipt[];
      // Foreign-card receipts can't serve as proof of purchase (documentation
      // only) — keep them out of the matching pool, surfaced as a count below.
      const evidence = receipts.filter(
        (r) => r.paymentMethod !== PAYMENT_METHOD.ForeignCard,
      );
      const { byLine, unmatchedReceipts: leftover } = matchReceiptsToLines(
        expenses.map((e) => ({ date: e.date, amount: e.amount, description: e.description })),
        evidence,
      );
      const links: Record<string, string> = {};
      byLine.forEach((r) => {
        if (r?.driveFileId) {
          links[r.fileName] = `https://drive.google.com/file/d/${r.driveFileId}/view`;
        }
      });
      setReceiptLinks(links);
      setExpenses((prev) =>
        prev.map((e, i) => (byLine[i] ? { ...e, receipt: byLine[i]!.fileName } : e)),
      );
      setAllReceipts(receipts);
      setUnmatchedReceipts(leftover);
      setMatchRan(true);
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
    const source: ExpenseSource = r.paymentMethod === PAYMENT_METHOD.Cash ? "cash" : "manual";
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
    setExpenses((prev) => [
      ...prev,
      {
        month,
        amount,
        description,
        category,
        source,
        date: r.date ?? undefined,
        receipt: r.fileName,
      },
    ]);
    setExpenseIncluded((prev) => [...prev, true]);
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
  function attachReceipt(r: Receipt, lineIndex: number) {
    const nextExpenses = expenses.map((e, i) =>
      i === lineIndex ? { ...e, receipt: r.fileName } : e,
    );
    const prevFile = expenses[lineIndex]?.receipt;
    if (prevFile) {
      const displaced = allReceipts.find((x) => x.fileName === prevFile);
      if (displaced && displaced.id !== r.id) {
        setUnmatchedReceipts((prev) =>
          prev.some((x) => x.id === displaced.id) ? prev : [...prev, displaced],
        );
      }
    }
    setExpenses(nextExpenses);
    if (r.driveFileId) {
      setReceiptLinks((prev) => ({
        ...prev,
        [r.fileName]: `https://drive.google.com/file/d/${r.driveFileId}/view`,
      }));
    }
    setUnmatchedReceipts((prev) => prev.filter((x) => x.id !== r.id));
    setSelectedReceipt(null);
  }

  // Detach the receipt on a line, returning it to the unmatched list.
  function detachReceipt(lineIndex: number) {
    const file = expenses[lineIndex]?.receipt;
    if (!file) return;
    const receipt = allReceipts.find((x) => x.fileName === file);
    const nextExpenses = expenses.map((e, i) =>
      i === lineIndex ? { ...e, receipt: undefined } : e,
    );
    if (receipt) {
      setUnmatchedReceipts((prev) =>
        prev.some((x) => x.id === receipt.id) ? prev : [...prev, receipt],
      );
    }
    setExpenses(nextExpenses);
  }

  function deleteExpense(i: number) {
    setExpenses((prev) => prev.filter((_, idx) => idx !== i));
    setExpenseIncluded((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addExpense() {
    setExpenses((prev) => [
      ...prev,
      {
        month: pair?.m1 ?? 1,
        amount: 0,
        description: "",
        category: GOV_EXPENSE_CATEGORY.Miscellaneous,
        source: "direct",
      },
    ]);
    setExpenseIncluded((prev) => [...prev, true]);
  }

  const periodMonths = pair ? [pair.m1, pair.m2] : [];

  // Card reconciliation: live card-detail total (editable direct lines) vs the
  // bank ישראכרט-דיירקט settlements. Updates as the user adds/edits/deletes.
  // Card refunds are surfaced as "direct" review credits (not negative expenses),
  // so subtract them here to keep the detail total = the net card charges.
  const CARD_GAP_TOLERANCE = 1;
  const liveCardDetailSum =
    expenses.reduce(
      (a, e, i) => a + (e.source === "direct" && expenseIncluded[i] ? e.amount : 0),
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
    const k = expenseSort.key;
    const cmp =
      k === "amount" || k === "month"
        ? a.e[k] - b.e[k]
        : String(a.e[k] ?? "").localeCompare(String(b.e[k] ?? ""), "he");
    return expenseSort.dir === "asc" ? cmp : -cmp;
  };

  // Filtered + sorted view of expenses, keyed to the original index so the
  // include/edit/delete handlers still target the right row.
  const expenseView = expenses
    .map((e, i) => ({ e, i }))
    .filter(
      ({ e }) =>
        (expenseSourceFilter === "all" || e.source === expenseSourceFilter) &&
        (expenseFilter === "" ||
          e.description.includes(expenseFilter) ||
          e.category.includes(expenseFilter)),
    )
    .sort(compareExpense);

  // Receipts step (3): all expenses, sorted the same way (no classify filter).
  const receiptView = expenses.map((e, i) => ({ e, i })).sort(compareExpense);

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
    r.amount === null || !r.date ? "חסר סכום/תאריך בקבלה" : String(candidateCount(r));
  const unmatchedInPeriod = otherUnmatched.filter(isInPeriod);
  const unmatchedOutOfPeriod = otherUnmatched.filter((r) => !isInPeriod(r));
  // Foreign-card receipts in the period — excluded from matching (no proof
  // value), counted here so they don't vanish silently.
  const foreignInPeriod = allReceipts.filter(
    (r) => r.paymentMethod === PAYMENT_METHOD.ForeignCard && isInPeriod(r),
  );

  // Cash coverage per month (the מזומן step): withdrawn − Σ included cash lines.
  const cashRows = (result?.cashWithdrawals ?? []).map((c) => {
    const covered = expenses.reduce(
      (a, e, i) =>
        a +
        (e.source === "cash" && expenseIncluded[i] && e.month === c.month
          ? e.amount
          : 0),
      0,
    );
    return { month: c.month, withdrawn: c.amount, covered, residual: c.amount - covered };
  });
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
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 border px-3 py-2 text-xs",
              i === step
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center text-[11px] font-semibold",
                i === step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

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

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

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
                              (a, x, i) =>
                                a + (incomeIncluded[i] && x.month === m ? x.amount : 0),
                              0,
                            ) +
                            result.transfers
                              .filter((t, i) => transferInclude[i] && t.month === m)
                              .reduce((a, t) => a + t.amount, 0) +
                            result.reviewCredits.reduce(
                              (a, c, i) =>
                                a + (creditRoute[i] === "income" && c.month === m ? c.amount : 0),
                              0,
                            );
                          // Credits routed to "expense" are a minus (a refund), so
                          // they REDUCE the expense total — never add to it.
                          const expenseTotal =
                            expenses.reduce(
                              (a, e, i) =>
                                a + (expenseIncluded[i] && e.month === m ? e.amount : 0),
                              0,
                            ) -
                            result.reviewCredits.reduce(
                              (a, c, i) =>
                                a + (creditRoute[i] === "expense" && c.month === m ? c.amount : 0),
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
                        <span className="tabular-nums">{formatILS(cardGap)}</span>
                      </div>
                      {Math.abs(cardGap) > CARD_GAP_TOLERANCE ? (
                        <div className="space-y-2 border border-destructive p-3 text-destructive">
                          <p>קיים פער בין חיובי הכרטיס לבנק. ודא שכל החיובים נקלטו לפני המשך.</p>
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={cardGapAck}
                              onCheckedChange={(v) => setCardGapAck(v === true)}
                            />
                            <span>אני מודע/ת לפער ומאשר/ת להמשיך</span>
                          </label>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">החיובים תואמים את הבנק ✓</p>
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
                        {result.income.map((x, i) => (
                          <TableRow key={i} className={incomeIncluded[i] ? "" : "opacity-50"}>
                            <TableCell>
                              <Checkbox
                                checked={incomeIncluded[i] ?? true}
                                onCheckedChange={(v) =>
                                  setIncomeIncluded((p) =>
                                    p.map((b, idx) => (idx === i ? v === true : b)),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>{x.source}</TableCell>
                            <TableCell>{x.month}</TableCell>
                            <TableCell className="tabular-nums">{formatILS(x.amount)}</TableCell>
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
                            v as "all" | "direct" | "checking" | "cash" | "manual",
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
                        {expenseView.map(({ e, i }) => (
                          <TableRow key={i} className={expenseIncluded[i] ? "" : "opacity-50"}>
                            <TableCell>
                              <Checkbox
                                checked={expenseIncluded[i] ?? true}
                                onCheckedChange={(v) =>
                                  setExpenseIncluded((p) =>
                                    p.map((b, idx) => (idx === i ? v === true : b)),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={e.description}
                                onChange={(ev) =>
                                  patchExpense(i, { description: ev.target.value })
                                }
                                className="min-w-40"
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {SOURCE_LABEL[e.source]}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={String(e.month)}
                                onValueChange={(v) => patchExpense(i, { month: Number(v) })}
                              >
                                <SelectTrigger className="w-20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {periodMonths.map((m) => (
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
                                  patchExpense(i, { amount: ev.target.valueAsNumber || 0 })
                                }
                                className="w-24 tabular-nums"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={e.category}
                                onValueChange={(v) =>
                                  patchExpense(i, { category: v as GovExpenseCategory })
                                }
                              >
                                <SelectTrigger className="w-full min-w-48">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GOV_EXPENSE_CATEGORIES.map((c) => (
                                    <SelectItem key={c} value={c}>
                                      {c}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteExpense(i)}
                              >
                                מחק
                              </Button>
                            </TableCell>
                          </TableRow>
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
                              <TableCell className="tabular-nums">{formatILS(x.amount)}</TableCell>
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
                              <TableCell className="tabular-nums">{formatILS(x.amount)}</TableCell>
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
                          {result.transfers.map((t, i) => (
                            <TableRow key={i}>
                              <TableCell>{t.name || t.description}</TableCell>
                              <TableCell>{t.month}</TableCell>
                              <TableCell className="tabular-nums">{formatILS(t.amount)}</TableCell>
                              <TableCell>
                                <Checkbox
                                  checked={transferInclude[i] ?? false}
                                  onCheckedChange={(v) =>
                                    setTransferInclude((prev) =>
                                      prev.map((b, idx) => (idx === i ? v === true : b)),
                                    )
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
                          <TableHead>סכום</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.cashWithdrawals.map((c) => (
                          <TableRow key={c.month}>
                            <TableCell>{c.month}</TableCell>
                            <TableCell className="tabular-nums">{formatILS(c.amount)}</TableCell>
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
                              <TableCell className="tabular-nums">{formatILS(s.bankNet)}</TableCell>
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
                          {result.reviewCredits.map((c, i) => (
                            <TableRow key={i}>
                              <TableCell>{c.month}</TableCell>
                              <TableCell className="tabular-nums">{formatILS(c.amount)}</TableCell>
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
                                      variant={creditRoute[i] === route ? "default" : "outline"}
                                      onClick={() =>
                                        setCreditRoute((prev) => {
                                          const next = { ...prev };
                                          if (next[i] === route) delete next[i];
                                          else next[i] = route;
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
                    {receiptsLoading ? "מתאים…" : "התאם קבלות"}
                  </Button>
                  {matchRan ? (
                    <span className="text-sm text-muted-foreground">
                      {expenses.filter((e) => e.receipt).length} מתוך {expenses.length} חיובים
                      עם קבלה
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
                        <TableHead>קבלה</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receiptView.map(({ e, i }) => (
                        <TableRow key={i}>
                          <TableCell>{e.month}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                            {fmtDate(e.date)}
                          </TableCell>
                          <TableCell>{e.description}</TableCell>
                          <TableCell className="tabular-nums">{formatILS(e.amount)}</TableCell>
                          <TableCell>
                            {e.receipt ? (
                              <span className="flex items-center gap-2">
                                {receiptLinks[e.receipt] ? (
                                  <a
                                    href={receiptLinks[e.receipt]}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                  >
                                    {e.receipt}
                                  </a>
                                ) : (
                                  e.receipt
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => detachReceipt(i)}
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
                ) : null}

                {matchRan && cashCandidates.length > 0 ? (
                  <Section title="קבלות מזומן">
                    <p className="mb-2 text-sm text-muted-foreground">
                      קבלות שלא תואמות אף חיוב — הוספה תיצור שורת הוצאה ותקטין את
                      יתרת המזומן של החודש.
                    </p>
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
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap tabular-nums">
                              {fmtDate(r.date)}
                            </TableCell>
                            <TableCell>{r.storeName ?? r.fileName}</TableCell>
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
                                  {addingCashId === r.id ? "מוסיף…" : "הוסף כהוצאה"}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => { setSelectedReceipt(r); setPreviewOpen(false); }}
                                >
                                  התאם ידנית
                                </Button>
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Section>
                ) : null}

                {matchRan && unmatchedInPeriod.length > 0 ? (
                  <Section title="קבלות ללא התאמה">
                    <TooltipProvider>
                      <p className="mb-2 text-sm text-muted-foreground">
                        הוספת קבלה שאינה מזומן יוצרת שורה ידנית — ודא/י שהחיוב אינו
                        כבר בפירוט הבנק.
                      </p>
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
                            <TableRow key={r.id}>
                              <TableCell className="whitespace-nowrap tabular-nums">
                                {fmtDate(r.date)}
                              </TableCell>
                              <TableCell>{r.storeName ?? r.fileName}</TableCell>
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
                                    {addingCashId === r.id ? "מוסיף…" : "הוסף כהוצאה"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => { setSelectedReceipt(r); setPreviewOpen(false); }}
                                  >
                                    התאם ידנית
                                  </Button>
                                  {r.driveFileId ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => { setSelectedReceipt(r); setPreviewOpen(true); }}
                                          aria-label="הצג קבלה"
                                        >
                                          <Eye />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>הצג קבלה</TooltipContent>
                                    </Tooltip>
                                  ) : null}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TooltipProvider>
                  </Section>
                ) : null}

                {matchRan && unmatchedOutOfPeriod.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {unmatchedOutOfPeriod.length} קבלות מחוץ לתקופה
                  </p>
                ) : null}

                {matchRan && foreignInPeriod.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {foreignInPeriod.length} קבלות ב{PAYMENT_METHOD.ForeignCard} — לתיעוד
                    בלבד
                  </p>
                ) : null}

                {selectedReceipt ? (
                  <MatchWorkbench
                    receipt={selectedReceipt}
                    expenses={expenses}
                    onAttach={(i) => attachReceipt(selectedReceipt, i)}
                    onClose={() => setSelectedReceipt(null)}
                    previewOpen={previewOpen}
                    onTogglePreview={() => setPreviewOpen((v) => !v)}
                  />
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
                            r.residual < -CARD_GAP_TOLERANCE ? "text-destructive" : "",
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
                {cashRows.some((r) => Math.abs(r.residual) > CARD_GAP_TOLERANCE) ? (
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
            disabled={(step === 2 && cardGapBlocking) || (step === 4 && cashGapBlocking)}
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            המשך
          </Button>
        ) : null}
      </div>
    </div>
  );
}
