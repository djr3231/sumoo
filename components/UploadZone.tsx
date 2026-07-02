"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Alert, AlertDescription, AlertTitle } from "./ui/Alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Loader2, Upload } from "lucide-react";
import { DEFAULT_STORE_NAME, type Receipt } from "@/lib/types";
import { DriveFolderPicker, type FolderSelection } from "./DriveFolderPicker";

const FOLDER_STORAGE_KEY = "sumoo:upload:folder";

type ScanContext = { knownStores?: string[]; userCards?: string[] };

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

// Mobile connections drop mid-batch; a network-level fetch rejection
// ("Failed to fetch" — no HTTP status) is retried with escalating
// delays, which also covers the page waking up from a brief suspension.
// HTTP errors are NOT retried here: 503/429 have the halt/pause
// mechanism, and retrying 500s would double the Gemini cost.
const NET_RETRY_DELAYS_MS = [2000, 5000, 10000];

async function postWithNetRetry(url: string, body: unknown) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postOnce(url, body);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status !== undefined || attempt >= NET_RETRY_DELAYS_MS.length) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, NET_RETRY_DELAYS_MS[attempt]));
    }
  }
}

export function UploadZone() {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<Receipt[]>([]);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState<FolderSelection>({ kind: "default" });
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FOLDER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (
        parsed?.kind === "drive" &&
        typeof parsed.id === "string" &&
        typeof parsed.name === "string"
      ) {
        setFolder({ kind: "drive", id: parsed.id, name: parsed.name });
      }
    } catch {
      // ignore parse errors — keep default
    }
  }, []);

  function handleFolderChange(next: FolderSelection) {
    setFolder(next);
    try {
      localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [], "application/pdf": [] },
    multiple: true,
  });

  async function processOne(file: File, ctx: ScanContext): Promise<Receipt[]> {
    const { base64, mediaType } = await resizeToBase64(file);
    const json = await postWithNetRetry("/api/ocr", {
      kind: "upload",
      fileName: file.name,
      mediaType,
      base64,
      ...(folder.kind === "drive" ? { folderId: folder.id } : {}),
      ...(ctx.knownStores ? { knownStores: ctx.knownStores } : {}),
      ...(ctx.userCards ? { userCards: ctx.userCards } : {}),
    });
    if (!json.ok) throw new Error(json.error || "OCR failed");
    return (json.receipts as Receipt[]) || [];
  }

  // Base values arrive as explicit parameters: React state set inside the
  // caller (e.g. startProcessing's resets) is not visible to this closure
  // in the same tick — reading progress/results/errors here produced the
  // stale 50/49 counter and error entries surviving a successful retry.
  interface BatchBase {
    baseDone: number;
    total: number;
    baseResults: Receipt[];
    baseErrors: { name: string; error: string }[];
  }

  async function runBatch(toProcess: File[], base: BatchBase) {
    if (toProcess.length === 0) return;
    setRunning(true);
    setPaused(false);

    // A large batch runs for many minutes; on mobile, the screen locking
    // suspends the page and aborts in-flight fetches ("Failed to fetch").
    // Hold a screen wake lock for the duration when the browser supports it.
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // unsupported or denied — scanning proceeds without it
    }

    // Fetch the batch-invariant context once, so each file's /api/ocr call
    // skips its own stores + settings Sheets reads (the 60-reads/min quota).
    // On failure, ctx stays empty and the server reads per file, as before.
    let ctx: ScanContext = {};
    try {
      const r = await fetch("/api/scan-context");
      if (r.ok) ctx = await r.json();
    } catch {
      // ignore — fall back to per-file server reads
    }

    const totalForProgress = base.total > 0 ? base.total : toProcess.length;
    const baseDone = base.baseDone;
    setProgress({ done: baseDone, total: totalForProgress });

    const queue = [...toProcess];
    const newResults: Receipt[] = [...base.baseResults];
    const newErrors: { name: string; error: string }[] = [...base.baseErrors];
    const state = {
      consecutiveOverloads: 0,
      halted: false,
      doneCount: baseDone,
      succeeded: new Set<File>(),
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      async () => {
        while (queue.length && !state.halted) {
          const f = queue.shift();
          if (!f) break;
          try {
            const rs = await processOne(f, ctx);
            newResults.push(...rs);
            state.consecutiveOverloads = 0;
            if (rs.length > 0) {
              await fetch("/api/sheets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ receipts: rs }),
              });
            }
            state.succeeded.add(f);
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

    // Successfully scanned files leave the queue; failed and unprocessed
    // (halted) files remain, so the next "התחל סריקה" retries only them —
    // no re-photographing, no duplicate scans of already-saved receipts.
    setFiles((prev) => prev.filter((f) => !state.succeeded.has(f)));

    if (state.halted) {
      setPendingFiles(queue);
      setPaused(true);
    } else {
      setPendingFiles([]);
    }

    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setRunning(false);
  }

  async function startProcessing() {
    setResults([]);
    setErrors([]);
    setPendingFiles([]);
    await runBatch(files, {
      baseDone: 0,
      total: files.length,
      baseResults: [],
      baseErrors: [],
    });
  }

  async function resume() {
    // Click handler — state values here are current, so continuing the
    // paused batch's counter and lists is correct.
    await runBatch(pendingFiles, {
      baseDone: progress.done,
      total: progress.total,
      baseResults: results,
      baseErrors: errors,
    });
  }

  const pct = progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center gap-3 p-8 text-center min-h-[140px] ${
          isDragActive ? "border-primary bg-accent" : "border-border hover:border-muted-foreground"
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isDragActive
            ? "שחרר כאן..."
            : "גרור תמונות קבלה לכאן, או לחץ לבחירה (ניתן לבחור מאות בבת אחת)"}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>תיקיית יעד ב-Drive</Label>
        <DriveFolderPicker
          value={folder}
          onChange={handleFolderChange}
          disabled={running}
        />
      </div>

      {files.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={startProcessing} disabled={running || paused}>
            {running && <Loader2 className="animate-spin size-4 me-2" />}
            {running
              ? `מעבד ${progress.done}/${progress.total}...`
              : `התחל סריקה (${files.length} קבצים)`}
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={running}>
                נקה
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>לנקות את כל הקבצים?</DialogTitle>
                <DialogDescription>
                  קבצים שטרם נסרקו יימחקו לצמיתות. קבצים שכבר נסרקו — המקור שלהם נשמר בדרייב.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="destructive" onClick={() => setFiles([])}>
                    נקה הכל
                  </Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="outline">ביטול</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Rendered outside the files gate so it survives a fully successful
          batch, when the queue empties itself. */}
      {!running && results.length > 0 && (
        <a href="/receipts" className="text-sm underline">
          עבור לטבלת הקבלות לזיהוי כפילויות וייצוא
        </a>
      )}

      {progress.total > 0 && (
        <Progress value={pct} />
      )}

      {paused && (
        <Alert>
          <AlertTitle>⏸ הסריקה הושהתה — Gemini עמוס</AlertTitle>
          <AlertDescription>
            {pendingFiles.length} קבצים ממתינים. נסה שוב כשהשרת ישתחרר (לעיתים נדרשות מספר דקות).
          </AlertDescription>
          <Button onClick={resume} disabled={running} className="mt-2">
            המשך סריקה ({pendingFiles.length})
          </Button>
        </Alert>
      )}

      {results.length > 0 && (
        <div className="border border-border overflow-hidden">
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
                  <td className="p-2">{r.storeName ?? DEFAULT_STORE_NAME}</td>
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
        <Alert variant="destructive">
          <AlertTitle>שגיאות ({errors.length})</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pr-5 space-y-1 mt-1">
              {errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{e.name}</span>: {e.error}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
