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

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && !expiryNotified) {
    expiryNotified = true;
    authExpiryListener?.();
  }
  return res;
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
