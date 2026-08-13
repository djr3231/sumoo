// The single door for every client -> /api/* call.
//
// Before this existed each component hand-rolled `fetch`, so a 401 was
// indistinguishable from any other failure and the app kept running against a
// dead Google grant — scanning receipts that were never written anywhere.
//
// apiFetch returns the Response untouched, so existing `if (!res.ok)` call
// sites keep working; the only added behaviour is ending the session on 401.

type AuthExpiryListener = () => void;

let authExpiryListener: AuthExpiryListener | null = null;
// A parallel scan can produce many 401s at once; the session ends exactly once.
let expiryNotified = false;

// SessionGuard registers here. It owns the actual sign-out so that a 401 and a
// `session.error` end the session through the same code path — and so this
// module stays free of React/router imports.
export function setAuthExpiryListener(fn: AuthExpiryListener | null): void {
  authExpiryListener = fn;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// In-flight tracking, so the UI can show that something is happening. Sheets
// round-trips take seconds and every one of them used to be silent.
// ---------------------------------------------------------------------------

export interface ApiActivity {
  /** Requests currently in flight. */
  pending: number;
  /** Of those, how many asked to block the UI. */
  blocking: number;
}

let activity: ApiActivity = { pending: 0, blocking: 0 };
const activityListeners = new Set<(a: ApiActivity) => void>();

export function subscribeApiActivity(fn: (a: ApiActivity) => void): () => void {
  activityListeners.add(fn);
  fn(activity);
  return () => activityListeners.delete(fn);
}

export function getApiActivity(): ApiActivity {
  return activity;
}

function bumpActivity(pending: number, blocking: number): void {
  activity = {
    pending: activity.pending + pending,
    blocking: activity.blocking + blocking,
  };
  for (const fn of activityListeners) fn(activity);
}

export interface ApiFetchOptions {
  /** Cover the app with a blocking overlay while this request runs. Reserve it
   *  for deliberate, long operations — never for per-field autosave, which
   *  fires on every blur. */
  blocking?: boolean;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: ApiFetchOptions = {},
): Promise<Response> {
  const blocking = opts.blocking ? 1 : 0;
  bumpActivity(1, blocking);
  try {
    const res = await fetch(input, init);
    if (res.status === 401 && !expiryNotified) {
      expiryNotified = true;
      authExpiryListener?.();
    }
    return res;
  } finally {
    bumpActivity(-1, -blocking);
  }
}

// Pull the message out of the `{ error }` envelope every route returns, falling
// back to the status when the body is missing or not JSON.
export async function apiErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// apiFetch + "throw on failure", for call sites that already work in
// try/catch. Throws ApiError carrying the status, so overload handling
// (503/429) keeps working.
export async function apiFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) throw new ApiError(res.status, await apiErrorMessage(res));
  return (await res.json()) as T;
}
