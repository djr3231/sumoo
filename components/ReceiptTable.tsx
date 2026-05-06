"use client";
import { useMemo, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { Button } from "./ui/Button";
import {
  CATEGORIES,
  type Category,
  type DocumentType,
  type Receipt,
} from "@/lib/types";
import { formatDate, formatILS } from "@/lib/utils";

const DOC_TYPES: DocumentType[] = ["קבלה", "זיכוי", "כפילות", "זיכוי-יתום", "לא ידוע"];

export function ReceiptTable() {
  const [rows, setRows] = useState<Receipt[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "הכל">("הכל");
  const [docTypeFilter, setDocTypeFilter] = useState<DocumentType | "הכל">("הכל");

  useEffect(() => {
    void load();
  }, []);

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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== "הכל" && r.category !== categoryFilter) return false;
      if (docTypeFilter !== "הכל" && r.documentType !== docTypeFilter) return false;
      if (filter) {
        const t = filter.toLowerCase();
        const hay = [r.fileName, r.storeName, r.notes, r.date, String(r.amount)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [rows, filter, categoryFilter, docTypeFilter]);

  function downloadCSV() {
    const headers = [
      "שם חנות",
      "סכום",
      "תאריך",
      "קטגוריה",
      "שם קובץ",
      "סוג מסמך",
      "מקושר ל",
      "confidence",
      "נבדק ידנית",
      "הערות",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          quoteCSV(r.storeName ?? "לא ידוע"),
          r.amount ?? "",
          r.date ?? "",
          quoteCSV(r.category),
          quoteCSV(r.fileName),
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
    const data = filtered.map((r) => ({
      "שם חנות": r.storeName ?? "לא ידוע",
      "סכום": r.amount ?? "",
      "תאריך": r.date ?? "",
      "קטגוריה": r.category,
      "שם קובץ": r.fileName,
      "סוג מסמך": r.documentType,
      "מקושר ל": r.linkedTo ?? "",
      confidence: r.confidence,
      "נבדק ידנית": r.reviewed ? "כן" : "",
      "הערות": r.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    if (!ws["!props"]) ws["!props"] = {};
    (ws as any)["!RTL"] = true;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "קבלות");
    XLSX.writeFile(wb, "receipts.xlsx");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="חיפוש חופשי..."
          className="h-9 px-3 rounded-md border border-[hsl(var(--border))] bg-transparent text-sm"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as any)}
          className="h-9 px-2 rounded-md border border-[hsl(var(--border))] bg-transparent text-sm"
        >
          <option value="הכל">כל הקטגוריות</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={docTypeFilter}
          onChange={(e) => setDocTypeFilter(e.target.value as any)}
          className="h-9 px-2 rounded-md border border-[hsl(var(--border))] bg-transparent text-sm"
        >
          <option value="הכל">כל הסוגים</option>
          {DOC_TYPES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
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

      <div className="text-xs text-[hsl(var(--muted-foreground))]">
        {filtered.length} מתוך {rows.length} שורות
      </div>

      {loading ? (
        <p className="text-sm">טוען...</p>
      ) : (
        <div className="rounded-lg border border-[hsl(var(--border))] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--muted))]">
              <tr>
                <th className="text-right p-2 whitespace-nowrap">שם חנות</th>
                <th className="text-right p-2 whitespace-nowrap">סכום</th>
                <th className="text-right p-2 whitespace-nowrap">תאריך</th>
                <th className="text-right p-2 whitespace-nowrap">קטגוריה</th>
                <th className="text-right p-2 whitespace-nowrap">סוג מסמך</th>
                <th className="text-right p-2 whitespace-nowrap">קובץ</th>
                <th className="text-right p-2 whitespace-nowrap">conf</th>
                <th className="text-right p-2 whitespace-nowrap">נבדק</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-[hsl(var(--border))] ${
                    r.documentType === "כפילות"
                      ? "bg-yellow-50/50 dark:bg-yellow-900/10"
                      : r.documentType === "זיכוי" || r.documentType === "זיכוי-יתום"
                        ? "bg-red-50/50 dark:bg-red-900/10"
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
                        <option key={c} value={c}>
                          {c}
                        </option>
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
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td
                    className="p-2 max-w-[180px] truncate"
                    title={r.fileName}
                  >
                    {r.fileName}
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-[hsl(var(--muted-foreground))]">
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
