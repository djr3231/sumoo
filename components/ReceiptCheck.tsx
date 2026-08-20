"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "./ui/Alert";
import { Button } from "./ui/button";
import { apiErrorMessage, apiFetch } from "@/lib/api-client";
import { resizeToBase64 } from "@/lib/image-client";
import type { CandidateDistance } from "@/lib/match";
import { checkScannedReceipt, type ScoredReceipt } from "@/lib/receipt-check";
import { DEFAULT_STORE_NAME, type Receipt } from "@/lib/types";
import { formatDate, formatILS } from "@/lib/utils";

// Everything held back from persistence while the user decides. The image
// bytes stay here because /api/ocr scanned with `dryRun` and wrote nothing: if
// the answer turns out to be "already have it", nothing was ever created.
interface Scan {
  receipts: Receipt[];
  primary: Receipt;
  fileName: string;
  mediaType: string;
  base64: string;
  storeName: string | null;
  matchedKnownStore: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "matched"; scan: Scan; match: Receipt; candidates: ScoredReceipt[] }
  | { kind: "candidates"; scan: Scan; candidates: ScoredReceipt[] }
  | { kind: "unmatchable"; scan: Scan }
  // Terminal: the receipt was already known, so nothing was written.
  | { kind: "known" }
  | { kind: "saved"; receipts: Receipt[] };

interface OcrResponse {
  receipts: Receipt[];
  storeName?: string | null;
  matchedKnownStore?: boolean;
}

type ScanContext = { knownStores: string[]; userCards: string[] };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { blocking: true },
  );
  if (!res.ok) throw new Error(await apiErrorMessage(res));
  return (await res.json()) as T;
}

