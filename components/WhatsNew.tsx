"use client";
import { useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The release this popup announces. Bump it — together with ITEMS — to show the
// popup again after a future update; leave it alone and the popup stays retired
// for everyone who already dismissed it. See the what's-new section in
// CLAUDE.MD before doing either.
const RELEASE = "2026-08-18";
const RELEASE_LABEL = "18.8.2026";

// sumoo:<area>:<thing>, the key convention from UploadZone.tsx.
const STORAGE_KEY = "sumoo:whatsnew:seen";

// One short line each, newest first — the list has to fit without scrolling.
const ITEMS = [
  "🔍 לא בטוח שסרקת? - מעכשיו תוכל לבדוק, ולהוסיף אם לא.",
  "🗑️ אפשרות למחוק קבלות מהמערכת (התמונה נשארת ב-drive).",
  "✅ אישור ויזואלי לשמירה אוטומטית מוצלחת.",
  "⚡ טעינה מהירה — הטבלה נפתחת על התקופה הנוכחית.",
  "🔎 החיפוש כבר לא נתקע בזמן הקלדה.",
  "📄 הטבלה מחולקת לעמודים, והעריכה מיידית.",
  "⏳ פס טעינה בראש המסך נראה כשהמערכת חושבת.",
  "🔒 תוקף חיבור לגוגל שהסתיים מנתק אוטומטית מהמערכת.",
  "💾 קבלה נכנסת לרשימה רק אחרי שמירה מוצלחת.",
];

// localStorage read as an external store rather than useEffect + setState: the
// effect shape is what trips react-hooks/set-state-in-effect (the one accepted
// warning in this repo lives at UploadZone.tsx:138), and this also gives an
// SSR-safe first paint for free.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab dismissing the popup should close this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode, cookies off) — treat as "not seen".
    return null;
  }
}

// On the server, and on the hydrating render, claim the popup was already seen
// so nothing flashes before the real value arrives.
function getServerSnapshot() {
  return RELEASE;
}

export function WhatsNew() {
  const { status } = useSession();
  const seen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Ticking the box persists on close, not on tick: writing immediately would
  // make the dialog disappear from under the pointer.
  const [acknowledged, setAcknowledged] = useState(false);
  const [closedThisVisit, setClosedThisVisit] = useState(false);

  const open =
    status === "authenticated" && seen !== RELEASE && !closedThisVisit;

  function handleOpenChange(next: boolean) {
    if (next) return;
    if (acknowledged) {
      try {
        localStorage.setItem(STORAGE_KEY, RELEASE);
      } catch {
        // ignore quota errors — the popup simply returns next visit
      }
      for (const listener of listeners) listener();
    }
    setClosedThisVisit(true);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>מה חדש בסומו</DialogTitle>
          <DialogDescription>
            העדכון האחרון — <span dir="ltr">{RELEASE_LABEL}</span>
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto leading-relaxed">
          {ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {/* flex-col, not the primitive's flex-col-reverse: stacked on a phone
            the checkbox belongs above the button, not under it. */}
        <DialogFooter className="flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
            קראתי, אין צורך להציג יותר
          </label>
          <Button onClick={() => handleOpenChange(false)}>סגירה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
