"use client";
import { useState } from "react";
import { Button } from "./ui/Button";
import type { Receipt } from "@/lib/types";

const CONCURRENCY = 2;

async function postWithRetry(url: string, body: unknown, attempts = 4) {
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(15000, 1500 * Math.pow(2, i));
      await new Promise((r) => setTimeout(r, wait));
      lastErr = `${res.status}`;
      continue;
    }
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  throw new Error(`failed after ${attempts} attempts (last: ${lastErr})`);
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
  }

  async function processOne(file: DriveFile): Promise<Receipt> {
    const json = await postWithRetry("/api/ocr", {
      kind: "drive",
      driveFileId: file.id,
      fileName: file.name,
      mediaType: file.mimeType,
    });
    if (!json.ok) throw new Error(json.error || "OCR failed");
    return json.receipt as Receipt;
  }

  async function startProcessing() {
    setRunning(true);
    setProgress({ done: 0, total: files.length });
    setResults([]);
    setErrors([]);

    const queue = [...files];
    let done = 0;
    const newResults: Receipt[] = [];
    const newErrors: typeof errors = [];

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
          <Button onClick={startProcessing} disabled={running}>
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
          ✓ עובדו {results.length} קבצים. עבור ל
          <a href="/receipts" className="underline mx-1">
            עמוד הקבלות
          </a>
          לצפייה בטבלה המלאה.
        </p>
      )}
    </div>
  );
}
