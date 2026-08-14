"use client";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { toast } from "sonner";
import { apiErrorMessage, apiFetch } from "@/lib/api-client";
import {
  CURRENT_YEAR,
  MONTH_PAIRS,
  YEAR_OPTIONS,
  currentMonthPair,
  periodDateRange,
  periodLabel,
  type MonthPair,
} from "@/lib/period";
import { Alert, AlertDescription, AlertTitle } from "./ui/Alert";
import { Skeleton } from "./ui/Skeleton";
import { DeleteReceiptDialog } from "./DeleteReceiptDialog";
import {
  Loader2,
  CreditCard,
  Banknote,
  Repeat,
  Wallet,
  MoreHorizontal,
  HelpCircle,
  ListFilter,
  ArrowUpDown,
  Menu,
  Trash2,
} from "lucide-react";
import {
  CATEGORIES,
  DEFAULT_STORE_NAME,
  DOCUMENT_TYPE,
  DOCUMENT_TYPES,
  PAYMENT_METHOD,
  PAYMENT_METHODS,
  type Category,
  type DocumentType,
  type PaymentMethod,
  type Receipt,
} from "@/lib/types";
import { cn, formatDate, formatILS } from "@/lib/utils";

const DOC_TYPES: DocumentType[] = DOCUMENT_TYPES;

// Matches the Drive pickers' debounce.
const SEARCH_DEBOUNCE_MS = 300;
// Rows per page — the sheet grows without bound, so the table cannot render
// all of it at once.
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

type SortKey =
  | "storeName"
  | "amount"
  | "date"
  | "category"
  | "documentType"
  | "paymentMethod"
  | "totalReceiptAmount"
  | "fileName"
  | "confidence"
  | "reviewed";

interface ColumnDef {
  key: SortKey;
  label: string;
  filterable: boolean;
  getValue: (r: Receipt) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: "storeName",          label: "שם חנות",       filterable: true,  getValue: (r) => r.storeName ?? DEFAULT_STORE_NAME },
  { key: "amount",             label: "סכום",          filterable: false, getValue: (r) => (r.amount === null ? "" : String(r.amount)) },
  { key: "totalReceiptAmount", label: "סך הקבלה",      filterable: false, getValue: (r) => (r.totalReceiptAmount == null ? "" : String(r.totalReceiptAmount)) },
  { key: "paymentMethod",      label: "אמצעי תשלום",   filterable: true,  getValue: (r) => r.paymentMethod ?? PAYMENT_METHOD.Unknown },
  { key: "date",               label: "תאריך",         filterable: false, getValue: (r) => r.date ?? "" },
  { key: "category",           label: "קטגוריה",       filterable: true,  getValue: (r) => r.category },
  { key: "documentType",       label: "סוג מסמך",      filterable: true,  getValue: (r) => r.documentType },
  { key: "fileName",           label: "קובץ",          filterable: false, getValue: (r) => r.fileName },
  { key: "confidence",         label: "conf",          filterable: true,  getValue: (r) => r.confidence },
  { key: "reviewed",           label: "נבדק",          filterable: true,  getValue: (r) => (r.reviewed ? "כן" : "לא") },
];

function compareReceipts(a: Receipt, b: Receipt, key: SortKey, dir: "asc" | "desc"): number {
  let av: string | number | null;
  let bv: string | number | null;
  if (key === "amount") {
    av = a.amount;
    bv = b.amount;
  } else if (key === "totalReceiptAmount") {
    av = a.totalReceiptAmount ?? null;
    bv = b.totalReceiptAmount ?? null;
  } else if (key === "reviewed") {
    av = a.reviewed ? 1 : 0;
    bv = b.reviewed ? 1 : 0;
  } else {
    av = (a[key] as string | null) ?? "";
    bv = (b[key] as string | null) ?? "";
  }
  const aEmpty = av === null || av === undefined || av === "";
  const bEmpty = bv === null || bv === undefined || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  let cmp: number;
  if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv), "he");
  return dir === "asc" ? cmp : -cmp;
}

function PaymentMethodIcon({ method }: { method: PaymentMethod }) {
  const props = { className: "size-4 text-muted-foreground", "aria-label": method };
  switch (method) {
    case PAYMENT_METHOD.Credit: return <CreditCard {...props} />;
    case PAYMENT_METHOD.ForeignCard: return <CreditCard {...props} />;
    case PAYMENT_METHOD.Cash: return <Banknote {...props} />;
    case PAYMENT_METHOD.StandingOrder: return <Repeat {...props} />;
    case PAYMENT_METHOD.Mixed: return <Wallet {...props} />;
    case PAYMENT_METHOD.Other: return <MoreHorizontal {...props} />;
    default: return <HelpCircle {...props} />;
  }
}

function DocTypeBadge({ type }: { type: DocumentType }) {
  if (type !== DOCUMENT_TYPE.Duplicate && type !== DOCUMENT_TYPE.CreditSlip) return null;
  return (
    <Badge className="border border-border bg-muted px-2 py-0.5 text-[10px] font-normal tracking-normal normal-case">
      {type}
    </Badge>
  );
}

// null = every receipt, ignoring dates.
type PeriodChoice = { year: number; pair: MonthPair } | null;

