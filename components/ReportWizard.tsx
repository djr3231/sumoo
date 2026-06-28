"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportFolders } from "@/lib/report/period";

// Six wizard steps — labels verbatim from the spec (§4.2).
const STEPS = [
  "בחירת תקופה",
  "העלאת מסמכים",
  "פירוק וסיווג",
  "התאמת קבלות",
  "מזומן",
  "הפקת דוח",
] as const;

// Gregorian month names (Hebrew), index 0 = January.
const MONTH_NAMES = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

interface CreatedPeriod {
  folderName: string;
  folders: ReportFolders;
}

export function ReportWizard() {
  const [step, setStep] = useState(0);

  // Step 1 (period) form state.
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [month1, setMonth1] = useState("");
  const [month2, setMonth2] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPeriod | null>(null);

  const canCreate = Boolean(year && month1 && month2) && !creating;

  async function createPeriod() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/report/period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: Number(year),
          month1: Number(month1),
          month2: Number(month2),
        }),
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
        <CardContent className="space-y-4">
          {step === 0 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>שנה</Label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEAR_OPTIONS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>חודש ראשון</Label>
                  <Select value={month1} onValueChange={setMonth1}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="בחר חודש" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((name, i) => (
                        <SelectItem key={name} value={String(i + 1)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>חודש שני</Label>
                  <Select value={month2} onValueChange={setMonth2}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="בחר חודש" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((name, i) => (
                        <SelectItem key={name} value={String(i + 1)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}

              {created ? (
                <p className="text-sm text-muted-foreground">
                  נוצרה תיקייה: {created.folderName}
                </p>
              ) : null}

              <Button onClick={createPeriod} disabled={!canCreate}>
                צור תיקייה והמשך
              </Button>
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
