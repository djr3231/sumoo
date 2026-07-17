# Family Members — Plan 1: Identity + Accounts Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can see which sumoo accounts are available to them (their own + accounts whose owners registered them as family members), switch the active account from a new header user menu, and have every API route operate on the active account's spreadsheet.

**Architecture:** The member always uses their own OAuth token (Model B — the owner's spreadsheet is shared with them via Drive; sharing automation comes in Plan 3, manual sharing for now). A new `lib/accounts.ts` module owns account discovery (Drive search for shared `Receipts – sumoo` files + registry check), membership verification, and `resolveActingContext()` — the new front door that replaces `requireAccessToken()` + `ensureSpreadsheet()` in API routes. The active account is persisted in an HMAC-signed httpOnly cookie with a 10-minute re-verification TTL (quota-friendly). Roles are carried through but **not enforced** in this plan (enforcement = Plan 2).

**Tech Stack:** Next.js 16 App Router (async `cookies()` from `next/headers`), NextAuth v4 (JWT sessions), googleapis (Drive v3 / Sheets v4), Node `crypto` HMAC, shadcn `dropdown-menu`, Phosphor icons.

**Spec:** `docs/superpowers/specs/2026-07-17-family-members-design.md`
**Branch:** `feat/family-members` — **Base commit:** `a022071`

## Global Constraints

- TypeScript strict; no `any` without an explaining comment (existing `(session as any).accessToken` pattern may be mirrored where the session type requires it).
- No inline Hebrew **domain** literals outside `lib/types.ts`; pure-presentation UI labels are allowed inline. Approved new Hebrew UI strings for this plan: `החשבון שלי`, `התנתקות`, `חשבון משתמש`, `העלאה וצפייה`, `גישה מלאה`, `מלאה ללא הפקת דוח`, `טוען…`, `טעינת החשבונות נכשלה`, `החלפת החשבון נכשלה`. Any other Hebrew string → STOP and ask.
- Exhaustive `switch` with no `default` over const enums.
- Sheets settings writes use `valueInputOption: "RAW"` (existing `writeUserSettings` already does).
- Keep Google API usage frugal (60 Sheets req/min quota): discovery runs only on menu open / switch, never per data request; membership re-verification only after the 10-minute TTL.
- `lib/google.ts` stays the **only** file importing `googleapis`.
- No `rounded-*` classes; shadcn primitives as-is.
- **No test suite exists.** Per project rules, each task's verify cycle is `npm run typecheck` + `npm run lint` (one accepted pre-existing warning: `UploadZone.tsx:138`); `npm run build` once at the end. Visual/runtime E2E is handed to the user at the end.
- **Implementers do NOT commit.** The orchestrator reviews the diff, runs typecheck itself, and commits with the message given in each task's final step.

---

### Task 1: Domain types + settings registry support

**Files:**
- Modify: `lib/types.ts` (after the `UserSettings` interface, ~line 198)
- Modify: `lib/google.ts` (`getUserSettings` ~line 1035, `writeUserSettings` ~line 1076)
- Modify: `app/api/settings/route.ts` (POST handler)

**Interfaces:**
- Consumes: existing `SETTINGS_KEY`, `UserSettings`, settings helpers.
- Produces (later tasks rely on these exact names):
  - `FAMILY_ROLE` const enum, `FamilyRole` type, `FAMILY_ROLE_VALUES: FamilyRole[]`
  - `interface FamilyMember { email: string; role: FamilyRole }`
  - `SETTINGS_KEY.FamilyMembers === "familyMembers"`
  - `UserSettings.familyMembers: FamilyMember[]` (parsed/serialized by the settings helpers)

- [ ] **Step 1: Add the role enum + member type to `lib/types.ts`**

In the Settings section, extend `SETTINGS_KEY` and `UserSettings`, and add the new declarations right after `UserSettings`:

```ts
export const SETTINGS_KEY = {
  MyCardsLast4: "myCardsLast4",
  HouseholdSize: "householdSize",
  ReportTemplate: "reportTemplate",
  FamilyMembers: "familyMembers",
} as const;
```

```ts
export interface UserSettings {
  myCardsLast4: string[]; // exactly 4-digit strings, validated
  householdSize: number | null; // 1..20; null = unset (fall back to DEFAULT_HOUSEHOLD_SIZE)
  reportTemplate: { id: string; name: string } | null; // null = built-in default template
  familyMembers: FamilyMember[]; // family-members registry (owner's account only)
}

// ============================================================================
// Family members (registry stored as JSON under SETTINGS_KEY.FamilyMembers)
// ============================================================================

export const FAMILY_ROLE = {
  UploadView: "upload-view", // upload receipts + view receipts list only
  Full: "full", // everything the owner can do (except managing members)
  FullNoReport: "full-no-report", // everything except generating/exporting the report
} as const;
export type FamilyRole = (typeof FAMILY_ROLE)[keyof typeof FAMILY_ROLE];
export const FAMILY_ROLE_VALUES: FamilyRole[] = Object.values(FAMILY_ROLE);

export interface FamilyMember {
  email: string; // lowercased Google account email
  role: FamilyRole;
}
```

Note: `FamilyMember` is referenced by `UserSettings` above its declaration — interfaces hoist, this is fine; keep the declaration order shown (settings block stays together).

- [ ] **Step 2: Parse + serialize the registry in `lib/google.ts`**

Add `FAMILY_ROLE_VALUES` and `type FamilyMember` to the existing `./types` import list.

In `getUserSettings`, update the `empty` default and add a parse branch after the `ReportTemplate` branch:

```ts
const empty: UserSettings = {
  myCardsLast4: [],
  householdSize: null,
  reportTemplate: null,
  familyMembers: [],
};
```

```ts
      if (key === SETTINGS_KEY.FamilyMembers) {
        try {
          const arr = JSON.parse(value) as unknown;
          if (Array.isArray(arr)) {
            out.familyMembers = arr
              .filter(
                (m): m is FamilyMember =>
                  !!m &&
                  typeof m === "object" &&
                  typeof (m as FamilyMember).email === "string" &&
                  (m as FamilyMember).email.includes("@") &&
                  (FAMILY_ROLE_VALUES as string[]).includes((m as FamilyMember).role),
              )
              .map((m) => ({ email: m.email.toLowerCase(), role: m.role }));
          }
        } catch { /* malformed row — treat as unset */ }
      }
```

In `writeUserSettings`, after the `reportTemplate` row push:

```ts
  if (s.familyMembers.length > 0) {
    rows.push([SETTINGS_KEY.FamilyMembers, JSON.stringify(s.familyMembers)]);
  }
```

- [ ] **Step 3: Preserve the registry on settings save (`app/api/settings/route.ts` POST)**

`writeUserSettings` clears `A2:B` and rewrites — without this step, every settings save from the UI would wipe the registry. Replace the write call in the POST handler:

```ts
    const token = await requireAccessToken();
    const spreadsheetId = await ensureSpreadsheet(token);
    // The settings form doesn't know about familyMembers — preserve the
    // stored registry across rewrites (writeUserSettings clears A2:B).
    const current = await getUserSettings(token, spreadsheetId);
    await writeUserSettings(token, spreadsheetId, {
      myCardsLast4,
      householdSize,
      reportTemplate,
      familyMembers: current.familyMembers,
    });
```

(`getUserSettings` is already imported in this file.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — expected: clean.
Run: `npm run lint` — expected: only the accepted `UploadZone.tsx:138` warning.
Note: `scan-context/route.ts`'s `.catch(() => ({ myCardsLast4: [] as string[] }))` fallback is structurally typed and unaffected — if typecheck disagrees, extend that object literal with `familyMembers: []` rather than casting.

- [ ] **Step 5: Orchestrator commits**

```bash
git add lib/types.ts lib/google.ts app/api/settings/route.ts
git commit -m "feat(family): family-role domain types + registry in settings"
```

---

### Task 2: Shared-file discovery helper in `lib/google.ts`

**Files:**
- Modify: `lib/google.ts` (add after `resolveSpreadsheetId`, ~line 207)

**Interfaces:**
- Consumes: existing `driveClient`, module-level `const SHEET_NAME = "Receipts – sumoo"` (line 45).
- Produces: `listSharedSumooFiles(accessToken: string): Promise<Array<{ id: string; ownerEmail: string }>>`

- [ ] **Step 1: Add the helper**

```ts
// Spreadsheets named like ours that OTHER users shared with the signed-in
// user — candidates for family-member account discovery. Covered by the
// drive.readonly scope. The registry check (is my email listed?) happens in
// lib/accounts.ts; this only surfaces the candidates.
export async function listSharedSumooFiles(
  accessToken: string,
): Promise<Array<{ id: string; ownerEmail: string }>> {
  const drive = driveClient(accessToken);
  const r = await drive.files.list({
    q: `name = '${SHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and sharedWithMe = true and trashed = false`,
    fields: "files(id,name,owners(emailAddress))",
    pageSize: 10,
  });
  return (r.data.files || []).map((f) => ({
    id: f.id!,
    ownerEmail: f.owners?.[0]?.emailAddress?.toLowerCase() ?? "",
  }));
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — expected: clean.

