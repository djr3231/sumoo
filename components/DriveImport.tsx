"use client";
import { useState } from "react";
import { Button } from "./ui/Button";
import type { Receipt } from "@/lib/types";

const CONCURRENCY = 2;
const MAX_CONSECUTIVE_OVERLOADS = 3;

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

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export function DriveImport() {
  const [folderId, setFolderId] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Receipt[]>([]);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const [paused, setPaused] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<DriveFile[]>([]);

  function extractFolderId(input: string): string {
    const m = input.match(/folders\/([\w-]+)/);
    return m ? m[1] : input.trim();
  }

  async function loadFolder() {
    const id = extractFolderId(folderId);
    const res = await fetch(`/api/drive?folderId=${encodeURIComponent(id)}`);
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || "שגיאה בטעינת התיקייה");
      return;
    }
    setFiles(json.files);
    setPendingFiles([]);
    setPaused(false);
    setResults([]);
    setErrors([]);
    setProgress({ done: 0, total: 0 });
  }

  async function processOne(file: DriveFile): Promise<Receipt[]> {
    const json = await postOnce("/api/ocr", {
      kind: "drive",
      driveFileId: file.id,
      fileName: file.name,
      mediaType: file.mimeType,
    });
    if (!json.ok) throw new Error(json.error || "OCR failed");
    return (json.receipts as Receipt[]) || [];
  }

  async function runBatch(toProcess: DriveFile[]) {
    if (toProcess.length === 0) return;
    setRunning(true);
    setPaused(false);

    const totalForProgress = progress.total > 0 ? progress.total : toProcess.length;
    const baseDone = progress.done;
    setProgress({ done: baseDone, total: totalForProgress });

    const queue = [...toProcess];
    const newResults: Receipt[] = [...results];
    const newErrors: typeof errors = [...errors];
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
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          placeholder="הדבק כתובת תיקיית Drive או מזהה תיקייה"
          className="flex-1 h-10 px-3 rounded-md border border-[hsl(var(--border))] bg-transparent text-sm"
        />
        <Button onClick={loadFolder} variant="outline">
          טען תיקייה
        </Button>
      </div>

      {files.length > 0 && (
        <>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            נמצאו {files.length} קבצים בתיקייה.
          </p>
          <Button onClick={startProcessing} disabled={running || paused}>
            {running
              ? `מעבד ${progress.done}/${progress.total}...`
              : `סרוק את כל ${files.length} הקבצים`}
          </Button>
        </>
      )}

      {progress.total > 0 && (
        <div className="w-full bg-[hsl(var(--muted))] rounded h-2 overflow-hidden">
          <div
            className="h-full bg-[hsl(var(--primary))] transition-[width]"
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

      {results.length > 0 && (
        <p className="text-sm">
          ✓ עובדו {results.length} קבלות. עבור ל
          <a href="/receipts" className="underline mx-1">
            עמוד הקבלות
          </a>
          לצפייה בטבלה המלאה.
        </p>
      )}
    </div>
  );
}
