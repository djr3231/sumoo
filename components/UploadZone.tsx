"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "./ui/Button";
import type { Receipt } from "@/lib/types";

const CONCURRENCY = 2;
const MAX_DIM = 1568;
const MAX_CONSECUTIVE_OVERLOADS = 3;

async function bufferToBase64(buf: ArrayBuffer): Promise<string> {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function resizeToBase64(
  file: File,
): Promise<{ base64: string; mediaType: string }> {
  if (!file.type.startsWith("image/")) {
    return { base64: await bufferToBase64(await file.arrayBuffer()), mediaType: file.type || "application/octet-stream" };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image decode failed"));
      i.src = url;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob>((res, rej) =>
      c.toBlob(
        (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
        "image/jpeg",
        0.85,
      ),
    );
    return { base64: await bufferToBase64(await blob.arrayBuffer()), mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function postOnce(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.error || `HTTP ${res.status}`) as Error & {
      status?: number;
    };
    e.status = res.status;
    throw e;
  }
  return j;
}

export function UploadZone() {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<Receipt[]>([]);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [], "application/pdf": [] },
    multiple: true,
  });

  async function processOne(file: File): Promise<Receipt[]> {
    const { base64, mediaType } = await resizeToBase64(file);
    const json = await postOnce("/api/ocr", {
      kind: "upload",
      fileName: file.name,
      mediaType,
      base64,
    });
    if (!json.ok) throw new Error(json.error || "OCR failed");
    return (json.receipts as Receipt[]) || [];
  }

  async function runBatch(toProcess: File[]) {
    if (toProcess.length === 0) return;
    setRunning(true);
    setPaused(false);

    const totalForProgress = progress.total > 0 ? progress.total : toProcess.length;
    const baseDone = progress.done;
    setProgress({ done: baseDone, total: totalForProgress });

    const queue = [...toProcess];
    const newResults: Receipt[] = [...results];
    const newErrors: { name: string; error: string }[] = [...errors];
    const state = { consecutiveOverloads: 0, halted: false, doneCount: baseDone };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      async () => {
        while (queue.length && !state.halted) {
          const f = queue.shift();
          if (!f) break;
          try {
            const rs = await processOne(f);
            newResults.push(...rs);
            state.consecutiveOverloads = 0;
            if (rs.length > 0) {
              await fetch("/api/sheets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ receipts: rs }),
              });
            }
          } catch (e) {
            const err = e as Error & { status?: number };
            newErrors.push({ name: f.name, error: err.message });
            if (err.status === 503 || err.status === 429) {
              state.consecutiveOverloads++;
              if (state.consecutiveOverloads >= MAX_CONSECUTIVE_OVERLOADS) {
                state.halted = true;
              }
            } else {
              state.consecutiveOverloads = 0;
            }
          } finally {
            state.doneCount++;
            setProgress({ done: state.doneCount, total: totalForProgress });
            setResults([...newResults]);
            setErrors([...newErrors]);
          }
        }
      },
    );

    await Promise.all(workers);

    if (state.halted) {
      setPendingFiles(queue);
      setPaused(true);
    } else {
      setPendingFiles([]);
    }
    setRunning(false);
  }

  async function startProcessing() {
    setResults([]);
    setErrors([]);
    setProgress({ done: 0, total: files.length });
    setPendingFiles([]);
    await runBatch(files);
  }

  async function resume() {
    await runBatch(pendingFiles);
  }

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
          isDragActive
            ? "border-primary bg-accent"
            : "border-border"
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
          <Button onClick={startProcessing} disabled={running || paused}>
            {running
              ? `מעבד ${progress.done}/${progress.total}...`
              : `התחל סריקה (${files.length} קבצים)`}
          </Button>
          <Button variant="outline" onClick={() => setFiles([])} disabled={running}>
            נקה
          </Button>
          {!running && results.length > 0 && (
            <a
              href="/receipts"
              className="text-sm underline"
            >
              עבור לטבלת הקבלות לזיהוי כפילויות וייצוא
            </a>
          )}
        </div>
      )}

      {progress.total > 0 && (
        <div className="w-full bg-muted rounded-sm h-2 overflow-hidden">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      {paused && (
        <div className="rounded-lg border border-amber-500 bg-amber-50 dark:bg-amber-950 p-3 text-sm">
          <p className="font-semibold mb-2">⏸ הסריקה הושהתה — Gemini עמוס</p>
          <p className="mb-2">
            {pendingFiles.length} קבצים ממתינים. נסה שוב כשהשרת ישתחרר (לעיתים נדרשות מספר דקות).
          </p>
          <Button onClick={resume} disabled={running}>
            המשך סריקה ({pendingFiles.length})
          </Button>
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
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
                <tr key={r.id} className="border-t border-border">
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
        <div className="rounded-lg border border-destructive p-3 text-sm">
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
