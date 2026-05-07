"use client";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "./ui/Button";
import {
  CATEGORIES,
  DOCUMENT_TYPES,
  PAYMENT_METHODS,
  type Category,
  type DocumentType,
  type PaymentMethod,
  type Receipt,
} from "@/lib/types";
import { formatDate, formatILS } from "@/lib/utils";

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
  { key: "storeName",          label: "שם חנות",       filterable: true,  getValue: (r) => r.storeName ?? "לא ידוע" },
  { key: "amount",             label: "סכום",          filterable: false, getValue: (r) => (r.amount === null ? "" : String(r.amount)) },
  { key: "totalReceiptAmount", label: "סך הקבלה",      filterable: false, getValue: (r) => (r.totalReceiptAmount == null ? "" : String(r.totalReceiptAmount)) },
  { key: "paymentMethod",      label: "אמצעי תשלום",   filterable: true,  getValue: (r) => r.paymentMethod ?? "לא ידוע" },
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

export function ReceiptTable() {
  const [rows, setRows] = useState<Receipt[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const [colFilters, setColFilters] = useState<Partial<Record<SortKey, Set<string>>>>({});
  const [openCol, setOpenCol] = useState<SortKey | null>(null);

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
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    await fetch("/api/sheets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
  }

  async function runDedup() {
    setDedupRunning(true);
    try {
      const r = await fetch("/api/dedup", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        alert("שגיאה: " + (j.error || r.status));
        return;
      }
      const s = j.summary || {};
      alert(
        `הסתיים:\n• ${s.canonicalGroups ?? 0} שמות חנויות מאוחדים\n` +
        `• ${s.nameUpdates ?? 0} שורות עודכנו לשם קנוני\n` +
        `• ${s.placesResolutions ?? 0} שמות אומתו מול Google Places\n` +
        `• ${s.duplicates ?? 0} כפילויות\n` +
        `• ${s.creditSlips ?? 0} ספחי אשראי משויכים`,
      );
      await load();
    } finally {
      setDedupRunning(false);
    }
  }

  const uniqueValues = useMemo(() => {
    const map: Partial<Record<SortKey, string[]>> = {};
    for (const col of COLUMNS) {
      if (!col.filterable) continue;
      const set = new Set<string>();
      for (const r of rows) set.add(col.getValue(r));
      map[col.key] = Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
    }
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
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
  }, [rows, search, colFilters]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    return [...filtered].sort((a, b) => compareReceipts(a, b, sort.key, sort.dir));
  }, [filtered, sort]);

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
          quoteCSV(r.storeName ?? "לא ידוע"),
          r.amount ?? "",
          r.totalReceiptAmount ?? "",
          quoteCSV(r.paymentMethod ?? "לא ידוע"),
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
      "שם חנות": r.storeName ?? "לא ידוע",
      "סכום": r.amount ?? "",
      "סך הקבלה": r.totalReceiptAmount ?? "",
      "אמצעי תשלום": r.paymentMethod ?? "לא ידוע",
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
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש חופשי..."
          className="h-9 px-3 rounded-md border border-[hsl(var(--border))] bg-transparent text-sm"
        />
        <Button
          size="sm"
          onClick={runDedup}
          disabled={dedupRunning || rows.length === 0}
        >
          {dedupRunning ? "מאחד..." : "איחוד שמות + זיהוי כפילויות וספחי אשראי"}
        </Button>
        <div className="flex-1" />
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
      </div>

      <div className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-3">
        <span>{sorted.length} מתוך {rows.length} שורות</span>
        {(sort || Object.values(colFilters).some((s) => s && s.size > 0)) && (
          <button
            onClick={() => { setSort(null); setColFilters({}); }}
            className="underline"
          >
            נקה מיון וסינונים
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm">טוען...</p>
      ) : (
        <div className="rounded-lg border border-[hsl(var(--border))] overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--muted))]">
              <tr>
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
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-[hsl(var(--border))] ${
                    r.documentType === "כפילות" || r.documentType === "ספח אשראי"
                      ? "bg-yellow-50/50 dark:bg-yellow-900/10"
                      : ""
                  }`}
                >
                  <td className="p-2">
                    <input
                      defaultValue={r.storeName ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (r.storeName ?? "")) patch(r.id, { storeName: v || null });
                      }}
                      className="bg-transparent w-32 px-1"
                    />
                  </td>
                  <td className="p-2 tabular-nums">
                    <input
                      defaultValue={r.amount ?? ""}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw === "" ? null : Number(raw);
                        if (v !== r.amount && (v === null || !Number.isNaN(v))) {
                          patch(r.id, { amount: v });
                        }
                      }}
                      className="bg-transparent w-20 text-right px-1"
                    />
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      {formatILS(r.amount)}
                    </div>
                  </td>
                  <td className="p-2 tabular-nums text-[hsl(var(--muted-foreground))]">
                    {r.totalReceiptAmount == null ? "—" : formatILS(r.totalReceiptAmount)}
                  </td>
                  <td className="p-2">
                    <select
                      value={r.paymentMethod || "לא ידוע"}
                      onChange={(e) => patch(r.id, { paymentMethod: e.target.value as PaymentMethod })}
                      className="bg-transparent px-1"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    {r.cardLast4 && (
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        ★{r.cardLast4}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <input
                      type="date"
                      defaultValue={r.date ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value || null;
                        if (v !== r.date) patch(r.id, { date: v });
                      }}
                      className="bg-transparent px-1"
                    />
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      {formatDate(r.date)}
                    </div>
                  </td>
                  <td className="p-2">
                    <select
                      value={r.category}
                      onChange={(e) => patch(r.id, { category: e.target.value as Category })}
                      className="bg-transparent px-1"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <select
                      value={r.documentType}
                      onChange={(e) => patch(r.id, { documentType: e.target.value as DocumentType })}
                      className="bg-transparent px-1"
                    >
                      {DOC_TYPES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 max-w-[200px]">
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
                  </td>
                  <td className="p-2 text-[hsl(var(--muted-foreground))]">{r.confidence}</td>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={r.reviewed}
                      onChange={(e) => patch(r.id, { reviewed: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="p-6 text-center text-[hsl(var(--muted-foreground))]">
                    אין שורות.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ColumnHeader({
  col, sort, setSort, colFilters, setColFilters, openCol, setOpenCol, values,
}: {
  col: ColumnDef;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  setSort: (s: { key: SortKey; dir: "asc" | "desc" } | null) => void;
  colFilters: Partial<Record<SortKey, Set<string>>>;
  setColFilters: React.Dispatch<React.SetStateAction<Partial<Record<SortKey, Set<string>>>>>;
  openCol: SortKey | null;
  setOpenCol: (k: SortKey | null) => void;
  values: string[];
}) {
  const isOpen = openCol === col.key;
  const sortIcon = sort?.key === col.key ? (sort.dir === "asc" ? "▲" : "▼") : "";
  const filterSet = colFilters[col.key];
  const hasFilter = !!filterSet && filterSet.size > 0 && filterSet.size < values.length;

  return (
    <th className="text-right p-2 whitespace-nowrap relative select-none">
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
        {hasFilter && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />}
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
    </th>
  );
}

function ColumnPanel({
  col, sort, setSort, colFilters, setColFilters, values,
}: {
  col: ColumnDef;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  setSort: (s: { key: SortKey; dir: "asc" | "desc" } | null) => void;
  colFilters: Partial<Record<SortKey, Set<string>>>;
  setColFilters: React.Dispatch<React.SetStateAction<Partial<Record<SortKey, Set<string>>>>>;
  values: string[];
}) {
  const currentSort = sort?.key === col.key ? sort.dir : null;
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
      className="absolute top-full right-0 z-50 mt-1 w-56 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg p-2 text-right font-normal"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-1 mb-2">
        <Button
          size="sm"
          variant={currentSort === "asc" ? "primary" : "outline"}
          onClick={() => setSort({ key: col.key, dir: "asc" })}
          className="flex-1"
        >
          A→Z
        </Button>
        <Button
          size="sm"
          variant={currentSort === "desc" ? "primary" : "outline"}
          onClick={() => setSort({ key: col.key, dir: "desc" })}
          className="flex-1"
        >
          Z→A
        </Button>
        {sort && (
          <Button size="sm" variant="ghost" onClick={() => setSort(null)}>
            ניקוי
          </Button>
        )}
      </div>
      {col.filterable && values.length > 0 && (
        <>
          <div className="border-t border-[hsl(var(--border))] my-2" />
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
                className="flex items-center gap-2 text-sm px-1 py-0.5 hover:bg-[hsl(var(--accent))] rounded"
              >
                <input
                  type="checkbox"
                  checked={isChecked(v)}
                  onChange={() => toggleValue(v)}
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
