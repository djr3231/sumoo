import crypto from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import {
  ensureSpreadsheet,
  getUserSettings,
  listSharedSumooFiles,
  resolveSpreadsheetId,
} from "./google";
import {
  FAMILY_ROLE_VALUES,
  roleCan,
  type ActingRole,
  type Capability,
  type FamilyRole,
} from "./types";

// ============================================================================
// Active-account selection for the family-members feature.
//
// The signed-in user always operates with their OWN OAuth token; "switching
// account" only changes WHICH spreadsheet the API routes target. The choice
// is persisted in an HMAC-signed httpOnly cookie (doubles as "remember last
// choice"). Membership is re-verified against the owner's registry at most
// once per TTL — never on every data request (Sheets quota: 60 req/min).
// ============================================================================

export const ACTIVE_ACCOUNT_COOKIE = "sumoo-active-account";

export const ACTIVE_ACCOUNT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // remember the last choice long-term
};

const MEMBERSHIP_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Personal-spreadsheet id cache
//
// resolveSpreadsheetId costs a Drive files.list, and ensureSpreadsheet adds
// spreadsheets.get + values.batchGet + spreadsheets.get on top — per request,
// for an id that never changes. Cache it in an HMAC-signed cookie, bound to
// the signed-in email so a different account cannot inherit it.
// ---------------------------------------------------------------------------

export const PERSONAL_SHEET_COOKIE = "sumoo-personal-sheet";

const PERSONAL_SHEET_TTL_MS = 24 * 60 * 60 * 1000;

export const PERSONAL_SHEET_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: PERSONAL_SHEET_TTL_MS / 1000,
};

interface PersonalSheetPayload {
  spreadsheetId: string;
  email: string;
  cachedAt: number;
}

export interface ActiveAccountPayload {
  spreadsheetId: string;
  ownerEmail: string;
  role: FamilyRole;
  verifiedAt: number; // epoch ms of the last successful registry check
  // The OWNER's upload folder id, cached from the same registry read that
  // verifies membership. null = the owner has not registered one yet.
  uploadFolderId: string | null;
}

export interface SharedAccountOption {
  spreadsheetId: string;
  ownerEmail: string;
  role: FamilyRole;
}

export interface ActingContext {
  token: string; // the signed-in user's own access token — always
  email: string; // signed-in user's email, lowercased
  spreadsheetId: string;
  role: ActingRole; // "owner" = acting on their personal account
  ownerEmail: string | null; // null when acting on the personal account
  uploadFolderId: string | null; // owner's upload folder; null on personal accounts
}

export async function requireSessionIdentity(): Promise<{
  token: string;
  email: string;
}> {
  const session = await getServerSession(authOptions);
  // `session.error` means the jwt callback found the Google grant dead and
  // already cleared the access token (lib/auth.ts). Treat it as unauthenticated
  // so the route answers 401 and the client signs out — rather than 500, which
  // is indistinguishable from a quota error or a bug.
  if (!session || session.error) throw new UnauthenticatedError();
  const token = session.accessToken;
  const email = session.user?.email?.toLowerCase();
  if (!token || !email) throw new UnauthenticatedError();
  return { token, email };
}

function sign(data: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function encodeActiveAccount(p: ActiveAccountPayload): string {
  const data = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function decodeActiveAccount(
  raw: string | undefined,
): ActiveAccountPayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(data);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const p = JSON.parse(
      Buffer.from(data, "base64url").toString(),
    ) as ActiveAccountPayload;
    if (typeof p.spreadsheetId !== "string" || !p.spreadsheetId) return null;
    if (typeof p.ownerEmail !== "string") return null;
    if (!(FAMILY_ROLE_VALUES as string[]).includes(p.role)) return null;
    if (typeof p.verifiedAt !== "number") return null;
    // Cookies minted before Plan 3 have no uploadFolderId — normalize to null
    // instead of rejecting, or every member would be bounced to personal.
    const folderId = (p as { uploadFolderId?: unknown }).uploadFolderId;
    return {
      ...p,
      uploadFolderId: typeof folderId === "string" && folderId ? folderId : null,
    };
  } catch {
    return null;
  }
}