// The identity readout from DeleteReceiptDialog: the user is being asked about
// one specific row, so they have to see which one.
function ReceiptCard({
  receipt,
  distance,
}: {
  receipt: Receipt;
  distance?: CandidateDistance;
}) {
  return (
    <div className="space-y-1 border border-border bg-muted p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-semibold">
          {receipt.storeName ?? DEFAULT_STORE_NAME}
        </span>
        <span className="shrink-0 tabular-nums">
          {receipt.amount === null ? "—" : formatILS(receipt.amount)}
        </span>
      </div>
      <div className="text-muted-foreground">{formatDate(receipt.date) || "—"}</div>
      <div className="truncate text-muted-foreground" title={receipt.fileName}>
        {receipt.fileName}
      </div>
      {distance && (
        <div className="flex flex-wrap gap-x-4 text-muted-foreground tabular-nums">
          <span>הפרש סכום: {formatILS(distance.amountDiff)}</span>
          <span>הפרש ימים: {Math.round(distance.daysDiff)}</span>
        </div>
      )}
      {receipt.driveFileId && (
        <a
          href={`https://drive.google.com/file/d/${receipt.driveFileId}/view`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block underline"
        >
          צפייה בקובץ ב-Drive
        </a>
      )}
    </div>
  );
}

export function ReceiptCheck() {
  // The whole receipts tab, read ONCE per page load and reused for every
  // subsequent check — a per-scan read is what blew the 60/min Sheets quota
  // before /api/scan-context existed. A save pushes into this list rather than
  // re-reading, so a receipt just added is matchable without a reload.
  const [pool, setPool] = useState<Receipt[] | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [scanContext, setScanContext] = useState<ScanContext | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/sheets");
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        const json = (await res.json()) as { receipts?: Receipt[] };
        if (!cancelled) setPool(json.receipts ?? []);
      } catch {
        if (!cancelled) setPoolError("לא ניתן לטעון את רשימת הקבלות");
      }
      // Best-effort: /api/ocr reads these itself when they are absent. Only
      // pass them on when the fetch actually succeeded — handing over an empty
      // userCards list would misclassify the user's own card as a foreign one.
      try {
        const res = await apiFetch("/api/scan-context");
        if (!res.ok) return;
        const json = (await res.json()) as ScanContext;
        if (!cancelled) setScanContext(json);
      } catch {
        // ignore — the route falls back to its own reads
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setPhase({ kind: "scanning" });
      try {
        const { base64, mediaType } = await resizeToBase64(file);
        const json = await postJson<OcrResponse>("/api/ocr", {
          kind: "upload",
          fileName: file.name,
          mediaType,
          base64,
          dryRun: true,
          ...(scanContext ?? {}),
        });
        const receipts = json.receipts ?? [];
        // A mixed payment yields several linked rows for one image; the primary
        // carries the document's identity, so it is what gets compared.
        const primary = receipts.find((r) => !r.linkedTo) ?? receipts[0];
        // /api/ocr always returns at least one row, even for unreadable media.
        // Guard anyway: every phase below dereferences the primary.
        if (!primary) {
          setPhase({ kind: "idle" });
          toast.error("לא ניתן לבדוק — חסר סכום או תאריך בסריקה");
          return;
        }
        const scan: Scan = {
          receipts,
          primary,
          fileName: file.name,
          mediaType,
          base64,
          storeName: json.storeName ?? null,
          matchedKnownStore: json.matchedKnownStore ?? false,
        };
        const outcome = checkScannedReceipt(primary, pool ?? []);
        if (outcome.kind === "match") {
          setPhase({
            kind: "matched",
            scan,
            match: outcome.match,
            candidates: outcome.candidates,
          });
        } else if (outcome.kind === "candidates") {
          setPhase({ kind: "candidates", scan, candidates: outcome.candidates });
        } else {
          setPhase({ kind: "unmatchable", scan });
        }
      } catch (e) {
        setPhase({ kind: "idle" });
        toast.error((e as Error).message);
      }
    },
    [pool, scanContext],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [], "application/pdf": [] },
    multiple: false,
    disabled: pool === null || phase.kind !== "idle",
  });

  async function saveAsNew(scan: Scan) {
    setBusy(true);
    try {
      const json = await postJson<{ receipts?: Receipt[] }>("/api/receipt-save", {
        receipts: scan.receipts,
        fileName: scan.fileName,
        mediaType: scan.mediaType,
        base64: scan.base64,
        storeName: scan.storeName,
        matchedKnownStore: scan.matchedKnownStore,
      });
      const saved = json.receipts ?? scan.receipts;
      setPool((prev) => [...(prev ?? []), ...saved]);
      setPhase({ kind: "saved", receipts: saved });
      toast.success("הקבלה נוספה למערכת");
    } catch (e) {
      // Stay on the current step so the user can retry without re-scanning.
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reset = () => setPhase({ kind: "idle" });

  return (
    <div className="space-y-4">
      {poolError && (
        <Alert variant="destructive">
          <AlertTitle>{poolError}</AlertTitle>
        </Alert>
      )}

      {phase.kind === "idle" && (
        <div
          {...getRootProps()}
          className="border border-dashed border-border p-8 text-center cursor-pointer hover:bg-accent"
        >
          <input {...getInputProps()} />
          <p className="text-sm text-muted-foreground">
            {pool === null && !poolError
              ? "טוען קבלות קיימות..."
              : isDragActive
                ? "שחרר כאן..."
                : "גרור קבלה לכאן, או לחץ לבחירה"}
          </p>
        </div>
      )}

      {phase.kind === "scanning" && (
        <div className="flex items-center justify-center gap-2 border border-border p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          סורק...
        </div>
      )}

      {phase.kind === "matched" && (
        <div className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">הקבלה כבר במערכת</h2>
            <p className="text-sm text-muted-foreground">זו הקבלה שמצאנו:</p>
          </header>
          <ReceiptCard receipt={phase.match} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPhase({ kind: "known" })}>
              כן, זו הקבלה
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setPhase({
                  kind: "candidates",
                  scan: phase.scan,
                  candidates: phase.candidates,
                })
              }
            >
              לא, זו לא אותה קבלה
            </Button>
            <Button variant="ghost" onClick={reset}>
              בטל
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "candidates" && (
        <div className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">לא נמצאה קבלה תואמת</h2>
            {phase.candidates.length > 0 && (
              <p className="text-sm text-muted-foreground">
                אלה שלוש הקבלות הדומות ביותר:
              </p>
            )}
          </header>

          {phase.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין קבלות דומות במערכת</p>
          ) : (
            <div className="space-y-2">
              {phase.candidates.map((c) => (
                <div key={c.receipt.id} className="space-y-2">
                  <ReceiptCard receipt={c.receipt} distance={c.distance} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPhase({ kind: "known" })}
                  >
                    בחר
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => saveAsNew(phase.scan)}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {phase.candidates.length === 0
                ? "הוסף כקבלה חדשה"
                : "אף אחת לא מתאימה — הוסף כקבלה חדשה"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={reset}>
              בטל
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "unmatchable" && (
        <div className="space-y-4">
          <Alert>
            <AlertTitle>לא ניתן לבדוק — חסר סכום או תאריך בסריקה</AlertTitle>
          </Alert>
          <ReceiptCard receipt={phase.scan.primary} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => saveAsNew(phase.scan)}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              הוסף כקבלה חדשה
            </Button>
            <Button variant="ghost" disabled={busy} onClick={reset}>
              בטל
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "known" && (
        <div className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">הקבלה כבר במערכת</h2>
            <p className="text-sm text-muted-foreground">לא נוספה שורה חדשה</p>
          </header>
          <Button onClick={reset}>סרוק קבלה נוספת</Button>
        </div>
      )}

      {phase.kind === "saved" && (
        <div className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">הקבלה נוספה למערכת</h2>
          </header>

          {/* Desktop: the same six columns /upload shows after a scan, so the
              two screens agree on what "added" looks like. */}
          <div className="hidden md:block border border-border overflow-hidden">
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
                {phase.receipts.map((r) => (
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

          {/* Mobile: six columns do not fit at 375px. */}
          <div className="block space-y-2 md:hidden">
            {phase.receipts.map((r) => (
              <div key={r.id} className="space-y-1">
                <ReceiptCard receipt={r} />
                <p className="text-sm text-muted-foreground">
                  {r.category} · {r.documentType}
                </p>
              </div>
            ))}
          </div>

          <Button onClick={reset}>סרוק קבלה נוספת</Button>
        </div>
      )}
    </div>
  );
}