const PERIOD_ALL = "all";

function encodePeriod(p: PeriodChoice): string {
  return p ? `${p.year}:${p.pair.m1}` : PERIOD_ALL;
}

function decodePeriod(value: string): PeriodChoice {
  if (value === PERIOD_ALL) return null;
  const [year, m1] = value.split(":").map(Number);
  const pair = MONTH_PAIRS.find((p) => p.m1 === m1);
  return pair ? { year, pair } : null;
}

// Newest first — the period being worked on is almost always the current one.
const PERIOD_OPTIONS: PeriodChoice[] = [...YEAR_OPTIONS]
  .reverse()
  .flatMap((year) => [...MONTH_PAIRS].reverse().map((pair) => ({ year, pair })));

function PeriodSelect({
  value,
  onChange,
  className,
}: {
  value: PeriodChoice;
  onChange: (p: PeriodChoice) => void;
  className?: string;
}) {
  return (
    <Select
      value={encodePeriod(value)}
      onValueChange={(v) => onChange(decodePeriod(v))}
    >
      <SelectTrigger className={className} aria-label="תקופת דוח">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIOD_OPTIONS.map((p) => (
          <SelectItem key={encodePeriod(p)} value={encodePeriod(p)}>
            {periodLabel(p!.year, p!.pair)}
          </SelectItem>
        ))}
        <SelectItem value={PERIOD_ALL}>כל הקבלות</SelectItem>
      </SelectContent>
    </Select>
  );
}

// One table row, memoized. Each row mounts three Inputs and three Radix
// Selects, so re-rendering all of them on every keystroke or drawer open was
// what made the table stall. Same fix as ExpenseRow in 9f5f32c. The memo only
// works because `patch` is a useCallback — an inline closure would give it a
// fresh identity every render and defeat it entirely.
const ReceiptRow = memo(function ReceiptRow({
  r,
  patch,
  readOnly,
  onDelete,
}: {
  r: Receipt;
  patch: (id: string, p: Partial<Receipt>) => void;
  readOnly: boolean;
  onDelete: (id: string) => void;
}) {
  return (
                  <TableRow>
                    <TableCell>
                      <Input
                        defaultValue={r.storeName ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (r.storeName ?? "")) patch(r.id, { storeName: v || null });
                        }}
                        disabled={readOnly}
                        className="h-8 w-32"
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <Input
                        defaultValue={r.amount ?? ""}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const v = raw === "" ? null : Number(raw);
                          if (v !== r.amount && (v === null || !Number.isNaN(v))) {
                            patch(r.id, { amount: v });
                          }
                        }}
                        disabled={readOnly}
                        className="h-8 w-20 text-right"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        {formatILS(r.amount)}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.totalReceiptAmount == null ? "—" : formatILS(r.totalReceiptAmount)}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.paymentMethod || PAYMENT_METHOD.Unknown}
                        onValueChange={(v) => patch(r.id, { paymentMethod: v as PaymentMethod })}
                        disabled={readOnly}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {r.cardLast4 && (
                        <div className="text-[10px] text-muted-foreground">
                          ★{r.cardLast4}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        defaultValue={r.date ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value || null;
                          if (v !== r.date) patch(r.id, { date: v });
                        }}
                        disabled={readOnly}
                        className="h-8"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        {formatDate(r.date)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.category}
                        onValueChange={(v) => patch(r.id, { category: v as Category })}
                        disabled={readOnly}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.documentType}
                        onValueChange={(v) => patch(r.id, { documentType: v as DocumentType })}
                        disabled={readOnly}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DOC_TYPES.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {r.driveFileId ? (
                        <a
                          href={`https://drive.google.com/file/d/${r.driveFileId}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline truncate inline-block max-w-full"
                          title={r.fileName}
                        >
                          {r.fileName}
                        </a>
                      ) : (
                        <span className="truncate inline-block max-w-full" title={r.fileName}>
                          {r.fileName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.confidence}</TableCell>
                    <TableCell>
                      <Checkbox
                        checked={r.reviewed}
                        onCheckedChange={(c) => patch(r.id, { reviewed: c === true })}
                        disabled={readOnly}
                      />
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onDelete(r.id)}
                          aria-label="מחיקת קבלה"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
  );
});

// The mobile counterpart of ReceiptRow, memoized for the same reason: tapping
// a card opens the drawer, which re-rendered every card on the page.
const ReceiptCard = memo(function ReceiptCard({
  r,
  readOnly,
  onEdit,
}: {
  r: Receipt;
  readOnly: boolean;
  onEdit: (id: string) => void;
}) {
  return (
              <Card
                role="button"
                tabIndex={0}
                onClick={() => { if (!readOnly) onEdit(r.id); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!readOnly) onEdit(r.id);
                  }
                }}
                size="sm"
                className="cursor-pointer"
              >
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-base font-semibold truncate">
                      {r.storeName ?? DEFAULT_STORE_NAME}
                    </div>
                    <div className="text-base font-semibold tabular-nums shrink-0">
                      {r.amount === null ? "—" : formatILS(r.amount)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{formatDate(r.date) || "—"}</span>
                      <span>·</span>
                      <span className="truncate">{r.category}</span>
                    </div>
                    <PaymentMethodIcon method={r.paymentMethod} />
                  </div>
                  {r.driveFileId ? (
                    <a
                      href={`https://drive.google.com/file/d/${r.driveFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm underline truncate block"
                      title={r.fileName}
                    >
                      {r.fileName}
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground truncate block" title={r.fileName}>
                      {r.fileName}
                    </span>
                  )}
                  {(r.documentType === DOCUMENT_TYPE.Duplicate ||
                    r.documentType === DOCUMENT_TYPE.CreditSlip) && (
                    <DocTypeBadge type={r.documentType} />
                  )}
                </CardContent>
              </Card>
  );
});

