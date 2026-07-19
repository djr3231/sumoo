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

export interface ActiveAccountPayload {
  spreadsheetId: string;
  ownerEmail: string;
  role: FamilyRole;
  verifiedAt: number; // epoch ms of the last successful registry check
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
}

export async function requireSessionIdentity(): Promise<{
  token: string;
  email: string;
}> {
  const session = await getServerSession(authOptions);
  // Session type augmentation only covers accessToken; same cast as
  // requireAccessToken in lib/google.ts.
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const email = session?.user?.email?.toLowerCase();
  if (!token || !email) throw new Error("Not authenticated with Google");
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
    return p;
  } catch {
    return null;
  }
}

// Is `email` a registered family member of the account whose registry lives
// in `spreadsheetId`? Costs one Sheets read — callers cache via the cookie.
export async function verifyMembership(
  token: string,
  spreadsheetId: string,
  email: string,
): Promise<FamilyRole | null> {
  try {
    const settings = await getUserSettings(token, spreadsheetId);
    const member = settings.familyMembers.find((m) => m.email === email);
    return member?.role ?? null;
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
    const role = await verifyMembership(token, f.id, email);
    if (role) out.push({ spreadsheetId: f.id, ownerEmail: f.ownerEmail, role });
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
      };
    }
    const role = await verifyMembership(token, payload.spreadsheetId, email);
    if (role) {
      const refreshed: ActiveAccountPayload = {
        ...payload,
        role,
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
        role,
        ownerEmail: payload.ownerEmail,
      };
    }
    // Membership revoked (or registry unreadable) — fall back to personal.
    store.delete(ACTIVE_ACCOUNT_COOKIE);
  }

  // spreadsheet: false — caller only needs identity + role (token-only
  // routes). Skips the Drive lookup entirely; spreadsheetId must not be used.
  const spreadsheetId = !spreadsheet
    ? ""
    : ensure
      ? await ensureSpreadsheet(token)
      : await resolveSpreadsheetId(token);
  return { token, email, spreadsheetId, role: "owner", ownerEmail: null };
}

// Thrown when the acting role lacks the required capability. Routes map it
// to HTTP 403 via errorStatus().
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden: the active account role does not allow this action");
    this.name = "ForbiddenError";
  }
}

export function errorStatus(err: unknown): number {
  return err instanceof ForbiddenError ? 403 : 500;
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

// UI-only role peek for server components (page shells, Header): verifies
// the cookie's HMAC and returns the role WITHOUT any Google call and WITHOUT
// writing cookies (cookies().set is illegal in server components). A stale
// cookie may briefly overstate membership — acceptable, because every API
// route re-enforces via requireCapability.
export async function peekActingRole(): Promise<ActingRole> {
  const store = await cookies();
  const payload = decodeActiveAccount(store.get(ACTIVE_ACCOUNT_COOKIE)?.value);
  return payload ? payload.role : "owner";
}