- [ ] **Step 3: Orchestrator commits**

```bash
git add lib/google.ts
git commit -m "feat(family): Drive discovery of shared sumoo spreadsheets"
```

---

### Task 3: `lib/accounts.ts` — identity, signed cookie, acting context

**Files:**
- Create: `lib/accounts.ts`

**Interfaces:**
- Consumes: `getServerSession`/`authOptions`, `cookies()` from `next/headers` (async — must be awaited), `ensureSpreadsheet` / `resolveSpreadsheetId` / `getUserSettings` / `listSharedSumooFiles` from `./google`, `FAMILY_ROLE_VALUES` / `FamilyRole` from `./types`.
- Produces (Tasks 4–6 rely on these exact names):
  - `ACTIVE_ACCOUNT_COOKIE = "sumoo-active-account"`, `ACTIVE_ACCOUNT_COOKIE_OPTIONS`
  - `requireSessionIdentity(): Promise<{ token: string; email: string }>`
  - `encodeActiveAccount(p: ActiveAccountPayload): string`, `decodeActiveAccount(raw: string | undefined): ActiveAccountPayload | null`
  - `verifyMembership(token, spreadsheetId, email): Promise<FamilyRole | null>`
  - `listAvailableAccounts(token, email): Promise<SharedAccountOption[]>`
  - `resolveActingContext(opts?: { ensure?: boolean }): Promise<ActingContext>`

