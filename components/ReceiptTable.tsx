"use client";
import { useEffect, useMemo, useState } from "react";
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
import { Skeleton } from "./ui/Skeleton";
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

export function ReceiptTable({ readOnly = false }: { readOnly?: boolean }) {
  const [rows, setRows] = useState<Receipt[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [fixingIds, setFixingIds] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" });
  const [colFilters, setColFilters] = useState<Partial<Record<SortKey, Set<string>>>>({});
  const [openCol, setOpenCol] = useState<SortKey | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

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

  async function load() {
    setLoading(true);
    const r = await fetch("/api/sheets");
    const json = await r.json();
    if (r.ok) {
      setRows(json.receipts);
      setSpreadsheetId(json.spreadsheetId);
    }
    setLoading(false);
  }

  async function patch(id: string, patch: Partial<Receipt>) {
    if (readOnly) return; // UI guard; the API enforces with 403 anyway
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    await fetch("/api/sheets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
  }

  async function runFixDriveIds() {
    setFixingIds(true);
    try {
      const r = await fetch("/api/fix-drive-ids", { method: "POST" });
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
      const r = await fetch("/api/dedup", { method: "POST" });
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
      if (search) {
        const t = search.toLowerCase();
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
  }, [mainRows, search, colFilters]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const key = sort.key;
    return [...filtered].sort((a, b) => compareReceipts(a, b, key, sort.dir));
  }, [filtered, sort]);

  const editing = useMemo(
    () => (editingId ? rows.find((r) => r.id === editingId) ?? null : null),
    [editingId, rows],
  );

  function driveLink(r: Receipt): string {
    return r.driveFileId ? `https://drive.google.com/file/d/${r.driveFileId}/view` : "";
  }

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
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
      <div className="flex md:hidden gap-2 items-start">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.id}>
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
                  </TableRow>
                ))}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length} className="p-6 text-center text-muted-foreground">
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
            {sorted.map((r) => (
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
            ))}
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
                <DrawerTitle>{editing.storeName ?? DEFAULT_STORE_NAME}</DrawerTitle>
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
                <DrawerClose asChild>
                  <Button variant="outline">סגור</Button>
                </DrawerClose>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
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