export function ReceiptTable({ readOnly = false }: { readOnly?: boolean }) {
  const [rows, setRows] = useState<Receipt[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The sheet holds every receipt ever scanned and only grows. Default to the
  // current reporting period; null = "all receipts".
  const [period, setPeriod] = useState<PeriodChoice>(() => ({
    year: CURRENT_YEAR,
    pair: currentMonthPair(),
  }));
  const [totalCount, setTotalCount] = useState(0);
  // Rows with an autosave in flight, for the inline "שומר…" marker.
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [fixingIds, setFixingIds] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" });
  const [colFilters, setColFilters] = useState<Partial<Record<SortKey, Set<string>>>>({});
  const [openCol, setOpenCol] = useState<SortKey | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The row the delete dialog is confirming, and its in-flight flag.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // The search box drove `filtered` on every keystroke, and `filtered`
  // rebuilds a haystack string per row before the whole table re-renders.
  // Same 300 ms shape as the Drive pickers.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!openCol) return;
    const onDoc = () => setOpenCol(null);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenCol(null);
    };
    const t = setTimeout(() => document.addEventListener("click", onDoc), 0);
    document.addEventListener("keydown", onEsc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [openCol]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let url = "/api/sheets";
      if (period) {
        const { from, to } = periodDateRange(period.year, period.pair);
        url += `?from=${from}&to=${to}`;
      }
      const r = await apiFetch(url);
      if (!r.ok) {
        // A 401 is already ending the session; anything else has to be shown,
        // or the user just sees an empty table and assumes there are no
        // receipts.
        if (r.status !== 401) setLoadError(await apiErrorMessage(r));
        return;
      }
      const json = (await r.json()) as {
        receipts: Receipt[];
        spreadsheetId: string;
        total?: number;
      };
      setRows(json.receipts);
      setSpreadsheetId(json.spreadsheetId);
      setTotalCount(json.total ?? json.receipts.length);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // load() sets its loading flag before the first await, which the rule
    // reads as a synchronous setState. Fetching on mount and on period change
    // is exactly the case it cannot tell apart from a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // useCallback so the memoized rows below keep a stable prop identity —
  // without it every row re-renders on every keystroke and the memo is inert.
  const patch = useCallback(
    async (id: string, patch: Partial<Receipt>) => {
      if (readOnly) return; // UI guard; the API enforces with 403 anyway
      let previous: Receipt | undefined;
      setRows((prev) => {
        previous = prev.find((r) => r.id === id);
        return prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      });
      // Not a blocking overlay: this fires on every field blur, so a modal veil
      // would flash between each pair of fields. A per-row marker instead.
      setSavingIds((prev) => new Set(prev).add(id));
      try {
        const r = await apiFetch("/api/sheets", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...patch }),
        });
        if (!r.ok) throw new Error(await apiErrorMessage(r));
      } catch (e) {
        // The optimistic update has to be rolled back, otherwise the table
        // shows a value that was never written to the sheet.
        if (previous) {
          const restore = previous;
          setRows((prev) => prev.map((r) => (r.id === id ? restore : r)));
        }
        toast.error("השמירה נכשלה: " + (e as Error).message);
      } finally {
        setSavingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [readOnly],
  );

  // Deliberately NOT optimistic, unlike patch: the list is sorted and paged, so
  // re-inserting a row after a failed delete would drop it somewhere the user
  // is not looking. The dialog stays open and holds the busy state instead.
  const confirmDelete = useCallback(async () => {
    if (!deletingId) return;
    const id = deletingId;
    setDeleteBusy(true);
    try {
      const r = await apiFetch(`/api/sheets?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(await apiErrorMessage(r));
      setRows((prev) => prev.filter((row) => row.id !== id));
      setTotalCount((n) => Math.max(0, n - 1));
      // The drawer may be open on the row that just went away.
      setEditingId((cur) => (cur === id ? null : cur));
      setDeletingId(null);
      toast.success("הקבלה נמחקה");
    } catch (e) {
      toast.error("המחיקה נכשלה: " + (e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }, [deletingId]);

  async function runFixDriveIds() {
    setFixingIds(true);
    try {
      const r = await apiFetch("/api/fix-drive-ids", { method: "POST" }, { blocking: true });
      const j = await r.json();
      if (!r.ok) { toast.error("שגיאה: " + (j.error || r.status)); return; }
      toast.success(
        `תוקנו ${j.fixed} קישורים\n` +
        `${j.alreadyCorrect} היו תקינים\n` +
        `${j.notFound} קבצים לא נמצאו ב-Drive`,
      );
      if (j.fixed > 0) await load();
    } finally {
      setFixingIds(false);
    }
  }

  async function runDedup() {
    setDedupRunning(true);
    try {
      const r = await apiFetch("/api/dedup", { method: "POST" }, { blocking: true });
      const j = await r.json();
      if (!r.ok) {
        toast.error("שגיאה: " + (j.error || r.status));
        return;
      }
      const s = j.summary || {};
      let msg =
        `הסתיים:\n• ${s.canonicalGroups ?? 0} שמות חנויות מאוחדים\n` +
        `• ${s.nameUpdates ?? 0} שורות עודכנו לשם קנוני\n` +
        `• ${s.placesResolutions ?? 0} שמות אומתו מול Google Places`;
      if (Array.isArray(s.placesChanges) && s.placesChanges.length > 0) {
        msg += ":\n" + (s.placesChanges as Array<{ from: string; to: string }>)
          .map((c) => `  ${c.from} → ${c.to}`)
          .join("\n");
      }
      msg +=
        `\n• ${s.duplicates ?? 0} כפילויות\n` +
        `• ${s.creditSlips ?? 0} ספחי אשראי משויכים`;
      toast.success(msg);
      await load();
    } finally {
      setDedupRunning(false);
    }
  }

  // Foreign-card receipts (a card not in the user's list) are documentation
  // only: excluded from the main table, filter facets, and exports; listed
  // in a separate collapsed section below the table.
  const mainRows = useMemo(
    () => rows.filter((r) => r.paymentMethod !== PAYMENT_METHOD.ForeignCard),
    [rows],
  );
  const foreignRows = useMemo(
    () => rows.filter((r) => r.paymentMethod === PAYMENT_METHOD.ForeignCard),
    [rows],
  );

  const uniqueValues = useMemo(() => {
    const map: Partial<Record<SortKey, string[]>> = {};
    for (const col of COLUMNS) {
      if (!col.filterable) continue;
      const set = new Set<string>();
      for (const r of mainRows) set.add(col.getValue(r));
      map[col.key] = Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
    }
    return map;
  }, [mainRows]);

  // Cross-facet-aware: for each facet, count values among rows that pass
  // every OTHER filterable facet's filter (the facet itself is excluded
  // from its own count basis, otherwise checking one value would zero out
  // the siblings and prevent re-broadening).
  const facetCounts = useMemo(() => {
    const out: Partial<Record<SortKey, Record<string, number>>> = {};
    for (const col of COLUMNS) {
      if (!col.filterable) continue;
      const counts: Record<string, number> = {};
      for (const r of mainRows) {
        let passes = true;
        for (const other of COLUMNS) {
          if (!other.filterable || other.key === col.key) continue;
          const set = colFilters[other.key];
          if (set && set.size > 0 && !set.has(other.getValue(r))) {
            passes = false;
            break;
          }
        }
        if (!passes) continue;
        const v = col.getValue(r);
        counts[v] = (counts[v] ?? 0) + 1;
      }
      out[col.key] = counts;
    }
    return out;
  }, [mainRows, colFilters]);

  const activeFilterCount = useMemo(
    () => Object.values(colFilters).reduce((n, s) => n + (s?.size ?? 0), 0),
    [colFilters],
  );

  function toggleFilterValue(key: SortKey, v: string) {
    setPage(1);
    setColFilters((prev) => {
      const cur = prev[key];
      const next = cur ? new Set(cur) : new Set<string>();
      if (next.has(v)) next.delete(v);
      else next.add(v);
      if (next.size === 0) {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: next };
    });
  }

  const filtered = useMemo(() => {
    return mainRows.filter((r) => {
      if (debouncedSearch) {
        const t = debouncedSearch.toLowerCase();
        const hay = [r.fileName, r.storeName, r.notes, r.date, String(r.amount)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(t)) return false;
      }
      for (const col of COLUMNS) {
        const set = colFilters[col.key];
        if (!set || set.size === 0) continue;
        if (!set.has(col.getValue(r))) return false;
      }
      return true;
    });
  }, [mainRows, debouncedSearch, colFilters]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const key = sort.key;
    return [...filtered].sort((a, b) => compareReceipts(a, b, key, sort.dir));
  }, [filtered, sort]);

  // Rendering every matching row is what makes the table crawl: each one
  // mounts three Inputs and three Radix Selects. Only a page of them is
  // rendered; exports and totals still work off the full `sorted` list.
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  );

  // Stable identity, or ReceiptCard's memo would be defeated by a fresh
  // closure on every render.
  const onEdit = useCallback((id: string) => setEditingId(id), []);
  // Same reason as onEdit — ReceiptRow's memo depends on a stable identity.
  const onDelete = useCallback((id: string) => setDeletingId(id), []);

  const editing = useMemo(
    () => (editingId ? rows.find((r) => r.id === editingId) ?? null : null),
    [editingId, rows],
  );

  const deleting = useMemo(
    () => (deletingId ? rows.find((r) => r.id === deletingId) ?? null : null),
    [deletingId, rows],
  );
  // Dedup writes `linkedTo` on duplicates; deleting their primary leaves those
  // links pointing at nothing, so the dialog says so rather than cascading.
  const deleteLinkedCount = useMemo(
    () => (deletingId ? rows.filter((r) => r.linkedTo === deletingId).length : 0),
    [deletingId, rows],
  );

  const driveLink = useCallback(
    (r: Receipt): string =>
      r.driveFileId ? `https://drive.google.com/file/d/${r.driveFileId}/view` : "",
    [],
  );

  function downloadCSV() {
    const headers = [
      "שם חנות", "סכום", "סך הקבלה", "אמצעי תשלום", "4 ספרות",
      "תאריך", "קטגוריה", "שם קובץ", "לינק לתמונה",
      "סוג מסמך", "מקושר ל", "confidence", "נבדק ידנית", "הערות",
    ];
    const lines = [headers.join(",")];
    for (const r of sorted) {
      lines.push(
        [
          quoteCSV(r.storeName ?? DEFAULT_STORE_NAME),
          r.amount ?? "",
          r.totalReceiptAmount ?? "",
          quoteCSV(r.paymentMethod ?? PAYMENT_METHOD.Unknown),
          quoteCSV(r.cardLast4 ?? ""),
          r.date ?? "",
          quoteCSV(r.category),
          quoteCSV(r.fileName),
          quoteCSV(driveLink(r)),
          quoteCSV(r.documentType),
          quoteCSV(r.linkedTo ?? ""),
          quoteCSV(r.confidence),
          r.reviewed ? "TRUE" : "FALSE",
          quoteCSV(r.notes ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    download(blob, "receipts.csv");
  }

  function downloadXLSX() {
    const data = sorted.map((r) => ({
      "שם חנות": r.storeName ?? DEFAULT_STORE_NAME,
      "סכום": r.amount ?? "",
      "סך הקבלה": r.totalReceiptAmount ?? "",
      "אמצעי תשלום": r.paymentMethod ?? PAYMENT_METHOD.Unknown,
      "4 ספרות": r.cardLast4 ?? "",
      "תאריך": r.date ?? "",
      "קטגוריה": r.category,
      "שם קובץ": r.fileName,
      "לינק לתמונה": driveLink(r),
      "סוג מסמך": r.documentType,
      "מקושר ל": r.linkedTo ?? "",
      confidence: r.confidence,
      "נבדק ידנית": r.reviewed ? "כן" : "",
      "הערות": r.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    (ws as unknown as { "!RTL": boolean })["!RTL"] = true;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "קבלות");
    XLSX.writeFile(wb, "receipts.xlsx");
  }

  return (
    <div className="space-y-3">
      {/* Desktop toolbar */}
      <div className="hidden md:flex flex-wrap gap-2 items-center">
        <PeriodSelect value={period} onChange={(p) => { setPeriod(p); setPage(1); }} className="h-9 w-40" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="חיפוש חופשי..."
          aria-label="חיפוש חופשי"
          className="h-9 max-w-xs"
        />
        {!readOnly && (
          <>
            <Button
              size="sm"
              onClick={runDedup}
              disabled={dedupRunning || rows.length === 0}
            >
              {dedupRunning && <Loader2 className="animate-spin size-4 me-2" />}
              {dedupRunning ? "מאחד..." : "איחוד שמות + זיהוי כפילויות וספחי אשראי"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={runFixDriveIds}
              disabled={fixingIds || rows.length === 0}
            >
              {fixingIds && <Loader2 className="animate-spin size-4 me-2" />}
              {fixingIds ? "מתקן..." : "תקן קישורי Drive"}
            </Button>
          </>
        )}
        <div className="flex-1" />
        {!readOnly && (
          <>
            <Button variant="outline" size="sm" onClick={downloadCSV}>
              הורד CSV
            </Button>
            <Button variant="outline" size="sm" onClick={downloadXLSX}>
              הורד Excel
            </Button>
            {spreadsheetId && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline"
              >
                פתח ב-Google Sheets
              </a>
            )}
          </>
        )}
      </div>

      {/* Mobile toolbar */}
      <div className="flex md:hidden flex-col gap-2">
        <PeriodSelect value={period} onChange={(p) => { setPeriod(p); setPage(1); }} className="h-9 w-full" />
      </div>
      <div className="flex md:hidden gap-2 items-start">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="חיפוש חופשי..."
          aria-label="חיפוש חופשי"
          className="h-9 flex-1 min-w-[12rem]"
        />
      </div>
      <div className="flex md:hidden gap-2 items-center">
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={rows.length === 0}>
                <Menu className="size-4 me-2" />
                פעולות
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={runDedup}
                disabled={dedupRunning || rows.length === 0}
              >
                {dedupRunning && <Loader2 className="animate-spin size-4 me-2" />}
                {dedupRunning ? "מאחד..." : "איחוד שמות + זיהוי כפילויות וספחי אשראי"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={runFixDriveIds}
                disabled={fixingIds || rows.length === 0}
              >
                {fixingIds && <Loader2 className="animate-spin size-4 me-2" />}
                {fixingIds ? "מתקן..." : "תקן קישורי Drive"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={downloadCSV}>הורד CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadXLSX}>הורד Excel</DropdownMenuItem>
              {spreadsheetId && (
                <DropdownMenuItem
                  onSelect={() => {
                    window.open(
                      `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  פתח ב-Google Sheets
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" disabled={rows.length === 0}>
              <ListFilter className="size-4 me-2" />
              מסננים
              {activeFilterCount > 0 && (
                <Badge className="ms-2 border border-border bg-muted px-1.5 py-0 text-[10px] font-normal tracking-normal normal-case">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex flex-col p-0 max-w-sm">
            <SheetHeader className="flex-row items-center justify-between border-b px-4 py-3 gap-2">
              <SheetTitle>מסננים</SheetTitle>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setColFilters({})}
                >
                  נקה הכל
                </Button>
              )}
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4">
              <Accordion
                type="multiple"
                defaultValue={COLUMNS.filter(
                  (c) => c.filterable && (colFilters[c.key]?.size ?? 0) > 0,
                ).map((c) => c.key)}
              >
                {COLUMNS.filter((c) => c.filterable).map((col) => {
                  const values = uniqueValues[col.key] || [];
                  if (values.length === 0) return null;
                  const set = colFilters[col.key];
                  const active = set?.size ?? 0;
                  const allSelected = active === values.length;
                  return (
                    <AccordionItem key={col.key} value={col.key}>
                      <AccordionTrigger>
                        <div className="flex items-center gap-2">
                          <span>{col.label}</span>
                          {active > 0 && (
                            <Badge className="border border-border bg-muted px-1.5 py-0 text-[10px] font-normal tracking-normal normal-case">
                              {active}
                            </Badge>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-1">
                          <Label className="flex items-center gap-2 py-1.5 cursor-pointer font-semibold">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={(c) => {
                                if (c === true) {
                                  setColFilters((prev) => ({
                                    ...prev,
                                    [col.key]: new Set(values),
                                  }));
                                } else {
                                  setColFilters((prev) => {
                                    const { [col.key]: _drop, ...rest } = prev;
                                    return rest;
                                  });
                                }
                              }}
                            />
                            <span className="flex-1">בחר הכל</span>
                          </Label>
                          <div className="border-t border-border my-1" />
                          {values.map((v) => {
                            const checked = set?.has(v) ?? false;
                            const count = facetCounts[col.key]?.[v] ?? 0;
                            const disabled = count === 0 && !checked;
                            return (
                              <Label
                                key={v}
                                className={cn(
                                  "flex items-center gap-2 py-1.5 font-normal",
                                  disabled
                                    ? "text-muted-foreground opacity-50 cursor-not-allowed"
                                    : "cursor-pointer",
                                )}
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={disabled}
                                  onCheckedChange={() => toggleFilterValue(col.key, v)}
                                />
                                <span className="flex-1 truncate">{v || "(ריק)"}</span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {count}
                                </span>
                              </Label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
            <SheetFooter className="border-t p-4">
              <SheetClose asChild>
                <Button>החל</Button>
              </SheetClose>
              <SheetClose asChild>
                <Button variant="ghost">סגור</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={rows.length === 0}>
              <ArrowUpDown className="size-4 me-2" />
              מיין לפי
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sort.key ?? ""}
              onValueChange={(k) =>
                setSort({ key: k as SortKey, dir: sort.dir })
              }
            >
              {COLUMNS.map((col) => (
                <DropdownMenuRadioItem key={col.key} value={col.key}>
                  {col.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sort.dir}
              onValueChange={(d) =>
                setSort({ key: sort.key, dir: d as "asc" | "desc" })
              }
            >
              <DropdownMenuRadioItem value="asc">עולה</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">יורד</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {sort.key && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setSort({ key: null, dir: sort.dir })}
                >
                  ניקוי
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-3">
        <span>{sorted.length} מתוך {mainRows.length} שורות</span>
        {(sort.key || activeFilterCount > 0) && (
          <button
            onClick={() => { setSort({ key: null, dir: "asc" }); setColFilters({}); }}
            className="underline"
          >
            נקה מיון וסינונים
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertTitle>טעינת הקבלות נכשלה</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void load()}
          >
            נסה שוב
          </Button>
        </Alert>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((col) => (
                    <ColumnHeader
                      key={col.key}
                      col={col}
                      sort={sort}
                      setSort={setSort}
                      colFilters={colFilters}
                      setColFilters={setColFilters}
                      openCol={openCol}
                      setOpenCol={setOpenCol}
                      values={uniqueValues[col.key] || []}
                    />
                  ))}
                  {/* Deliberately outside COLUMNS: that array drives sorting,
                      filtering and both exports, none of which apply here. */}
                  {!readOnly && <TableHead>פעולות</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((r) => (
                  <ReceiptRow key={r.id} r={r} patch={patch} readOnly={readOnly} onDelete={onDelete} />
                ))}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length + (readOnly ? 0 : 1)} className="p-6 text-center text-muted-foreground">
                      אין שורות.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card-list */}
          <div className="block md:hidden space-y-3">
            {sorted.length === 0 && (
              <p className="text-center text-muted-foreground py-6">אין שורות.</p>
            )}
            {paged.map((r) => (
              <ReceiptCard key={r.id} r={r} readOnly={readOnly} onEdit={onEdit} />
            ))}
          </div>

          {/* Pagination + scope readout */}
          <div className="flex flex-wrap items-center gap-3 pt-2 text-sm text-muted-foreground">
            <span>
              {sorted.length === 0
                ? "אין קבלות להצגה"
                : `מציג ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} מתוך ${sorted.length}`}
              {period && totalCount > rows.length && ` (${totalCount} בסך הכול)`}
            </span>
            <div className="flex-1" />
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-24" aria-label="שורות בעמוד">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                הקודם
              </Button>
              <span>
                {safePage} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                הבא
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Foreign-card receipts — documentation only, outside table + exports */}
      {!loading && foreignRows.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="foreign-cards">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <CreditCard className="size-4 text-muted-foreground" />
                {PAYMENT_METHOD.ForeignCard} — לתיעוד בלבד ({foreignRows.length})
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                {foreignRows.map((r) => (
                  <Card
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!readOnly) setEditingId(r.id); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (!readOnly) setEditingId(r.id);
                      }
                    }}
                    size="sm"
                    className="cursor-pointer"
                  >
                    <CardContent className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-base font-semibold truncate">
                          {r.storeName ?? DEFAULT_STORE_NAME}
                        </div>
                        <div className="text-base font-semibold tabular-nums shrink-0">
                          {r.amount === null ? "—" : formatILS(r.amount)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span>{formatDate(r.date) || "—"}</span>
                          <span>·</span>
                          <span className="truncate">{r.category}</span>
                          {r.cardLast4 && (
                            <>
                              <span>·</span>
                              <span className="tabular-nums">{r.cardLast4}</span>
                            </>
                          )}
                        </div>
                        <PaymentMethodIcon method={r.paymentMethod} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Edit drawer (mobile primary; also accessible on desktop) */}
      <Drawer open={editing !== null} onOpenChange={(o) => { if (!o) setEditingId(null); }}>
        <DrawerContent>
          {editing && (
            <>
              <DrawerHeader>
                <DrawerTitle className="flex items-center gap-2">
                  {editing.storeName ?? DEFAULT_STORE_NAME}
                  {savingIds.has(editing.id) && (
                    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      שומר…
                    </span>
                  )}
                </DrawerTitle>
                <DrawerDescription>{editing.fileName}</DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-4 space-y-4 overflow-y-auto">
                <div className="space-y-1.5">
                  <Label>שם חנות</Label>
                  <Input
                    defaultValue={editing.storeName ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (editing.storeName ?? "")) patch(editing.id, { storeName: v || null });
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>סכום</Label>
                    <Input
                      defaultValue={editing.amount ?? ""}
                      inputMode="decimal"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw === "" ? null : Number(raw);
                        if (v !== editing.amount && (v === null || !Number.isNaN(v))) {
                          patch(editing.id, { amount: v });
                        }
                      }}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>סכום קבלה כולל</Label>
                    <Input
                      defaultValue={editing.totalReceiptAmount ?? ""}
                      inputMode="decimal"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw === "" ? null : Number(raw);
                        if (v !== (editing.totalReceiptAmount ?? null) && (v === null || !Number.isNaN(v))) {
                          patch(editing.id, { totalReceiptAmount: v });
                        }
                      }}
                      className="text-right tabular-nums"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>תאריך</Label>
                    <Input
                      type="date"
                      defaultValue={editing.date ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value || null;
                        if (v !== editing.date) patch(editing.id, { date: v });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>קטגוריה</Label>
                    <Select
                      value={editing.category}
                      onValueChange={(v) => patch(editing.id, { category: v as Category })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>אמצעי תשלום</Label>
                    <Select
                      value={editing.paymentMethod || PAYMENT_METHOD.Unknown}
                      onValueChange={(v) => patch(editing.id, { paymentMethod: v as PaymentMethod })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>4 ספרות אחרונות</Label>
                    <Input
                      defaultValue={editing.cardLast4 ?? ""}
                      inputMode="numeric"
                      maxLength={4}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (editing.cardLast4 ?? "")) {
                          patch(editing.id, { cardLast4: v || null });
                        }
                      }}
                      className="font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>סוג מסמך</Label>
                  <Select
                    value={editing.documentType}
                    onValueChange={(v) => patch(editing.id, { documentType: v as DocumentType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOC_TYPES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>מקושר ל</Label>
                  <Input
                    defaultValue={editing.linkedTo ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (editing.linkedTo ?? "")) {
                        patch(editing.id, { linkedTo: v || null });
                      }
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>הערות</Label>
                  <Input
                    defaultValue={editing.notes ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (editing.notes ?? "")) patch(editing.id, { notes: v });
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="drawer-reviewed"
                    checked={editing.reviewed}
                    onCheckedChange={(c) => patch(editing.id, { reviewed: c === true })}
                  />
                  <Label htmlFor="drawer-reviewed">נבדק ידנית</Label>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>confidence: {editing.confidence}</div>
                  <div className="font-mono break-all">id: {editing.id}</div>
                  {editing.driveFileId && (
                    <a
                      href={`https://drive.google.com/file/d/${editing.driveFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline block"
                    >
                      drive_file_id: {editing.driveFileId}
                    </a>
                  )}
                </div>
              </div>
              <DrawerFooter>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => onDelete(editing.id)}
                  >
                    <Trash2 className="size-4" />
                    מחק
                  </Button>
                )}
                <DrawerClose asChild>
                  <Button variant="outline">סגור</Button>
                </DrawerClose>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>

      <DeleteReceiptDialog
        receipt={deleting}
        open={deletingId !== null}
        busy={deleteBusy}
        linkedCount={deleteLinkedCount}
        // A delete in flight must not be dismissed out from under itself.
        onOpenChange={(o) => { if (!o && !deleteBusy) setDeletingId(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function ColumnHeader({
  col, sort, setSort, colFilters, setColFilters, openCol, setOpenCol, values,
}: {
  col: ColumnDef;
  sort: { key: SortKey | null; dir: "asc" | "desc" };
  setSort: (s: { key: SortKey | null; dir: "asc" | "desc" }) => void;
  colFilters: Partial<Record<SortKey, Set<string>>>;
  setColFilters: React.Dispatch<React.SetStateAction<Partial<Record<SortKey, Set<string>>>>>;
  openCol: SortKey | null;
  setOpenCol: (k: SortKey | null) => void;
  values: string[];
}) {
  const isOpen = openCol === col.key;
  const sortIcon = sort.key === col.key ? (sort.dir === "asc" ? "▲" : "▼") : "";
  const filterSet = colFilters[col.key];
  const hasFilter = !!filterSet && filterSet.size > 0 && filterSet.size < values.length;

  return (
    <TableHead className="relative select-none">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpenCol(isOpen ? null : col.key);
        }}
        className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80"
      >
        <span>{col.label}</span>
        {sortIcon && <span className="text-[10px]">{sortIcon}</span>}
        {hasFilter && <span className="inline-block w-1.5 h-1.5 bg-primary" />}
        <span className="text-[10px] opacity-50">⋮</span>
      </button>
      {isOpen && (
        <ColumnPanel
          col={col}
          sort={sort}
          setSort={setSort}
          colFilters={colFilters}
          setColFilters={setColFilters}
          values={values}
        />
      )}
    </TableHead>
  );
}

function ColumnPanel({
  col, sort, setSort, colFilters, setColFilters, values,
}: {
  col: ColumnDef;
  sort: { key: SortKey | null; dir: "asc" | "desc" };
  setSort: (s: { key: SortKey | null; dir: "asc" | "desc" }) => void;
  colFilters: Partial<Record<SortKey, Set<string>>>;
  setColFilters: React.Dispatch<React.SetStateAction<Partial<Record<SortKey, Set<string>>>>>;
  values: string[];
}) {
  const currentSort = sort.key === col.key ? sort.dir : null;
  const filterSet = colFilters[col.key];
  const noFilter = !filterSet || filterSet.size === 0;

  function isChecked(v: string): boolean {
    if (noFilter) return true;
    return filterSet!.has(v);
  }

  function toggleValue(v: string) {
    setColFilters((prev) => {
      const cur = prev[col.key];
      const next = cur ? new Set(cur) : new Set(values);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      if (next.size === values.length || next.size === 0) {
        const { [col.key]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [col.key]: next };
    });
  }

  function showAll() {
    setColFilters((prev) => {
      const { [col.key]: _omit, ...rest } = prev;
      return rest;
    });
  }

  function checkOnly(v: string) {
    setColFilters((prev) => ({ ...prev, [col.key]: new Set([v]) }));
  }

  return (
    <div
      className="absolute top-full right-0 z-50 mt-1 w-56 border border-border bg-popover text-popover-foreground shadow-sm p-2 text-right font-normal"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-1 mb-2">
        <Button
          size="sm"
          variant={currentSort === "asc" ? "default" : "outline"}
          onClick={() => setSort({ key: col.key, dir: "asc" })}
          className="flex-1"
        >
          עולה
        </Button>
        <Button
          size="sm"
          variant={currentSort === "desc" ? "default" : "outline"}
          onClick={() => setSort({ key: col.key, dir: "desc" })}
          className="flex-1"
        >
          יורד
        </Button>
        {sort.key && (
          <Button size="sm" variant="ghost" onClick={() => setSort({ key: null, dir: sort.dir })}>
            ניקוי
          </Button>
        )}
      </div>
      {col.filterable && values.length > 0 && (
        <>
          <div className="border-t border-border my-2" />
          <div className="flex justify-between items-center text-xs mb-1 px-1">
            <span className="font-semibold">סנן ערכים</span>
            <button onClick={showAll} className="underline">
              הצג הכל
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {values.map((v) => (
              <div
                key={v}
                className="flex items-center gap-2 text-sm px-1 py-0.5 hover:bg-accent"
              >
                <Checkbox
                  checked={isChecked(v)}
                  onCheckedChange={() => toggleValue(v)}
                />
                <span className="flex-1 truncate" title={v}>
                  {v || "(ריק)"}
                </span>
                <button
                  onClick={() => checkOnly(v)}
                  className="text-[10px] underline opacity-60 hover:opacity-100"
                  title="הצג רק ערך זה"
                >
                  רק
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function quoteCSV(s: string): string {
  if (s == null) return "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
