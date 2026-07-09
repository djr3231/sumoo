"use client";
import * as React from "react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Alert, AlertDescription, AlertTitle } from "./ui/Alert";
import { Skeleton } from "./ui/Skeleton";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxInput,
  ComboboxEmpty,
} from "./ui/combobox";
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

interface DriveFolder {
  id: string;
  name: string;
}

export function DriveImport() {
  const [selectedFolder, setSelectedFolder] =
    React.useState<DriveFolder | null>(null);
  const [searchResults, setSearchResults] = React.useState<DriveFolder[]>([]);
  const [folderIdError, setFolderIdError] = React.useState<string | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const [files, setFiles] = React.useState<DriveFile[]>([]);
  const [existingDriveIds, setExistingDriveIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [loadingFolder, setLoadingFolder] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<Receipt[]>([]);
  const [errors, setErrors] = React.useState<{ name: string; error: string }[]>(
    [],
  );
  const [paused, setPaused] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState<DriveFile[]>([]);

  // Keep the currently-selected folder visible in the list even after results change.
  const items = React.useMemo(() => {
    if (
      !selectedFolder ||
      searchResults.some((f) => f.id === selectedFolder.id)
    ) {
      return searchResults;
    }
    return [...searchResults, selectedFolder];
  }, [searchResults, selectedFolder]);

  function handleInputChange(next: string, details: { reason?: string }) {
    if (details.reason === "item-press") return;
    if (next.trim() === "") {
      setSearchResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/drive/folders?q=${encodeURIComponent(next)}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        if (controller.signal.aborted) return;
        setSearchResults(json.folders ?? []);
      } catch {
        // abort or network error — ignore
      }
    }, 300);
  }

  async function loadFolder() {
    if (!selectedFolder) {
      setFolderIdError("יש להזין כתובת או מזהה תיקייה");
      return;
    }
    setFolderIdError(null);
    setLoadingFolder(true);
    try {
      const res = await fetch(
        `/api/drive?folderId=${encodeURIComponent(selectedFolder.id)}`,
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "שגיאה בטעינת התיקייה");
        return;
      }
      setFiles(json.files);
      setPendingFiles([]);
      setPaused(false);
      setResults([]);
      setErrors([]);
      setProgress({ done: 0, total: 0 });

      const sheetsRes = await fetch("/api/sheets");
      if (sheetsRes.ok) {
        const sheetsJson = await sheetsRes.json();
        const ids = new Set<string>(
          (sheetsJson.receipts as Receipt[])
            .map((r) => r.driveFileId)
            .filter((id): id is string => Boolean(id)),
        );
        setExistingDriveIds(ids);
      }
    } finally {
      setLoadingFolder(false);
    }
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

    const totalForProgress =
      progress.total > 0 ? progress.total : toProcess.length;
    const baseDone = progress.done;
    setProgress({ done: baseDone, total: totalForProgress });

    const queue = [...toProcess];
    const newResults: Receipt[] = [...results];
    const newErrors: typeof errors = [...errors];
    const state = {
      consecutiveOverloads: 0,
      halted: false,
      doneCount: baseDone,
    };

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
            setExistingDriveIds((prev) => new Set(prev).add(f.id));
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

  async function startProcessing(toScan: DriveFile[]) {
    setResults([]);
    setErrors([]);
    setProgress({ done: 0, total: toScan.length });
    setPendingFiles([]);
    await runBatch(toScan);
  }

  async function resume() {
    await runBatch(pendingFiles);
  }

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex gap-2">
          <div className="flex-1">
            <Combobox
              items={items}
              value={selectedFolder}
              filter={null}
              itemToStringLabel={(f: DriveFolder) => f.name}
              onValueChange={(next: DriveFolder | null) => {
                setSelectedFolder(next);
                setFolderIdError(null);
              }}
              onInputValueChange={handleInputChange}
            >
              <ComboboxInput
                placeholder="חפש תיקיית Drive..."
                aria-invalid={!!folderIdError}
                showClear={!!selectedFolder}
              />
              <ComboboxContent>
                <ComboboxEmpty>לא נמצאו תיקיות</ComboboxEmpty>
                <ComboboxList>
                  {(folder: DriveFolder) => (
                    <ComboboxItem key={folder.id} value={folder}>
                      {folder.name}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <Button
            onClick={loadFolder}
            variant="outline"
            disabled={loadingFolder || running}
          >
            {loadingFolder && <Loader2 className="animate-spin size-4 me-2" />}
            {loadingFolder ? "טוען..." : "טען תיקייה"}
          </Button>
        </div>
        {folderIdError && (
          <p className="text-xs text-destructive">{folderIdError}</p>
        )}
      </div>

      {loadingFolder && (
        <div className="space-y-2" aria-label="טוען תיקייה וקבצים קיימים...">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      )}

      {!loadingFolder &&
        files.length > 0 &&
        (() => {
          const newFiles = files.filter((f) => !existingDriveIds.has(f.id));
          const doneCount = files.length - newFiles.length;
          return (
            <>
              <p className="text-sm text-muted-foreground">
                נמצאו {files.length} קבצים בתיקייה
                {doneCount > 0 &&
                  ` · ${doneCount} כבר עובדו · ${newFiles.length} חדשים`}
                .
              </p>
              <div className="flex gap-2 flex-wrap">
                {running ? (
                  <Button disabled>
                    <Loader2 className="animate-spin size-4 me-2" />
                    מעבד {progress.done}/{progress.total}...
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => startProcessing(newFiles)}
                      disabled={paused || newFiles.length === 0}
                    >
                      {newFiles.length === 0
                        ? results.length > 0
                          ? `${results.length} קבצים עובדו בהצלחה`
                          : "אין קבצים נוספים לעיבוד"
                        : `סרוק חדשים (${newFiles.length})`}
                    </Button>
                    {doneCount > 0 && (
                      <Button
                        variant="outline"
                        onClick={() => startProcessing(files)}
                        disabled={paused}
                      >
                        סרוק הכל מחדש ({files.length})
                      </Button>
                    )}
                  </>
                )}
              </div>
            </>
          );
        })()}

      {progress.total > 0 && <Progress value={pct} />}

      {paused && (
        <Alert>
          <AlertTitle>⏸ הסריקה הושהתה — Gemini עמוס</AlertTitle>
          <AlertDescription>
            {pendingFiles.length} קבצים ממתינים. נסה שוב כשהשרת ישתחרר (לעיתים
            נדרשות מספר דקות).
          </AlertDescription>
          <Button onClick={resume} disabled={running} className="mt-2">
            המשך סריקה ({pendingFiles.length})
          </Button>
        </Alert>
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
