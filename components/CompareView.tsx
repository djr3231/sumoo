"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { toast } from "sonner";
import type { BankTxn } from "@/lib/types";
import { formatDate, formatILS } from "@/lib/utils";

interface MatchResult {
  matched: { receiptId: string; txn: BankTxn }[];
  missingReceipts: BankTxn[];
  unmatchedReceipts: string[];
}

export function CompareView() {
  const [file, setFile] = useState<File | null>(null);
  const [fileTypeError, setFileTypeError] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [parsedTxns, setParsedTxns] = useState<BankTxn[]>([]);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(f: File | null) {
    setFileTypeError(null);
    if (!f) { setFile(null); return; }
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["csv", "xlsx", "xls", "pdf"].includes(ext)) {
      setFileTypeError("סוג קובץ לא נתמך — CSV, XLSX או PDF בלבד");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleParse() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sourceLabel", sourceLabel || file.name);
      const r = await fetch("/api/statements", { method: "POST", body: fd });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || "Parse failed");
      setParsedTxns(json.txns);
      const m = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txns: json.txns, saveToSheet: false }),
      });
      const mj = await m.json();
      if (!m.ok || !mj.ok) throw new Error(mj.error || "Match failed");
      setResult({
        matched: mj.matched,
        missingReceipts: mj.missingReceipts,
        unmatchedReceipts: mj.unmatchedReceipts,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveToSheet() {
    if (!result) return;
    const all = [
      ...result.matched.map((m) => m.txn),
      ...result.missingReceipts,
    ];
    const r = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txns: all, saveToSheet: true }),
    });
    if (r.ok) toast.success("נשמר ל-tab התנועות בגיליון.");
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 border border-border rounded-lg p-4">
        <h2 className="font-semibold">העלה תדפיס בנק / אשראי</h2>
        <p className="text-xs text-muted-foreground">
          תומך ב: PDF (ינותח בעזרת Claude), CSV, XLSX (ייצוא מבנקים ישראליים).
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="space-y-1">
            <input
              type="file"
              accept=".pdf,.csv,.xlsx,.xls"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            {fileTypeError && <p className="text-xs text-destructive">{fileTypeError}</p>}
          </div>
          <input
            placeholder='תווית מקור (למשל "ויזה 1234")'
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            className="h-9 px-3 rounded-md border border-border bg-transparent text-sm flex-1 min-w-[200px]"
          />
          <Button onClick={handleParse} disabled={!file || loading}>
            {loading ? "מעבד..." : "פרסר והשווה"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      {result && (
        <section className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="תאמו" value={result.matched.length} tone="green" />
            <Stat
              label="חסרה קבלה"
              value={result.missingReceipts.length}
              tone="red"
            />
            <Stat
              label="קבלה ללא תנועה"
              value={result.unmatchedReceipts.length}
              tone="yellow"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveToSheet} variant="outline">
              שמור תוצאות לגיליון
            </Button>
          </div>
          {result.missingReceipts.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">תנועות ללא קבלה</h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-right p-2">תאריך</th>
                      <th className="text-right p-2">סכום</th>
                      <th className="text-right p-2">תיאור</th>
                      <th className="text-right p-2">מקור</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.missingReceipts.map((t, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2">{formatDate(t.date)}</td>
                        <td className="p-2 tabular-nums">{formatILS(t.amount)}</td>
                        <td className="p-2">{t.description ?? "—"}</td>
                        <td className="p-2 text-muted-foreground">{t.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {parsedTxns.length > 0 && !result && (
        <p className="text-sm text-muted-foreground">
          חולצו {parsedTxns.length} תנועות. ממתין להשוואה...
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "red" | "yellow";
}) {
  const map = {
    green: "bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-100",
    red: "bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100",
    yellow:
      "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-100",
  } as const;
  return (
    <div className={`rounded-lg p-3 ${map[tone]}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
