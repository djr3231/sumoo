// Swappable per-period progress storage. `ProgressStore` is the interface the
// wizard's persistence hook (Task 4+) talks to; `googleSheetProgressStore` is
// the current backend (one tab per period in the user's spreadsheet). A
// future `dbProgressStore` can implement the same interface without any
// wizard changes.

import { ensureNamedTab, readJsonDoc, writeJsonDoc } from "@/lib/google";
import type { ReportProgress } from "@/lib/report/progress";

export interface ProgressStore {
  load(periodKey: string): Promise<ReportProgress | null>;
  save(periodKey: string, progress: ReportProgress): Promise<void>;
}

// Tab title for a given period key, e.g. periodKey "5-6_2026" -> "progress_5-6_2026".
function progressTabTitle(periodKey: string): string {
  return `progress_${periodKey}`;
}

// Pretty-print with a sorted-key replacer so the stored JSON has a stable key
// order (human-inspectable in the Sheet cell, and diff-friendly).
function stableStringify(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sortKeys((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, 2);
}

// Factory: parameterized by accessToken + spreadsheetId so callers (API
// routes) construct one per request rather than this module holding any
// ambient auth state.
export function googleSheetProgressStore(
  accessToken: string,
  spreadsheetId: string,
): ProgressStore {
  return {
    async load(periodKey: string): Promise<ReportProgress | null> {
      const title = progressTabTitle(periodKey);
      const raw = await readJsonDoc(accessToken, spreadsheetId, title);
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null; // corrupt doc — treat as no-progress, never crash
      }
      const progress = parsed as Partial<ReportProgress> | null;
      if (progress == null || progress.schemaVersion !== 1) return null;
      return progress as ReportProgress;
    },

    async save(periodKey: string, progress: ReportProgress): Promise<void> {
      const title = progressTabTitle(periodKey);
      await ensureNamedTab(accessToken, spreadsheetId, title);
      await writeJsonDoc(accessToken, spreadsheetId, title, stableStringify(progress));
    },
  };
}
