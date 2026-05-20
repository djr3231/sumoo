"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/Skeleton";
import { Alert, AlertDescription } from "./ui/Alert";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SettingsResponse {
  myCardsLast4?: string[];
  error?: string;
}

export function SettingsForm() {
  const [cards, setCards] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = (await res.json()) as SettingsResponse;
        if (!alive) return;
        if (!res.ok) { setError(json.error || `HTTP ${res.status}`); return; }
        setCards(Array.isArray(json.myCardsLast4) ? json.myCardsLast4 : []);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function persist(newCards: string[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myCardsLast4: newCards }),
      });
      const json = (await res.json()) as SettingsResponse;
      if (!res.ok) { setError(json.error || `HTTP ${res.status}`); return; }
      toast.success("נשמר ✓");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addAndSave() {
    const v = draft.trim();
    if (!/^\d{4}$/.test(v)) { setDraftError("יש להזין בדיוק 4 ספרות"); return; }
    if (cards.includes(v)) { setDraftError("כבר ברשימה"); return; }
    const next = [...cards, v];
    setCards(next);
    setDraft("");
    setDraftError(null);
    await persist(next);
  }

  async function removeAndSave(c: string) {
    const next = cards.filter((x) => x !== c);
    setCards(next);
    await persist(next);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label htmlFor="card-input" className="text-base font-semibold">
          4 ספרות אחרונות של כרטיסי האשראי שלך
        </Label>
        <p className="text-sm text-muted-foreground">
          קבלות שמחויבות באחד מהכרטיסים הללו יסווגו כ&quot;אשראי&quot;. כרטיסים אחרים יסווגו כ&quot;מזומן&quot;.
        </p>

        {cards.length === 0 ? (
          <p className="text-sm border border-dashed border-border p-3">
            ללא כרטיסים מוגדרים — כל חיוב באשראי יסווג כ&quot;אשראי&quot; לפי הקבלה.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {cards.map((c) => (
              <li key={c}>
                <Badge
                  variant="secondary"
                  className="border border-border bg-muted px-3 py-1 text-sm font-normal tracking-normal normal-case gap-1.5"
                >
                  <span className="font-mono">★{c}</span>
                  <button
                    type="button"
                    onClick={() => removeAndSave(c)}
                    disabled={saving}
                    aria-label={`הסר ${c}`}
                    className="text-muted-foreground hover:text-destructive leading-none disabled:opacity-50"
                  >
                    ×
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 items-start">
          <div className="flex-1 space-y-1">
            <Input
              id="card-input"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.replace(/\D/g, "").slice(0, 4));
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addAndSave(); }
              }}
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              aria-invalid={!!draftError}
              className="font-mono"
            />
            {draftError && <p className="text-xs text-destructive">{draftError}</p>}
          </div>
          <Button onClick={addAndSave} variant="outline" disabled={!draft || saving}>
            {saving && <Loader2 className="animate-spin size-4 me-2" />}
            הוסף
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
