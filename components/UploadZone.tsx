"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "./ui/Button";
import type { Receipt } from "@/lib/types";

const CONCURRENCY = 5;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function UploadZone() {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<Receipt[]>([]);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [], "application/pdf": [] },
    multiple: true,
  });

  async function processOne(file: File): Promise<Receipt> {
    const base64 = await fileToBase64(file);
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "upload",
        fileName: file.name,
        mediaType: file.type || "image/jpeg",
        base64,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "OCR failed");
    return json.receipt as Receipt;
  }

  async function startProcessing() {
    setRunning(true);
    setResults([]);
    setErrors([]);
    setProgress({ done: 0, total: files.length });

    const queue = [...files];
    let done = 0;
    const newResults: Receipt[] = [];
    const newErrors: { name: string; error: string }[] = [];

    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const f = queue.shift();
        if (!f) break;
        try {
          const r = await processOne(f);
          newResults.push(r);
          await fetch("/api/sheets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receipts: [r] }),
          });
        } catch (e) {
          newErrors.push({ name: f.name, error: (e as Error).message });
        } finally {
          done++;
          setProgress({ done, total: files.length });
          setResults([...newResults]);
          setErrors([...newErrors]);
        }
      }
    });

    await Promise.all(workers);
    setRunning(false);
  }

  async function runDedup() {
    await fetch("/api/dedup", { method: "POST" });
    alert("הסתיים זיהוי כפילויות וזיכויים. ראה את הטבלה.");
  }

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
          isDragActive
            ? "border-[hsl(var(--primary))] bg-[hsl(var(--accent))]"
            : "border-[hsl(var(--border))]"
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-sm">
          {isDragActive
            ? "שחרר כאן..."
            : "גרור תמונות קבלה לכאן, או לחץ לבחירה (ניתן לבחור מאות בבת אחת)"}
        </p>
      </div>

      {files.length > 0 && (
        <div className="flex items-center gap-3">
          <Button onClick={startProcessing} disabled={running}>
            {running
              ? `מעבד ${progress.done}/${progress.total}...`
              : `התחל סריקה (${files.length} קבצים)`}
          </Button>
          <Button variant="outline" onClick={() => setFiles([])} disabled={running}>
            נקה
          </Button>
          {!running && results.length > 0 && (
            <Button variant="outline" onClick={runDedup}>
              זיהוי כפילויות וזיכויים
            </Button>
          )}
        </div>
      )}

      {progress.total > 0 && (
        <div className="w-full bg-[hsl(var(--muted))] rounded h-2 overflow-hidden">
          <div
            className="h-full bg-[hsl(var(--primary))] transition-[width]"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--muted))]">
              <tr>
                <th className="text-right p-2">שם חנות</th>
                <th className="text-right p-2">סכום</th>
                <th className="text-right p-2">תאריך</th>
                <th className="text-right p-2">קטגוריה</th>
                <th className="text-right p-2">סוג</th>
                <th className="text-right p-2">קובץ</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-t border-[hsl(var(--border))]">
                  <td className="p-2">{r.storeName ?? "לא ידוע"}</td>
                  <td className="p-2 tabular-nums">
                    {r.amount === null ? "—" : r.amount.toFixed(2)}
                  </td>
                  <td className="p-2">{r.date ?? "—"}</td>
                  <td className="p-2">{r.category}</td>
                  <td className="p-2">{r.documentType}</td>
                  <td className="p-2 truncate max-w-[200px]" title={r.fileName}>
                    {r.fileName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--destructive))] p-3 text-sm">
          <p className="font-semibold mb-1">שגיאות ({errors.length})</p>
          <ul className="list-disc pr-5 space-y-1">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{e.name}</span>: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
