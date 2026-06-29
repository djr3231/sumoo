"use client";

import { useRef, useState, type ReactNode } from "react";
import { cn, formatILS } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GOV_EXPENSE_CATEGORIES, type GovExpenseCategory } from "@/lib/types";
import type { ReportFolders } from "@/lib/report/period";
import type { CategorizedExpense, ProcessResult } from "@/lib/report/process";

// Six wizard steps — labels verbatim from the spec (§4.2).
const STEPS = [
  "בחירת תקופה",
  "העלאת מסמכים",
  "פירוק וסיווג",
  "התאמת קבלות",
  "מזומן",
  "הפקת דוח",
] as const;

// Two-digit month label, e.g. 3 -> "03".
const pad2 = (n: number) => String(n).padStart(2, "0");

// The six bi-monthly periods of a year.
const MONTH_PAIRS = [
  { m1: 1, m2: 2 },
  { m1: 3, m2: 4 },
  { m1: 5, m2: 6 },
  { m1: 7, m2: 8 },
  { m1: 9, m2: 10 },
  { m1: 11, m2: 12 },
] as const;

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

interface CreatedPeriod {
  folderName: string;
  folders: ReportFolders;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

// A labeled file slot (hidden native input opened by a button).
function FileSlot({
  label,
  hint,
  accept,
  multiple,
  files,
  onChange,
}: {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2 border border-border p-4">
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => onChange(Array.from(e.target.files ?? []))}
      />
      <div className="flex items-center gap-3">
        <Button variant="outline" type="button" onClick={() => ref.current?.click()}>
          בחר קובץ
        </Button>
        {files.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground underline"
          >
            נקה
          </button>
        ) : null}
      </div>
      {files.length > 0 ? (
        <ul className="text-xs text-muted-foreground">
          {files.map((f, i) => (
            <li key={i}>{f.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ReportWizard() {
  const [step, setStep] = useState(0);

  // Step 1 (period) form state.
  const [year, setYear] = useState(CURRENT_YEAR);
  const [pair, setPair] = useState<{ m1: number; m2: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPeriod | null>(null);

  // Step 2 (upload) — source docs held in state until step 3 processes them.
  const [checkingFiles, setCheckingFiles] = useState<File[]>([]);
  const [directFiles, setDirectFiles] = useState<File[]>([]);
  const [salaryFiles, setSalaryFiles] = useState<File[]>([]);

  // Step 3 (process + classify).
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [expenses, setExpenses] = useState<CategorizedExpense[]>([]);
  const [transferInclude, setTransferInclude] = useState<boolean[]>([]);

  const canCreate = pair !== null && !creating;

  async function createPeriod() {
    if (!pair) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/report/period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month1: pair.m1, month2: pair.m2 }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "שגיאה ביצירת התיקייה");
      }
      setCreated({ folderName: data.folderName, folders: data.folders });
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function processDocs() {
    if (!created || !pair) return;
    setProcessing(true);
    setProcessError(null);
    try {
      const fd = new FormData();
      fd.append(
        "period",
        JSON.stringify({
          year,
          month1: pair.m1,
          month2: pair.m2,
          folderName: created.folderName,
        }),
      );
      fd.append("sourceFolderId", created.folders.sourceId);
      for (const f of checkingFiles) fd.append("checking", f);
      for (const f of directFiles) fd.append("direct", f);
      for (const f of salaryFiles) fd.append("salary", f);

      const res = await fetch("/api/report/process", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "שגיאה בעיבוד המסמכים");
      }
      const r = data as ProcessResult;
      setResult(r);
      setExpenses(r.expenses);
      setTransferInclude(r.transfers.map(() => false));
    } catch (e) {
      setProcessError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  function setExpenseCategory(i: number, category: GovExpenseCategory) {
    setExpenses((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, category } : e)),
    );
  }

  const periodMonths = pair ? [pair.m1, pair.m2] : [];

  return (
    <div className="space-y-6">
      {/* Stepper header */}
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 border px-3 py-2 text-xs",
              i === step
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center text-[11px] font-semibold",
                i === step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 0 ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>שנה</Label>
                <div className="flex flex-wrap gap-2">
                  {YEAR_OPTIONS.map((y) => (
                    <Button
                      key={y}
                      variant={y === year ? "default" : "outline"}
                      onClick={() => setYear(y)}
                    >
                      {y}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>תקופה (חודשיים)</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {MONTH_PAIRS.map((p) => {
                    const selected = pair?.m1 === p.m1 && pair?.m2 === p.m2;
                    return (
                      <Button
                        key={`${p.m1}-${p.m2}`}
                        variant={selected ? "default" : "outline"}
                        className="w-full"
                        onClick={() => setPair({ m1: p.m1, m2: p.m2 })}
                      >
                        {pad2(p.m1)}-{pad2(p.m2)}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              {created ? (
                <p className="text-sm text-muted-foreground">
                  נוצרה תיקייה: {created.folderName}
                </p>
              ) : null}

              <Button onClick={createPeriod} disabled={!canCreate}>
                צור תיקייה והמשך
              </Button>
            </div>
          ) : step === 1 ? (
            <div className="space-y-4">
              {created ? (
                <p className="text-sm text-muted-foreground">
                  תיקיית התקופה: {created.folderName}
                </p>
              ) : null}
              <FileSlot
                label='עובר ושב (עו"ש)'
                hint="XLS או PDF — אפשר קובץ לכל חודש"
                accept=".xls,.xlsx,.pdf,application/pdf"
                multiple
                files={checkingFiles}
                onChange={setCheckingFiles}
              />
              <FileSlot
                label="פירוט חיובים — דיירקט"
                hint="XLS או PDF — אפשר קובץ לכל חודש"
                accept=".xls,.xlsx,.pdf,application/pdf"
                multiple
                files={directFiles}
                onChange={setDirectFiles}
              />
              <FileSlot
                label="תלושי שכר"
                hint="PDF — ניתן לבחור כמה"
                accept=".pdf,application/pdf"
                multiple
                files={salaryFiles}
                onChange={setSalaryFiles}
              />
            </div>
          ) : step === 2 ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={processDocs} disabled={processing}>
                  {processing ? "מעבד…" : "עבד מסמכים"}
                </Button>
                {created ? (
                  <span className="text-sm text-muted-foreground">
                    תיקיית התקופה: {created.folderName}
                  </span>
                ) : null}
              </div>

              {processError ? (
                <p className="text-sm text-destructive">{processError}</p>
              ) : null}

              {result ? (
                <div className="space-y-8">
                  <Section title="סיכום לפי חודש">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>חודש</TableHead>
                          <TableHead>סה&quot;כ הכנסות</TableHead>
                          <TableHead>סה&quot;כ הוצאות</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {periodMonths.map((m) => {
                          const incomeTotal =
                            result.income
                              .filter((x) => x.month === m)
                              .reduce((a, x) => a + x.amount, 0) +
                            result.transfers
                              .filter((t, i) => transferInclude[i] && t.month === m)
                              .reduce((a, t) => a + t.amount, 0);
                          const expenseTotal = expenses
                            .filter((e) => e.month === m)
                            .reduce((a, e) => a + e.amount, 0);
                          return (
                            <TableRow key={m}>
                              <TableCell>{m}</TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(incomeTotal)}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {formatILS(expenseTotal)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Section>

                  <Section title="הכנסות">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>מקור</TableHead>
                          <TableHead>חודש</TableHead>
                          <TableHead>סכום</TableHead>
                          <TableHead>קטגוריה</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.income.map((x, i) => (
                          <TableRow key={i}>
                            <TableCell>{x.source}</TableCell>
                            <TableCell>{x.month}</TableCell>
                            <TableCell className="tabular-nums">{formatILS(x.amount)}</TableCell>
                            <TableCell>{x.category}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Section>

                  <Section title="הוצאות">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>תיאור</TableHead>
                          <TableHead>חודש</TableHead>
                          <TableHead>סכום</TableHead>
                          <TableHead>קטגוריה</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {expenses.map((e, i) => (
                          <TableRow key={i}>
                            <TableCell>{e.description}</TableCell>
                            <TableCell>{e.month}</TableCell>
                            <TableCell className="tabular-nums">{formatILS(e.amount)}</TableCell>
                            <TableCell>
                              <Select
                                value={e.category}
                                onValueChange={(v) =>
                                  setExpenseCategory(i, v as GovExpenseCategory)
                                }
                              >
                                <SelectTrigger className="w-full min-w-48">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GOV_EXPENSE_CATEGORIES.map((c) => (
                                    <SelectItem key={c} value={c}>
                                      {c}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Section>

                  {result.transfers.length > 0 ? (
                    <Section title="העברות — להחלטה">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>שם</TableHead>
                            <TableHead>חודש</TableHead>
                            <TableHead>סכום</TableHead>
                            <TableHead>לכלול כהכנסה</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.transfers.map((t, i) => (
                            <TableRow key={i}>
                              <TableCell>{t.name || t.description}</TableCell>
                              <TableCell>{t.month}</TableCell>
                              <TableCell className="tabular-nums">{formatILS(t.amount)}</TableCell>
                              <TableCell>
                                <Checkbox
                                  checked={transferInclude[i] ?? false}
                                  onCheckedChange={(v) =>
                                    setTransferInclude((prev) =>
                                      prev.map((b, idx) => (idx === i ? v === true : b)),
                                    )
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}

                  <Section title="מזומן (משיכות לפי חודש)">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>חודש</TableHead>
                          <TableHead>סכום</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.cashWithdrawals.map((c) => (
                          <TableRow key={c.month}>
                            <TableCell>{c.month}</TableCell>
                            <TableCell className="tabular-nums">{formatILS(c.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Section>

                  {result.salaryCrossChecks.length > 0 ? (
                    <Section title="אימות שכר (בנק מול תלוש)">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>חודש</TableHead>
                            <TableHead>נטו בנק</TableHead>
                            <TableHead>נטו תלוש</TableHead>
                            <TableHead>מעסיק</TableHead>
                            <TableHead>תואם</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.salaryCrossChecks.map((s, i) => (
                            <TableRow key={i}>
                              <TableCell>{s.month}</TableCell>
                              <TableCell className="tabular-nums">{formatILS(s.bankNet)}</TableCell>
                              <TableCell className="tabular-nums">
                                {s.slipNet == null ? "—" : formatILS(s.slipNet)}
                              </TableCell>
                              <TableCell>{s.employer ?? "—"}</TableCell>
                              <TableCell>{s.matches ? "✓" : "✗"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}

                  {result.reviewCredits.length > 0 ? (
                    <Section title="זיכויים לבדיקה">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>חודש</TableHead>
                            <TableHead>סכום</TableHead>
                            <TableHead>תיאור</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.reviewCredits.map((c, i) => (
                            <TableRow key={i}>
                              <TableCell>{c.month}</TableCell>
                              <TableCell className="tabular-nums">{formatILS(c.amount)}</TableCell>
                              <TableCell>{c.description}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              {created ? <p>תיקיית התקופה: {created.folderName}</p> : null}
              <p>שלב זה ייבנה בהמשך.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer navigation (period step uses its own button to advance). */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          חזור
        </Button>
        {step > 0 && step < STEPS.length - 1 ? (
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            המשך
          </Button>
        ) : null}
      </div>
    </div>
  );
}