function encodePersonalSheet(spreadsheetId: string, email: string): string {
  const payload: PersonalSheetPayload = {
    spreadsheetId,
    email,
    cachedAt: Date.now(),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

// Returns the cached id only if the signature holds, the TTL has not passed,
// and the cookie belongs to the currently signed-in email.
function decodePersonalSheet(
  raw: string | undefined,
  email: string,
): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = raw.slice(0, dot);
  const sigBuf = Buffer.from(raw.slice(dot + 1));
  const expBuf = Buffer.from(sign(data));
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const p = JSON.parse(
      Buffer.from(data, "base64url").toString(),
    ) as PersonalSheetPayload;
    if (typeof p.spreadsheetId !== "string" || !p.spreadsheetId) return null;
    if (p.email !== email) return null;
    if (Date.now() - p.cachedAt > PERSONAL_SHEET_TTL_MS) return null;
    return p.spreadsheetId;
  } catch {
    return null;
  }
}

// Is `email` a registered family member of the account whose registry lives
// in `spreadsheetId`? Returns the role plus the owner's upload folder id from
// the SAME settings read — callers cache both via the cookie.
// Costs one Sheets read.
export async function verifyMembership(
  token: string,
  spreadsheetId: string,
  email: string,
): Promise<{ role: FamilyRole; uploadFolderId: string | null } | null> {
  try {
    const settings = await getUserSettings(token, spreadsheetId);
    const member = settings.familyMembers.find((m) => m.email === email);
    if (!member) return null;
    return { role: member.role, uploadFolderId: settings.uploadFolderId };
  } catch {
    return null;
  }
}

// All shared accounts available to this user. Called on menu open / switch —
// never on the per-request data path.
export async function listAvailableAccounts(
  token: string,
  email: string,
): Promise<SharedAccountOption[]> {
  const files = await listSharedSumooFiles(token);
  const out: SharedAccountOption[] = [];
  for (const f of files) {
    const m = await verifyMembership(token, f.id, email);
    if (m) out.push({ spreadsheetId: f.id, ownerEmail: f.ownerEmail, role: m.role });
  }
  return out;
}

