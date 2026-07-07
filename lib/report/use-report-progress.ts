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

// 4s (rather than a snappier ~1.5s) to keep autosave frugal against a tight
// Sheets API quota: fewer debounce windows -> fewer POSTs -> fewer Sheets API
// calls per minute of active editing. saveNow() bypasses this entirely for
// points that need an immediate flush (step transitions, after a match).
const AUTOSAVE_DEBOUNCE_MS = 4000;

export interface UseReportProgressArgs {
  periodKey: string | undefined;
  state: WizardProgressState;
  enabled: boolean;
}

export interface UseReportProgressResult {
  status: ReportProgressSaveStatus;
  saveNow: () => void;
  cancel: () => void;
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
  // Set by cancel() to suppress any save that was already armed (debounce
  // timer already fired, or an in-flight POST about to resolve) so a stale
  // pre-discard snapshot can never be written after cancel() runs. Cleared
  // the next time a save is legitimately (re)armed — via the debounce effect
  // or saveNow — so a fresh edit after discard can autosave again.
  const abortedRef = useRef(false);

  // Payload dedupe: remembers the (period, serialized-progress) pair from the
  // last SUCCESSFUL POST so doSave can skip the network entirely when a save
  // fires but nothing persisted actually changed (e.g. only transient UI
  // state triggered the effect). Only set on success, so a failed save leaves
  // these stale and the next attempt still goes through.
  const lastSavedPayloadRef = useRef<string | null>(null);
  const lastSavedPeriodRef = useRef<string | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Performs one POST attempt for whatever is currently in the refs — unless
  // the payload is byte-identical to the last successfully saved one for the
  // same period, in which case it's already persisted and we skip the
  // network call entirely (this is the dedupe's actual enforcement point:
  // every save path funnels through here).
  const postOnce = useCallback(async (period: string) => {
    const progress = serializeProgress(stateRef.current);
    const progressJson = JSON.stringify(progress);

    if (period === lastSavedPeriodRef.current && progressJson === lastSavedPayloadRef.current) {
      // Nothing persisted actually changed — don't burn a Sheets API call.
      resaveNeededRef.current = false;
      if (!abortedRef.current) setStatus("saved");
      return;
    }

    setStatus("saving");
    try {
      const res = await fetch("/api/report/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, progress }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "save failed");
      }
      // A cancel() may have landed while this POST was in flight — the
      // response has already been written server-side, but we must not
      // report a stale "saved" status nor let the caller think this write
      // is authoritative.
      lastSavedPayloadRef.current = progressJson;
      lastSavedPeriodRef.current = period;
      if (!abortedRef.current) setStatus("saved");
    } catch {
      if (!abortedRef.current) setStatus("error");
    }
  }, []);

  // Runs the in-flight guard + last-write-wins loop: if a save is requested
  // while one is in flight, that request only sets resaveNeededRef; once the
  // in-flight POST settles, this loops around to save once more with the
  // by-then-latest state (never queuing more than one pending resave).
  const doSave = useCallback(async () => {
    if (!enabledRef.current) return;
    if (abortedRef.current) return;
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
      while (
        resaveNeededRef.current &&
        !abortedRef.current &&
        enabledRef.current &&
        periodKeyRef.current
      ) {
        resaveNeededRef.current = false;
        await postOnce(periodKeyRef.current);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [postOnce]);

  // Cancels any pending/queued autosave so a stale snapshot can never land
  // after this point: clears the armed debounce timer, drops a queued
  // resave, and flips abortedRef so an already in-flight POST's completion
  // handler (doSave's resave loop, and postOnce's status update) is a no-op.
  // Callers that discard/replace the underlying data (e.g. "start over")
  // must call this BEFORE performing the destructive action, so no timer
  // that fired during that action's own await can race it.
  const cancel = useCallback(() => {
    clearTimer();
    resaveNeededRef.current = false;
    abortedRef.current = true;
  }, [clearTimer]);

  const saveNow = useCallback(() => {
    clearTimer();
    if (!enabledRef.current) return;
    abortedRef.current = false;
    void doSave();
  }, [clearTimer, doSave]);

  // Debounced autosave: any change to `state` (while enabled) restarts the
  // AUTOSAVE_DEBOUNCE_MS timer, coalescing rapid edits into a single save (and,
  // via postOnce's dedupe, into zero network calls if nothing persisted
  // actually changed). `state` itself is
  // read fresh from stateRef inside doSave (kept in sync by the effect
  // above), so this effect only needs to know THAT something changed.
  // Arming a fresh timer here means a legitimate new edit is in play, so any
  // earlier cancel() no longer applies.
  useEffect(() => {
    if (!enabled) return;
    abortedRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return clearTimer;
  }, [state, enabled, clearTimer, doSave]);

  // Clear any pending timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  return { status, saveNow, cancel };
}
