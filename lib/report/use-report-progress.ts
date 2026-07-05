"use client";

// Autosave hook for the report wizard's persisted progress. Debounces rapid
// state changes into a single POST /api/report/progress, exposes `saveNow`
// for explicit flush points (step transitions, after receipt matching), and
// guards against overlapping requests with an in-flight + last-write-wins
// scheme so no stale snapshot can win a race against a fresher one.
//
// Scope: this hook only WRITES. Resume/hydrate (GET + applying it to wizard
// state) is a separate task, as is non-destructive merge on save.

import { useCallback, useEffect, useRef, useState } from "react";
import { serializeProgress, type WizardProgressState } from "@/lib/report/progress";

export type ReportProgressSaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface UseReportProgressArgs {
  periodKey: string | undefined;
  state: WizardProgressState;
  enabled: boolean;
}

export interface UseReportProgressResult {
  status: ReportProgressSaveStatus;
  saveNow: () => void;
}

export function useReportProgress({
  periodKey,
  state,
  enabled,
}: UseReportProgressArgs): UseReportProgressResult {
  const [status, setStatus] = useState<ReportProgressSaveStatus>("idle");

  // Always-fresh refs so the debounce timer and saveNow never close over a
  // stale render's `state`/`periodKey`/`enabled`. Refs must not be written
  // during render, so they're synced in an effect that runs after every
  // render (no dependency array).
  const stateRef = useRef(state);
  const periodKeyRef = useRef(periodKey);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    stateRef.current = state;
    periodKeyRef.current = periodKey;
    enabledRef.current = enabled;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while a POST is in flight.
  const inFlightRef = useRef(false);
  // Set when a save is requested while one is already in flight — tells the
  // in-flight request's completion handler to fire exactly one more save
  // with the latest state, instead of queuing every intermediate request.
  const resaveNeededRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Performs one POST attempt for whatever is currently in the refs.
  const postOnce = useCallback(async (period: string) => {
    setStatus("saving");
    try {
      const progress = serializeProgress(stateRef.current);
      const res = await fetch("/api/report/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, progress }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "save failed");
      }
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, []);

  // Runs the in-flight guard + last-write-wins loop: if a save is requested
  // while one is in flight, that request only sets resaveNeededRef; once the
  // in-flight POST settles, this loops around to save once more with the
  // by-then-latest state (never queuing more than one pending resave).
  const doSave = useCallback(async () => {
    if (!enabledRef.current) return;
    const period = periodKeyRef.current;
    if (!period) return;

    if (inFlightRef.current) {
      resaveNeededRef.current = true;
      return;
    }

    inFlightRef.current = true;
    try {
      resaveNeededRef.current = false;
      await postOnce(period);
      while (resaveNeededRef.current && enabledRef.current && periodKeyRef.current) {
        resaveNeededRef.current = false;
        await postOnce(periodKeyRef.current);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [postOnce]);

  const saveNow = useCallback(() => {
    clearTimer();
    if (!enabledRef.current) return;
    void doSave();
  }, [clearTimer, doSave]);

  // Debounced autosave: any change to `state` (while enabled) restarts the
  // 1.5s timer, coalescing rapid edits into a single save. `state` itself is
  // read fresh from stateRef inside doSave (kept in sync by the effect
  // above), so this effect only needs to know THAT something changed.
  useEffect(() => {
    if (!enabled) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return clearTimer;
  }, [state, enabled, clearTimer, doSave]);

  // Clear any pending timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  return { status, saveNow };
}