- [ ] **Step 1: Create the module**

```ts
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
import { FAMILY_ROLE_VALUES, type FamilyRole } from "./types";

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
  role: "owner" | FamilyRole; // "owner" = acting on their personal account
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
  opts: { ensure?: boolean } = {},
): Promise<ActingContext> {
  const { ensure = true } = opts;
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

  const spreadsheetId = ensure
    ? await ensureSpreadsheet(token)
    : await resolveSpreadsheetId(token);
  return { token, email, spreadsheetId, role: "owner", ownerEmail: null };
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — expected: clean.
Run: `npm run lint` — expected: only the accepted warning.

- [ ] **Step 3: Orchestrator commits**

```bash
git add lib/accounts.ts
git commit -m "feat(family): accounts module — discovery, signed cookie, acting context"
```

---

### Task 4: `/api/accounts` + `/api/accounts/switch`

**Files:**
- Create: `app/api/accounts/route.ts`
- Create: `app/api/accounts/switch/route.ts`

**Interfaces:**
- Consumes: Task 3's exports; `listSharedSumooFiles` from `@/lib/google`.
- Produces (Task 6's client relies on these exact shapes):
  - `GET /api/accounts` → `{ email: string, shared: SharedAccountOption[], active: { kind: "personal" } | { kind: "shared"; spreadsheetId: string } }`
  - `POST /api/accounts/switch` body `{ target: "personal" | <spreadsheetId> }` → `{ ok: true, active: ... }`; `403 { error }` when not a member.

- [ ] **Step 1: Create `app/api/accounts/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACTIVE_ACCOUNT_COOKIE,
  decodeActiveAccount,
  listAvailableAccounts,
  requireSessionIdentity,
} from "@/lib/accounts";

