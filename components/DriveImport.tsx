"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Alert, AlertDescription, AlertTitle } from "./ui/Alert";
import { Skeleton } from "./ui/Skeleton";
import { Loader2, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
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
  const [folderId, setFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderIdError, setFolderIdError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [searching, setSearching] = useState(false);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [existingDriveIds, setExistingDriveIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Receipt[]>([]);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const [paused, setPaused] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<DriveFile[]>([]);

  useEffect(() => {
    if (searchQuery.length < 1) {
      setFolders([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/drive/folders?q=${encodeURIComponent(searchQuery)}`);
        const json = await res.json();
        setFolders(json.folders ?? []);
      } catch {
        setFolders([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  function extractFolderId(input: string): string {
    const m = input.match(/folders\/([\w-]+)/);
    return m ? m[1] : input.trim();
  }

  async function loadFolder() {
    if (!folderId.trim()) {
      setFolderIdError("יש להזין כתובת או מזהה תיקייה");
      return;
    }
    setFolderIdError(null);
    setLoadingFolder(true);
    try {
      const id = extractFolderId(folderId);
      const res = await fetch(`/api/drive?folderId=${encodeURIComponent(id)}`);
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

  const pct = progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex gap-2">
          <div className="flex-1">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  aria-invalid={!!folderIdError}
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate">
                    {folderName || "חפש תיקיית Drive..."}
                  </span>
                  <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="חפש תיקיית Drive..."
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                  />
                  <CommandList>
                    {searching && (
                      <div className="p-2 space-y-1">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-3/4" />
                      </div>
                    )}
                    {!searching && searchQuery.length > 0 && folders.length === 0 && (
                      <CommandEmpty>לא נמצאו תיקיות</CommandEmpty>
                    )}
                    {!searching && folders.length > 0 && (
                      <CommandGroup>
                        {folders.map((folder) => (
                          <CommandItem
                            key={folder.id}
                            value={folder.id}
                            onSelect={() => {
                              setFolderId(folder.id);
                              setFolderName(folder.name);
                              setFolderIdError(null);
                              setOpen(false);
                              setSearchQuery("");
                            }}
                          >
                            {folder.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <Button onClick={loadFolder} variant="outline" disabled={loadingFolder || running}>
            {loadingFolder && <Loader2 className="animate-spin size-4 me-2" />}
            {loadingFolder ? "טוען..." : "טען תיקייה"}
          </Button>
        </div>
        {folderIdError && <p className="text-xs text-destructive">{folderIdError}</p>}
      </div>

      {loadingFolder && (
        <div className="space-y-2" aria-label="טוען תיקייה וקבצים קיימים...">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      )}

      {!loadingFolder && files.length > 0 && (() => {
        const newFiles = files.filter((f) => !existingDriveIds.has(f.id));
        const doneCount = files.length - newFiles.length;
        return (
          <>
            <p className="text-sm text-muted-foreground">
              נמצאו {files.length} קבצים בתיקייה
              {doneCount > 0 && ` · ${doneCount} כבר עובדו · ${newFiles.length} חדשים`}.
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
                    {newFiles.length === 0 ? "כל הקבצים כבר עובדו" : `סרוק חדשים (${newFiles.length})`}
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
