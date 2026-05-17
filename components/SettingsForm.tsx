"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/Button";

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
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = (await res.json()) as SettingsResponse;
        if (!alive) return;
        if (!res.ok) {
          setError(json.error || `HTTP ${res.status}`);
          return;
        }
        setCards(Array.isArray(json.myCardsLast4) ? json.myCardsLast4 : []);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function addDraft() {
    const v = draft.trim();
    if (!/^\d{4}$/.test(v)) {
      setDraftError("יש להזין בדיוק 4 ספרות");
      return;
    }
    if (cards.includes(v)) {
      setDraftError("כבר ברשימה");
      return;
    }
    setCards([...cards, v]);
    setDraft("");
    setDraftError(null);
  }

  function removeCard(c: string) {
    setCards(cards.filter((x) => x !== c));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myCardsLast4: cards }),
      });
      const json = (await res.json()) as SettingsResponse;
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">טוען...</p>;
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4 ספרות אחרונות של כרטיסי האשראי שלך</h2>
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
              <li
                key={c}
                className="inline-flex items-center gap-2 border border-border bg-muted px-3 py-1 text-sm"
              >
                <span className="font-mono">★{c}</span>
                <button
                  type="button"
                  onClick={() => removeCard(c)}
                  aria-label={`הסר ${c}`}
                  className="text-muted-foreground hover:text-destructive leading-none"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.replace(/\D/g, "").slice(0, 4));
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              className={`w-full h-10 px-3 border bg-transparent text-sm font-mono ${
                draftError ? "border-destructive" : "border-border"
              }`}
            />
            {draftError && (
              <p className="text-xs text-destructive mt-1">{draftError}</p>
            )}
          </div>
          <Button onClick={addDraft} variant="outline" disabled={!draft}>
            הוסף
          </Button>
        </div>
      </section>

      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <Button onClick={save} disabled={saving}>
          {saving ? "שומר..." : "שמור"}
        </Button>
        {savedAt && !saving && (
          <span className="text-sm text-muted-foreground">נשמר ✓</span>
        )}
      </div>

      {error && (
        <div className="border border-destructive p-3 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
