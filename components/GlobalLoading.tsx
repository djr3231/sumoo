"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { subscribeApiActivity, type ApiActivity } from "@/lib/api-client";

// Every Sheets round-trip takes seconds and used to be completely silent —
// opening a form, saving a field, switching account. Two levels of feedback:
//
//  - a thin bar at the top of the viewport whenever anything is in flight;
//  - a blocking overlay only for requests that opted in via
//    apiFetch(..., { blocking: true }).
//
// Autosave deliberately uses the bar, not the overlay: it fires on every field
// blur, and a modal veil flashing between each pair of fields is unusable.
export function GlobalLoading() {
  const [activity, setActivity] = useState<ApiActivity>({
    pending: 0,
    blocking: 0,
  });

  useEffect(() => subscribeApiActivity(setActivity), []);

  const busy = activity.pending > 0;
  const blocking = activity.blocking > 0;

  return (
    <>
      {busy && (
        // animate-pulse, not a sliding keyframe: a custom keyframe would need
        // CSS in globals.css, which DESIGN-SYSTEM.md §9 forbids.
        <div
          className="fixed inset-x-0 top-0 z-[60] h-0.5 animate-pulse bg-primary"
          role="status"
          aria-live="polite"
          aria-label="טוען"
        />
      )}
      {blocking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 border border-border bg-card px-4 py-3 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>טוען…</span>
          </div>
        </div>
      )}
    </>
  );
}