export const runtime = "nodejs";

// Accounts available to the signed-in user (personal + shared) and which one
// is currently active. Called when the header user menu opens — not on the
// per-request data path.
export async function GET() {
  try {
    const { token, email } = await requireSessionIdentity();
    const shared = await listAvailableAccounts(token, email);
    const store = await cookies();
    const active = decodeActiveAccount(store.get(ACTIVE_ACCOUNT_COOKIE)?.value);
    return NextResponse.json({
      email,
      shared,
      active: active
        ? { kind: "shared", spreadsheetId: active.spreadsheetId }
        : { kind: "personal" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `app/api/accounts/switch/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACTIVE_ACCOUNT_COOKIE,
  ACTIVE_ACCOUNT_COOKIE_OPTIONS,
  encodeActiveAccount,
  requireSessionIdentity,
  verifyMembership,
} from "@/lib/accounts";
import { listSharedSumooFiles } from "@/lib/google";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, email } = await requireSessionIdentity();
    const body = (await req.json()) as { target?: unknown };
    const target = typeof body.target === "string" ? body.target : "";
    const store = await cookies();

    if (target === "personal" || target === "") {
      store.delete(ACTIVE_ACCOUNT_COOKIE);
      return NextResponse.json({ ok: true, active: { kind: "personal" } });
    }

    const role = await verifyMembership(token, target, email);
    if (!role) {
      return NextResponse.json(
        { error: "Not a member of this account" },
        { status: 403 },
      );
    }
    const files = await listSharedSumooFiles(token);
    const ownerEmail = files.find((f) => f.id === target)?.ownerEmail ?? "";
    store.set(
      ACTIVE_ACCOUNT_COOKIE,
      encodeActiveAccount({
        spreadsheetId: target,
        ownerEmail,
        role,
        verifiedAt: Date.now(),
      }),
      ACTIVE_ACCOUNT_COOKIE_OPTIONS,
    );
    return NextResponse.json({
      ok: true,
      active: { kind: "shared", spreadsheetId: target, ownerEmail, role },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — expected: clean.
Run: `npm run lint` — expected: only the accepted warning.

- [ ] **Step 4: Orchestrator commits**

```bash
git add app/api/accounts
git commit -m "feat(family): accounts list + switch API routes"
```

---

### Task 5: Wire the acting context into the data routes

**Files (exact call sites, from grep at base commit):**
- Modify: `app/api/sheets/route.ts:29-30, 40-41, 52-53`
- Modify: `app/api/scan-context/route.ts:18-19`
- Modify: `app/api/settings/route.ts` (both handlers — lines 14-15 and the Task-1-modified POST)
- Modify: `app/api/fix-drive-ids/route.ts:15-16`
- Modify: `app/api/ocr/route.ts:157-158`
- Modify: `app/api/dedup/route.ts:50-51`
- Modify: `app/api/match/route.ts:20-21`
- Modify: `app/api/report/receipts/route.ts:14-15`
- Modify: `app/api/report/progress/route.ts:22-23, 38-39, 57-58`
- Modify: `app/api/report/generate/route.ts:36-37`
- Modify: `app/api/report/pdf/route.ts:64-65`

**Interfaces:**
- Consumes: `resolveActingContext` from `@/lib/accounts` (Task 3).
- Produces: every spreadsheet-touching route now targets the active account. Token-only call sites are deliberately left as `requireAccessToken()` in this plan.

- [ ] **Step 1: Apply the two mechanical patterns**

Pattern A — sites that pair `requireAccessToken()` with `ensureSpreadsheet(token)`:

```ts
// before
const token = await requireAccessToken();
const spreadsheetId = await ensureSpreadsheet(token);

// after
const { token, spreadsheetId } = await resolveActingContext();
```

Pattern B — sites that pair it with `resolveSpreadsheetId(token)` (report hot paths):

```ts
// before
const token = await requireAccessToken();
const spreadsheetId = await resolveSpreadsheetId(token);

// after
const { token, spreadsheetId } = await resolveActingContext({ ensure: false });
```

In each touched file: add `import { resolveActingContext } from "@/lib/accounts";` and remove `requireAccessToken` / `ensureSpreadsheet` / `resolveSpreadsheetId` from the `@/lib/google` import **only if no other call site in that file still uses them**.

Do **NOT** touch token-only call sites (no spreadsheet resolution): `app/api/drive/route.ts:8`, `app/api/drive/folders/route.ts:11`, `app/api/drive/files/route.ts:13`, `app/api/ocr/route.ts:106`, `app/api/report/period/route.ts:23`, `app/api/report/process/route.ts:19`, and any similar site in `app/api/report/parse|classify` and `app/api/statements` — they operate on the caller's own Drive/token and adding a spreadsheet lookup would waste quota.

- [ ] **Step 2: Verify no stragglers**

Run: `grep -rn "ensureSpreadsheet\|resolveSpreadsheetId" app/api`
Expected: **no matches** (all spreadsheet resolution now flows through `resolveActingContext`).

Run: `grep -rn "requireAccessToken" app/api`
Expected: matches only in the token-only files listed in Step 1.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — expected: clean.
Run: `npm run lint` — expected: only the accepted warning.

- [ ] **Step 4: Orchestrator commits**

```bash
git add app/api
git commit -m "feat(family): route data access through the acting context"
```

---

### Task 6: Header user menu (desktop + mobile)

**Files:**
- Create: `components/UserMenu.tsx`
- Modify: `components/Header.tsx` (desktop right cluster, lines 43-49)
- Modify: `components/MobileNav.tsx` (footer, lines 42-50)

**Interfaces:**
- Consumes: `GET /api/accounts` + `POST /api/accounts/switch` (Task 4 shapes), `FAMILY_ROLE`/`FamilyRole` from `@/lib/types`, `components/ui/dropdown-menu` (exports `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`), `Button` from `components/ui/button`, `UserCircle` from `@phosphor-icons/react`, `signOut` from `next-auth/react`, `toast` from `sonner`.
- Produces: `<UserMenu email={string} />` used by both header layouts.

- [ ] **Step 1: Create `components/UserMenu.tsx`**

```tsx
"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { UserCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { FAMILY_ROLE, type FamilyRole } from "@/lib/types";

interface SharedAccount {
  spreadsheetId: string;
  ownerEmail: string;
  role: FamilyRole;
}

interface AccountsResponse {
  email: string;
  shared: SharedAccount[];
  active: { kind: "personal" | "shared"; spreadsheetId?: string };
  error?: string;
}

// Presentation-only role names (not domain values). Exhaustive switch — a
// new FAMILY_ROLE value must be handled here before this compiles.
function roleLabel(role: FamilyRole): string {
  switch (role) {
    case FAMILY_ROLE.UploadView:
      return "העלאה וצפייה";
    case FAMILY_ROLE.Full:
      return "גישה מלאה";
    case FAMILY_ROLE.FullNoReport:
      return "מלאה ללא הפקת דוח";
  }
}

export function UserMenu({ email }: { email: string }) {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (data || loading) return;
    setLoading(true);
    try {
      const r = await fetch("/api/accounts");
      const j = (await r.json()) as AccountsResponse;
      if (!r.ok) throw new Error(j.error || "failed");
      setData(j);
    } catch {
      toast.error("טעינת החשבונות נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function switchTo(target: string) {
    try {
      const r = await fetch("/api/accounts/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error || "failed");
      }
      // Every view fetches on mount — a full reload is the simplest way to
      // re-render all data for the newly active account.
      window.location.reload();
    } catch {
      toast.error("החלפת החשבון נכשלה");
    }
  }

  const active =
    data?.active.kind === "shared" && data.active.spreadsheetId
      ? data.active.spreadsheetId
      : "personal";

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="חשבון משתמש">
          <UserCircle size={22} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {data ? (
          <DropdownMenuRadioGroup
            value={active}
            onValueChange={(v) => {
              if (v !== active) void switchTo(v);
            }}
          >
            <DropdownMenuRadioItem value="personal">
              החשבון שלי
            </DropdownMenuRadioItem>
            {data.shared.map((a) => (
              <DropdownMenuRadioItem key={a.spreadsheetId} value={a.spreadsheetId}>
                <span className="flex flex-col items-start">
                  <span>{a.ownerEmail}</span>
                  <span className="text-xs text-muted-foreground">
                    {roleLabel(a.role)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <DropdownMenuItem disabled>{loading ? "טוען…" : "…"}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/" })}>
          התנתקות
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Use it in `components/Header.tsx` (desktop cluster)**

Replace lines 43-49 (`<div className="text-sm ...">` content — the email span + `<SignOutButton />`):

```tsx
              <div className="text-sm flex items-center gap-3">
                <ThemeToggle />
                <span className="text-muted-foreground">
                  {session.user.email}
                </span>
                <UserMenu email={session.user.email ?? ""} />
              </div>
```

Replace the `SignOutButton` import with `import { UserMenu } from "./UserMenu";` (keep `SignInButton`).

- [ ] **Step 3: Use it in `components/MobileNav.tsx` (footer)**

Replace the footer block (lines 42-50) so the sign-out row becomes the menu:

```tsx
        <div className="mt-auto pt-6 flex flex-col gap-3 text-sm border-t border-border">
          <div className="flex items-center justify-between px-3 pt-3 pb-3">
            <span className="text-muted-foreground">{email}</span>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <UserMenu email={email} />
            </div>
          </div>
        </div>
```

Replace the `SignOutButton` import with `import { UserMenu } from "./UserMenu";`. Do not delete `components/SignOutButton.tsx` (still referenced by nothing is fine; removal is out of scope).

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — expected: clean.
Run: `npm run lint` — expected: only the accepted warning (if `SignOutButton` unused-import errors appear in the two modified files, the import replacement in Steps 2-3 was missed).

- [ ] **Step 5: Orchestrator commits**

```bash
git add components/UserMenu.tsx components/Header.tsx components/MobileNav.tsx
git commit -m "feat(family): header user menu with account switching"
```

---

### Task 7: Batch gate + E2E handoff

- [ ] **Step 1: Full verification**

Run: `npm run typecheck` — expected: clean.
Run: `npm run lint` — expected: only `UploadZone.tsx:138`.
Run: `npm run build` — expected: successful production build.

- [ ] **Step 2: Hand off E2E to the user (do NOT run the dev server)**

Manual setup required (Plan 3 automates this later) — owner account:
1. In Google Drive, share the `Receipts – sumoo` spreadsheet **and** the `סומו - העלאות` folder with the member's email (editor).
2. In the spreadsheet's `הגדרות` tab add a row: column A `familyMembers`, column B `[{"email":"<member-email>","role":"full"}]` (lowercase email).

Then verify as the member:
1. Sign in → header shows the new user-menu icon; open it → both "החשבון שלי" and the owner's account (with role caption) appear.
2. Switch to the owner's account → page reloads → `/receipts` shows the **owner's** data; uploading a receipt lands in the owner's sheet.
3. Switch back to "החשבון שלי" → own data again.
4. Reload the browser → last choice remembered.
5. Sign out from the menu works.
6. As a non-member third account: only "החשבון שלי" appears; personal flow unchanged.

---

## Plan chain

- **Plan 1 (this):** identity + accounts core — roles carried, not enforced.
- **Plan 2 (next, authored after Plan 1 E2E):** permission matrix enforcement server-side + role-gated UI (`upload-view` read-only surfaces, `full-no-report` step-6 blocks).
- **Plan 3:** `/api/family` management route + automatic Drive sharing + Settings UI section.
