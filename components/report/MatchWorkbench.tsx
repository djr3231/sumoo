"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { cn, formatILS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Receipt } from "@/lib/types";
import {
  compareCandidates, receiptLineDistance, type CandidateDistance,
} from "@/lib/match";
import type { CategorizedExpense } from "@/lib/report/process";

// ISO YYYY-MM-DD → DD/MM/YYYY (— when absent). Local copy of the wizard's
// helper — both files render dates the same way.
function fmtDate(d?: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}

type SortKey = "date" | "description" | "amount" | "amountDiff" | "daysDiff";

interface Props {
  receipt: Receipt;
  expenses: CategorizedExpense[];
  // keepAvailable = split receipt: the caller keeps the receipt matchable
  // (and this workbench open) so more lines can be attached to it.
  onAttach: (lineIndex: number, keepAvailable?: boolean) => void;
  onClose: () => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
}

// Side-by-side manual matching: candidate expense lines (right pane in RTL)
// vs the receipt + its Drive preview (left pane). Default shows only lines
// whose amount EXACTLY equals the receipt's and whose name is related;
// "הצג הכל" lifts both gates (OCR errors happen).
export function MatchWorkbench({
  receipt, expenses, onAttach, onClose, previewOpen, onTogglePreview,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  // Split receipt: one receipt justifies several charges (e.g. a bi-monthly
  // municipality bill charged monthly). While checked, בחר attaches without
  // consuming the receipt, so it can be attached again and again.
  const [splitMode, setSplitMode] = useState(false);

  const query = search.trim().toLowerCase();
  const rows = expenses
    .map((e, i) => ({ e, i, d: receiptLineDistance(e, receipt) }))
    .filter(({ e, d }) => {
      // A non-empty search overrides the candidate gates: the user is hunting
      // a specific line (OCR errors, odd store names), so scan EVERYTHING —
      // description, date (both renderings) and amount — like the global
      // receipts-page search.
      if (query !== "") {
        return [e.description, e.date, fmtDate(e.date), String(e.amount)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      }
      return showAll || (d !== null && d.sameAmount && d.nameRelated);
    });

  const sortVal = (r: { e: CategorizedExpense; d: CandidateDistance | null }, key: SortKey) => {
    if (key === "amount") return r.e.amount;
    if (key === "date") return r.e.date ?? "";
    if (key === "description") return r.e.description;
    return r.d ? r.d[key] : Infinity; // amountDiff / daysDiff — null distances last
  };
  const sorted = [...rows].sort((a, b) => {
    if (!sort) return compareCandidates(a.d, b.d);
    const va = sortVal(a, sort.key);
    const vb = sortVal(b, sort.key);
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "he");
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  const arrow = (key: SortKey) =>
    sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";

  const previewLabel = previewOpen ? "הסתר קבלה" : "הצג קבלה";

  return (
    <TooltipProvider>
      <section className="space-y-4 border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            התאמה ידנית — {receipt.storeName ?? receipt.fileName}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            סגור
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* First child = right pane in RTL: the candidate expense lines */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(ev) => setSearch(ev.target.value)}
                placeholder="חיפוש"
                className="w-56"
              />
              <Button
                variant={showAll ? "default" : "outline"}
                size="sm"
                onClick={() => setShowAll((v) => !v)}
              >
                הצג הכל
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={splitMode}
                  onCheckedChange={(v) => setSplitMode(v === true)}
                />
                קבלה מפוצלת
              </label>
            </div>
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין מועמדים בסכום זהה</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer" onClick={() => toggleSort("date")}>
                        תאריך{arrow("date")}
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => toggleSort("description")}>
                        תיאור{arrow("description")}
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => toggleSort("amount")}>
                        סכום{arrow("amount")}
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => toggleSort("amountDiff")}>
                        הפרש סכום{arrow("amountDiff")}
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => toggleSort("daysDiff")}>
                        הפרש ימים{arrow("daysDiff")}
                      </TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map(({ e, i, d }) => (
                      <TableRow key={i} className={cn(d?.sameAmount ? "" : "text-muted-foreground")}>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {fmtDate(e.date)}
                        </TableCell>
                        <TableCell>{e.description || "—"}</TableCell>
                        <TableCell className="tabular-nums">{formatILS(e.amount)}</TableCell>
                        <TableCell className="tabular-nums">
                          {d ? formatILS(d.amountDiff) : "—"}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {d ? Math.round(d.daysDiff) : "—"}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" onClick={() => onAttach(i, splitMode)}>
                            {e.receipt ? "בחר (תפוס)" : "בחר"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Second child = left pane in RTL: the receipt + preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between border border-border p-3">
              <div>
                <p className="font-medium">{receipt.storeName ?? receipt.fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {fmtDate(receipt.date)} · {receipt.paymentMethod}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">
                  {formatILS(Math.abs(receipt.amount ?? 0))}
                </span>
                {receipt.driveFileId ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={onTogglePreview}
                        aria-label={previewLabel}
                      >
                        <Eye />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{previewLabel}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
            {previewOpen && receipt.driveFileId ? (
              <iframe
                src={`https://drive.google.com/file/d/${receipt.driveFileId}/preview`}
                className="h-96 w-full border border-border"
                title={receipt.fileName}
              />
            ) : null}
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}