// The front door for API routes: which spreadsheet is this request acting
// on, as whom, with what role. Route handlers ONLY (uses cookies()).
// `ensure: true` (default) mirrors ensureSpreadsheet for personal accounts;
// pass `ensure: false` on hot paths that used resolveSpreadsheetId.
export async function resolveActingContext(
  opts: { ensure?: boolean; spreadsheet?: boolean } = {},
): Promise<ActingContext> {
  const { ensure = true, spreadsheet = true } = opts;
  const { token, email } = await requireSessionIdentity();
  const store = await cookies();
  const payload = decodeActiveAccount(store.get(ACTIVE_ACCOUNT_COOKIE)?.value);

  if (payload) {
    if (Date.now() - payload.verifiedAt <= MEMBERSHIP_TTL_MS) {
      return {
        token,
        email,
        spreadsheetId: payload.spreadsheetId,
        role: payload.role,
        ownerEmail: payload.ownerEmail,
        uploadFolderId: payload.uploadFolderId,
      };
    }
    const m = await verifyMembership(token, payload.spreadsheetId, email);
    if (m) {
      const refreshed: ActiveAccountPayload = {
        ...payload,
        role: m.role,
        uploadFolderId: m.uploadFolderId,
        verifiedAt: Date.now(),
      };
      store.set(
        ACTIVE_ACCOUNT_COOKIE,
        encodeActiveAccount(refreshed),
        ACTIVE_ACCOUNT_COOKIE_OPTIONS,
      );
      return {
        token,
        email,
        spreadsheetId: payload.spreadsheetId,
        role: m.role,
        ownerEmail: payload.ownerEmail,
        uploadFolderId: m.uploadFolderId,
      };
    }
    // Membership revoked (or registry unreadable) — fall back to personal.
    store.delete(ACTIVE_ACCOUNT_COOKIE);
  }

  // spreadsheet: false — caller only needs identity + role (token-only
  // routes). Skips the Drive lookup entirely; spreadsheetId must not be used.
  let spreadsheetId = "";
  if (spreadsheet) {
    // The personal spreadsheet id never changes, but finding it costs a Drive
    // files.list on EVERY request (and ensureSpreadsheet adds three more calls
    // on top). Cache it in the same signed-cookie mechanism the active account
    // uses, so the lookup happens once a day instead of once a request.
    const cached = decodePersonalSheet(
      store.get(PERSONAL_SHEET_COOKIE)?.value,
      email,
    );
    if (cached) {
      // A cached entry is only ever written by the ensure path, so the main
      // tabs are known to exist and ensureTabs can be skipped either way.
      spreadsheetId = cached;
    } else if (ensure) {
      spreadsheetId = await ensureSpreadsheet(token);
      store.set(
        PERSONAL_SHEET_COOKIE,
        encodePersonalSheet(spreadsheetId, email),
        PERSONAL_SHEET_COOKIE_OPTIONS,
      );
    } else {
      // Deliberately NOT cached: this path never ran ensureTabs, and caching it
      // would let a brand-new user's later ensure:true call hit the cache and
      // skip tab creation entirely.
      spreadsheetId = await resolveSpreadsheetId(token);
    }
  }
  return {
    token,
    email,
    spreadsheetId,
    role: "owner",
    ownerEmail: null,
    uploadFolderId: null,
  };
}

// Thrown when the acting role lacks the required capability. Routes map it
// to HTTP 403 via errorStatus().
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden: the active account role does not allow this action");
    this.name = "ForbiddenError";
  }
}

// Thrown when there is no usable Google grant. Routes map it to HTTP 401.
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated with Google");
    this.name = "UnauthenticatedError";
  }
}

// A grant revoked mid-session: NextAuth still holds an unexpired access token,
// but Google rejects it. Only a real API call reveals this, so the raw
// googleapis error has to be recognised too. Depending on the failure path the
// status lands on `code`, `status`, or `response.status`.
export function isGoogleAuthError(err: unknown): boolean {
  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  } | null;
  return e?.code === 401 || e?.status === 401 || e?.response?.status === 401;
}

export function errorStatus(err: unknown): number {
  if (err instanceof UnauthenticatedError) return 401;
  if (err instanceof ForbiddenError) return 403;
  if (isGoogleAuthError(err)) return 401;
  return 500;
}

// The standard route front door with authorization: resolves the acting
// context, then verifies the role holds the capability. Adds zero Google
// calls beyond what resolveActingContext already does.
export async function requireCapability(
  cap: Capability,
  opts: { ensure?: boolean; spreadsheet?: boolean } = {},
): Promise<ActingContext> {
  const ctx = await resolveActingContext(opts);
  if (!roleCan(ctx.role, cap)) throw new ForbiddenError();
  return ctx;
}

// UI-only peek for server components (page shells, Header): verifies the
// cookie's HMAC and returns the acting role + owner email WITHOUT any Google
// call and WITHOUT writing cookies (cookies().set is illegal in server
// components). A stale cookie may briefly overstate membership — acceptable,
// because every API route re-enforces via requireCapability.
export async function peekActingAccount(): Promise<{
  role: ActingRole;
  ownerEmail: string | null;
}> {
  const store = await cookies();
  const payload = decodeActiveAccount(store.get(ACTIVE_ACCOUNT_COOKIE)?.value);
  return payload
    ? { role: payload.role, ownerEmail: payload.ownerEmail }
    : { role: "owner", ownerEmail: null };
}

export async function peekActingRole(): Promise<ActingRole> {
  return (await peekActingAccount()).role;
}
