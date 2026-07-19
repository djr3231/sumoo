# Family Members — Plan 3: Management, Sharing, Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner can register and remove family members from the settings screen — the app writes the registry, shares the right Drive assets automatically, shows which account you are acting on, and a member's uploaded receipt image lands in the **owner's** upload folder.

**Architecture:** `/api/family` is the single owner-only write path (new `CAPABILITY.ManageFamily`, which is the first capability `full` does not hold). It performs a strict read-modify-write on the `הגדרות` registry, then shares the spreadsheet + upload folder as `writer` and a custom report template as `reader` via two new `lib/google.ts` helpers. The owner's upload-folder id becomes stored data (`SETTINGS_KEY.UploadFolderId`) instead of a Drive name search; it reaches the member through the existing signed active-account cookie, populated by the `getUserSettings` call `verifyMembership` already makes — zero additional Google calls. The header renders an account chip from a pure cookie decode (`peekActingAccount`).

**Tech Stack:** Next.js 16 App Router (route handlers + async `cookies()`), TypeScript strict, `googleapis` Drive v3 (`permissions.create` / `.list` / `.delete`), existing shadcn primitives (`Badge`, `Input`, `Select`, `Button`).

**Spec:** `docs/superpowers/specs/2026-07-19-family-members-3-management-sharing-design.md`
**Parent spec:** `docs/superpowers/specs/2026-07-17-family-members-design.md` §8.1, §9, §10.4
**Branch:** `feat/family-members` — **Base commit:** `c669462`

## Global Constraints

- TypeScript strict; no `any` without an explaining comment.
- Exhaustive `switch` with no `default` over const enums — adding a role or capability must break the build until `roleCan` handles it.
- `lib/google.ts` stays the only `googleapis` importer. `lib/accounts.ts` stays the only authorization module.
- **Quota frugality** (60 Sheets req/min on the test account): this plan adds **zero** Google calls to the receipt-upload path and zero to any per-request data path. New calls happen only inside `/api/family`, which a human triggers by hand.
- **Anonymity:** never log an email address. Log the failing target name only.
- API error strings are English. Approved new Hebrew UI strings for this plan — anything else is STOP-and-ASK:
  `בני משפחה`, `כתובת אימייל`, `הרשאה`, `הוספה`, `הסרה`, `חשבון משותף`,
  `בן המשפחה נוסף`, `בן המשפחה הוסר`, `ההרשאה עודכנה`, `הוספת בן המשפחה נכשלה`,
  `הסרת בן המשפחה נכשלה`, `חלק מהשיתופים ב-Drive נכשלו`,
  `בני משפחה שהוספת יוכלו להיכנס עם חשבון Google שלהם ולעבוד על החשבון הזה לפי ההרשאה שתיתן.`
- Reuse the existing Hebrew role names (`העלאה וצפייה`, `גישה מלאה`, `מלאה ללא הפקת דוח`) — do not retype variants.
- No new color, radius, font, or custom CSS (DESIGN-SYSTEM.md). Only existing primitives + layout utilities.
- **No test suite.** Per task: `npm run typecheck` + `npm run lint` (accepted pre-existing warning: `UploadZone.tsx:138`). `npm run build` once at the end (Task 8). Runtime/visual E2E is handed to the user — implementers never run `npm run dev`.
- **Implementers do NOT commit** — the orchestrator reviews the diff, runs typecheck, and commits using the message in each task's final step.

---

### Task 1: `ManageFamily` capability + `uploadFolderId` setting

**Files:**
- Modify: `lib/types.ts` (`SETTINGS_KEY` ~line 187, `UserSettings` ~line 195, `CAPABILITY` ~line 223, `roleCan` ~line 238)

**Interfaces:**
- Consumes: `FAMILY_ROLE`, `FamilyRole`, `ActingRole` (Plans 1–2).
- Produces: `SETTINGS_KEY.UploadFolderId`, `UserSettings.uploadFolderId: string | null`, `CAPABILITY.ManageFamily`, and a `roleCan` in which only `"owner"` holds `ManageFamily`.

- [ ] **Step 1: Add the settings key and the `UserSettings` field**

In `SETTINGS_KEY`, add the new key after `FamilyMembers`:

```ts
export const SETTINGS_KEY = {
  MyCardsLast4: "myCardsLast4",
  HouseholdSize: "householdSize",
  ReportTemplate: "reportTemplate",
  FamilyMembers: "familyMembers",
  UploadFolderId: "uploadFolderId",
} as const;
```

In `UserSettings`, add the field after `familyMembers`:

```ts
export interface UserSettings {
  myCardsLast4: string[]; // exactly 4-digit strings, validated
  householdSize: number | null; // 1..20; null = unset (fall back to DEFAULT_HOUSEHOLD_SIZE)
  reportTemplate: { id: string; name: string } | null; // null = built-in default template
  familyMembers: FamilyMember[]; // family-members registry (owner's account only)
  // The owner's "סומו - העלאות" folder id. Stored so a family member can put
  // uploads in the OWNER's folder — a Drive name search from the member's
  // account is ambiguous (both accounts have a folder with that name).
  uploadFolderId: string | null;
}
```

- [ ] **Step 2: Add the capability**

In `CAPABILITY`, add the new entry after `SettingsWrite`:

```ts
  SettingsWrite: "settings-write", // POST /api/settings
  ManageFamily: "manage-family", // POST/DELETE /api/family — owner only
} as const;
```

- [ ] **Step 3: Deny `ManageFamily` to every non-owner role**

`full` currently returns a blanket `true`. Replace that single line with an exhaustive switch, and add `ManageFamily` to the deny groups of the other two roles. The complete `roleCan` body after the change:

```ts
export function roleCan(role: ActingRole, cap: Capability): boolean {
  switch (role) {
    case "owner":
      return true;
    case FAMILY_ROLE.Full:
      switch (cap) {
        case CAPABILITY.ManageFamily:
          return false;
        case CAPABILITY.ViewReceipts:
        case CAPABILITY.AppendReceipts:
        case CAPABILITY.EditReceipts:
        case CAPABILITY.Maintain:
        case CAPABILITY.DriveBrowse:
        case CAPABILITY.ReportBuild:
        case CAPABILITY.ReportExport:
        case CAPABILITY.SettingsRead:
        case CAPABILITY.SettingsWrite:
          return true;
      }
      break;
    case FAMILY_ROLE.FullNoReport:
      switch (cap) {
        case CAPABILITY.ReportExport:
        case CAPABILITY.ManageFamily:
          return false;
        case CAPABILITY.ViewReceipts:
        case CAPABILITY.AppendReceipts:
        case CAPABILITY.EditReceipts:
        case CAPABILITY.Maintain:
        case CAPABILITY.DriveBrowse:
        case CAPABILITY.ReportBuild:
        case CAPABILITY.SettingsRead:
        case CAPABILITY.SettingsWrite:
          return true;
      }
      break;
    case FAMILY_ROLE.UploadView:
      switch (cap) {
        case CAPABILITY.ViewReceipts:
        case CAPABILITY.AppendReceipts:
          return true;
        case CAPABILITY.EditReceipts:
        case CAPABILITY.Maintain:
        case CAPABILITY.DriveBrowse:
        case CAPABILITY.ReportBuild:
        case CAPABILITY.ReportExport:
        case CAPABILITY.SettingsRead:
        case CAPABILITY.SettingsWrite:
        case CAPABILITY.ManageFamily:
          return false;
      }
      break;
  }
  // Unreachable — every case above returns; TypeScript needs the closer.
  return false;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: **FAILS** — and that is the point of this step. `lib/google.ts` and `app/api/settings/route.ts` build `UserSettings` object literals that now lack the required `uploadFolderId` property (`Property 'uploadFolderId' is missing in type ...`). Task 2 fixes exactly those sites. Record the list of reported files in the task report; do not "fix" them here by making the field optional.

Also run: `npm run lint`
Expected: no new warnings (only the accepted `UploadZone.tsx:138`).

- [ ] **Step 5: Commit** (orchestrator)

```bash
git add lib/types.ts
git commit -m "feat(family): add ManageFamily capability and uploadFolderId setting"
```

---

### Task 2: Settings persistence + Drive share/revoke helpers

**Files:**
- Modify: `lib/google.ts` (`getUserSettings` ~lines 1080–1137, `writeUserSettings` ~lines 1139–1166, new helpers appended near `ensureUploadFolder` ~line 767)
- Modify: `app/api/settings/route.ts:41-46`

**Interfaces:**
- Consumes: `SETTINGS_KEY.UploadFolderId`, `UserSettings.uploadFolderId` (Task 1); the module-local `driveClient(accessToken)` factory already used throughout `lib/google.ts`.
- Produces:
  - `shareFileWithEmail(accessToken: string, fileId: string, email: string, role: "writer" | "reader"): Promise<void>`
  - `revokeFileAccessByEmail(accessToken: string, fileId: string, email: string): Promise<void>`
  - `getUserSettings` now returns `uploadFolderId`; `writeUserSettings` now persists it.

- [ ] **Step 1: Read the new key in `getUserSettings`**

Add `uploadFolderId: null` to the `empty` object:

```ts
  const empty: UserSettings = {
    myCardsLast4: [],
    householdSize: null,
    reportTemplate: null,
    familyMembers: [],
    uploadFolderId: null,
  };
```

Add the parse branch inside the row loop, after the `SETTINGS_KEY.FamilyMembers` branch:

```ts
      if (key === SETTINGS_KEY.UploadFolderId) {
        // Drive file ids are opaque strings — store as-is, blank means unset.
        if (value) out.uploadFolderId = value;
      }
```

- [ ] **Step 2: Write the new key in `writeUserSettings`**

Add the row after the `familyMembers` row (note `writeUserSettings` clears `A2:B` first, so an omitted key is a deleted key):

```ts
  if (s.uploadFolderId) {
    rows.push([SETTINGS_KEY.UploadFolderId, s.uploadFolderId]);
  }
```

- [ ] **Step 3: Preserve `uploadFolderId` when the settings form saves**

`app/api/settings/route.ts` rewrites the whole key/value range and knows nothing about this key. In the `writeUserSettings` call at line 41, add the field alongside the existing `familyMembers` preservation:

```ts
    await writeUserSettings(token, spreadsheetId, {
      myCardsLast4,
      householdSize,
      reportTemplate,
      familyMembers: current.familyMembers,
      uploadFolderId: current.uploadFolderId,
    });
```

Update the comment above it so it stays true:

```ts
    // The settings form doesn't know about familyMembers or uploadFolderId —
    // preserve both across rewrites (writeUserSettings clears A2:B).
    // strict: a failed read must abort the save, otherwise a transient
    // Sheets error would silently wipe them.
```

- [ ] **Step 4: Add the Drive sharing helpers**

Append directly after `ensureUploadFolder` (before `ensureDriveFolder`):

```ts
// ============================================================================
// Family-member sharing. The owner's drive.file scope covers app-created
// files, which is exactly the set we share: the receipts spreadsheet, the
// upload folder, and (optionally) a custom report template the user picked.
// ============================================================================

// Grant `email` access to `fileId`. sendNotificationEmail=false: the owner
// tells the family member directly; a surprise Google email is noise.
export async function shareFileWithEmail(
  accessToken: string,
  fileId: string,
  email: string,
  role: "writer" | "reader",
): Promise<void> {
  const drive = driveClient(accessToken);
  await drive.permissions.create({
    fileId,
    sendNotificationEmail: false,
    requestBody: { type: "user", role, emailAddress: email },
    fields: "id",
  });
}

// Remove every user-permission on `fileId` that belongs to `email`.
// Idempotent: a no-op when no such permission exists, so it is safe to retry.
export async function revokeFileAccessByEmail(
  accessToken: string,
  fileId: string,
  email: string,
): Promise<void> {
  const drive = driveClient(accessToken);
  // emailAddress is not in the default field set — it must be requested.
  const res = await drive.permissions.list({
    fileId,
    fields: "permissions(id,emailAddress,type)",
    pageSize: 100,
  });
  const target = email.toLowerCase();
  for (const p of res.data.permissions ?? []) {
    if (p.type !== "user" || !p.id) continue;
    if ((p.emailAddress ?? "").toLowerCase() !== target) continue;
    await drive.permissions.delete({ fileId, permissionId: p.id });
  }
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: PASS — clean. Every `UserSettings` literal now has `uploadFolderId`. If any other file still errors, report it rather than guessing a fix.

Run: `npm run lint`
Expected: only the accepted `UploadZone.tsx:138` warning.

- [ ] **Step 6: Commit** (orchestrator)

```bash
git add lib/google.ts app/api/settings/route.ts
git commit -m "feat(family): persist uploadFolderId and add Drive share/revoke helpers"
```

---

### Task 3: Carry the owner's folder id through the acting context

**Files:**
- Modify: `lib/accounts.ts` (`ActiveAccountPayload` ~line 41, `ActingContext` ~line 54, `decodeActiveAccount` ~line 86, `verifyMembership` ~line 116, `listAvailableAccounts` ~line 132, `resolveActingContext` ~line 149, `peekActingRole` ~line 231)
- Modify: `app/api/accounts/switch/route.ts:26-47`

**Interfaces:**
- Consumes: `getUserSettings` returning `uploadFolderId` (Task 2).
- Produces:
  - `ActiveAccountPayload.uploadFolderId: string | null`
  - `ActingContext.uploadFolderId: string | null` (always `null` on a personal account)
  - `verifyMembership(...): Promise<{ role: FamilyRole; uploadFolderId: string | null } | null>` — **breaking change**, was `FamilyRole | null`
  - `peekActingAccount(): Promise<{ role: ActingRole; ownerEmail: string | null }>` — used by Task 6

- [ ] **Step 1: Extend the cookie payload and the acting context**

```ts
export interface ActiveAccountPayload {
  spreadsheetId: string;
  ownerEmail: string;
  role: FamilyRole;
  verifiedAt: number; // epoch ms of the last successful registry check
  // The OWNER's upload folder id, cached from the same registry read that
  // verifies membership. null = the owner has not registered one yet.
  uploadFolderId: string | null;
}
```

```ts
export interface ActingContext {
  token: string; // the signed-in user's own access token — always
  email: string; // signed-in user's email, lowercased
  spreadsheetId: string;
  role: ActingRole; // "owner" = acting on their personal account
  ownerEmail: string | null; // null when acting on the personal account
  uploadFolderId: string | null; // owner's upload folder; null on personal accounts
}
```

- [ ] **Step 2: Accept cookies minted before this field existed**

In `decodeActiveAccount`, the field must **not** be a rejection criterion — an existing signed-in member holds a cookie without it, and rejecting would silently drop them back to their personal account. Replace the `return p;` at the end of the `try` block with a normalizing return:

```ts
    if (typeof p.verifiedAt !== "number") return null;
    // Cookies minted before Plan 3 have no uploadFolderId — normalize to null
    // instead of rejecting, or every member would be bounced to personal.
    const raw = (p as { uploadFolderId?: unknown }).uploadFolderId;
    return {
      ...p,
      uploadFolderId: typeof raw === "string" && raw ? raw : null,
    };
```

- [ ] **Step 3: Return the folder id from `verifyMembership`**

```ts
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
```

- [ ] **Step 4: Update `listAvailableAccounts` for the new return shape**

`SharedAccountOption` is unchanged — the menu does not need the folder id.

```ts
  for (const f of files) {
    const m = await verifyMembership(token, f.id, email);
    if (m) out.push({ spreadsheetId: f.id, ownerEmail: f.ownerEmail, role: m.role });
  }
```

- [ ] **Step 5: Thread the folder id through `resolveActingContext`**

Three return sites change. Inside `if (payload) {`, the fresh-cookie branch:

```ts
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
```

The TTL-expired re-verification branch — note it also refreshes the cached folder id, which is how a member registered before Plan 3 self-heals once the owner adds anyone:

```ts
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
```

And the personal-account fallthrough at the end:

```ts
  return {
    token,
    email,
    spreadsheetId,
    role: "owner",
    ownerEmail: null,
    uploadFolderId: null,
  };
```

- [ ] **Step 6: Add `peekActingAccount`**

Replace the existing `peekActingRole` block with the pair below — same semantics, one extra field, still zero Google calls and zero cookie writes:

```ts
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
```

- [ ] **Step 7: Update the switch route for the new `verifyMembership` shape**

In `app/api/accounts/switch/route.ts`, replace lines 26–47:

```ts
    const membership = await verifyMembership(token, target, email);
    if (!membership) {
      return NextResponse.json(
        { error: "Not a member of this account" },
        { status: 403 },
      );
    }
    const ownerEmail = await getDriveFileOwnerEmail(token, target).catch(() => "");
    store.set(
      ACTIVE_ACCOUNT_COOKIE,
      encodeActiveAccount({
        spreadsheetId: target,
        ownerEmail,
        role: membership.role,
        uploadFolderId: membership.uploadFolderId,
        verifiedAt: Date.now(),
      }),
      ACTIVE_ACCOUNT_COOKIE_OPTIONS,
    );
    return NextResponse.json({
      ok: true,
      active: {
        kind: "shared",
        spreadsheetId: target,
        ownerEmail,
        role: membership.role,
      },
    });
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck`
Expected: PASS. If a route errors on `uploadFolderId` missing from an `ActingContext` literal, that route is constructing a context by hand — report it, do not patch around it.

Run: `npm run lint`
Expected: only the accepted `UploadZone.tsx:138` warning.

Run: `git grep -n "verifyMembership" -- lib app`
Expected: exactly three call sites — `lib/accounts.ts` (twice: `listAvailableAccounts`, `resolveActingContext`) and `app/api/accounts/switch/route.ts` — all using the object return.

- [ ] **Step 9: Commit** (orchestrator)

```bash
git add lib/accounts.ts app/api/accounts/switch/route.ts
git commit -m "feat(family): carry owner upload folder id through the acting context"
```

---

### Task 4: `/api/family` — owner-only membership management

**Files:**
- Create: `app/api/family/route.ts`

**Interfaces:**
- Consumes: `requireCapability`, `errorStatus` (Plan 2); `CAPABILITY.ManageFamily`, `FAMILY_ROLE_VALUES`, `FamilyRole` (Task 1); `getUserSettings`, `writeUserSettings`, `ensureUploadFolder`, `shareFileWithEmail`, `revokeFileAccessByEmail` (Task 2).
- Produces (Task 7 consumes this contract):
  - `POST` body `{ email: string; role: FamilyRole }` → `200 { ok: true, members: FamilyMember[], sharing: ShareResult[] }`
  - `DELETE` body `{ email: string }` → `200 { ok: true, members, sharing }` or `502 { error, members, sharing }`
  - `ShareResult = { target: "spreadsheet" | "uploadFolder" | "reportTemplate"; ok: boolean }`
  - `403 { error }` for any non-owner, `400 { error }` for bad input.

- [ ] **Step 1: Create the route**

Full file content:

```ts
import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import {
  ensureUploadFolder,
  getUserSettings,
  revokeFileAccessByEmail,
  shareFileWithEmail,
  writeUserSettings,
} from "@/lib/google";
import { CAPABILITY, FAMILY_ROLE_VALUES, type FamilyRole } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// Membership management. Owner-only via CAPABILITY.ManageFamily — the one
// capability a `full` member does not hold. Drive side effects are why this
// is a separate route from /api/settings.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ShareTarget = "spreadsheet" | "uploadFolder" | "reportTemplate";
interface ShareResult {
  target: ShareTarget;
  ok: boolean;
}

function parseEmail(body: { email?: unknown }): string {
  return typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
}

export async function POST(req: Request) {
  try {
    const ctx = await requireCapability(CAPABILITY.ManageFamily);
    const body = (await req.json()) as { email?: unknown; role?: unknown };
    const email = parseEmail(body);
    const role = body.role as FamilyRole;

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (!(FAMILY_ROLE_VALUES as string[]).includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (email === ctx.email) {
      return NextResponse.json(
        { error: "The account owner is not a family member" },
        { status: 400 },
      );
    }

    // strict: a transient read failure must abort — writeUserSettings clears
    // the whole range, so writing from an empty read would wipe the registry.
    const settings = await getUserSettings(ctx.token, ctx.spreadsheetId, {
      strict: true,
    });
    const existing = settings.familyMembers.find((m) => m.email === email);
    const members = existing
      ? settings.familyMembers.map((m) => (m.email === email ? { email, role } : m))
      : [...settings.familyMembers, { email, role }];

    // Role change only: Drive grants are identical across roles, so no
    // Drive calls at all.
    if (existing) {
      await writeUserSettings(ctx.token, ctx.spreadsheetId, {
        ...settings,
        familyMembers: members,
      });
      return NextResponse.json({ ok: true, members, sharing: [] });
    }

    // New member. Registry is written BEFORE sharing: an entry without a
    // share is a member who cannot reach the data, while a share without an
    // entry would be a dangling Drive grant.
    const uploadFolderId = await ensureUploadFolder(ctx.token);
    await writeUserSettings(ctx.token, ctx.spreadsheetId, {
      ...settings,
      familyMembers: members,
      uploadFolderId,
    });

    const targets: Array<{
      target: ShareTarget;
      fileId: string;
      role: "writer" | "reader";
    }> = [
      { target: "spreadsheet", fileId: ctx.spreadsheetId, role: "writer" },
      { target: "uploadFolder", fileId: uploadFolderId, role: "writer" },
    ];
    if (settings.reportTemplate) {
      // The built-in default template is already publicly readable.
      targets.push({
        target: "reportTemplate",
        fileId: settings.reportTemplate.id,
        role: "reader",
      });
    }

    const sharing: ShareResult[] = [];
    for (const t of targets) {
      try {
        await shareFileWithEmail(ctx.token, t.fileId, email, t.role);
        sharing.push({ target: t.target, ok: true });
      } catch {
        // Never log the email address (anonymity rule) — target name only.
        console.warn("Drive share failed:", t.target);
        sharing.push({ target: t.target, ok: false });
      }
    }

    return NextResponse.json({ ok: true, members, sharing });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireCapability(CAPABILITY.ManageFamily);
    const body = (await req.json()) as { email?: unknown };
    const email = parseEmail(body);
    if (!email) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const settings = await getUserSettings(ctx.token, ctx.spreadsheetId, {
      strict: true,
    });
    if (!settings.familyMembers.some((m) => m.email === email)) {
      // Already gone — idempotent success.
      return NextResponse.json({
        ok: true,
        members: settings.familyMembers,
        sharing: [],
      });
    }

    // Revoke FIRST, and keep the registry entry if any revoke fails: removing
    // the entry while a Drive grant survives would leave a dangling grant with
    // no way to reach it from the app. The owner retries the removal instead.
    const targets: Array<{ target: ShareTarget; fileId: string }> = [
      { target: "spreadsheet", fileId: ctx.spreadsheetId },
    ];
    if (settings.uploadFolderId) {
      targets.push({ target: "uploadFolder", fileId: settings.uploadFolderId });
    }
    if (settings.reportTemplate) {
      targets.push({ target: "reportTemplate", fileId: settings.reportTemplate.id });
    }

    const sharing: ShareResult[] = [];
    for (const t of targets) {
      try {
        await revokeFileAccessByEmail(ctx.token, t.fileId, email);
        sharing.push({ target: t.target, ok: true });
      } catch {
        console.warn("Drive revoke failed:", t.target);
        sharing.push({ target: t.target, ok: false });
      }
    }

    if (sharing.some((s) => !s.ok)) {
      return NextResponse.json(
        {
          error: "Some Drive permissions could not be revoked",
          members: settings.familyMembers,
          sharing,
        },
        { status: 502 },
      );
    }

    const members = settings.familyMembers.filter((m) => m.email !== email);
    await writeUserSettings(ctx.token, ctx.spreadsheetId, {
      ...settings,
      familyMembers: members,
    });
    return NextResponse.json({ ok: true, members, sharing });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: only the accepted `UploadZone.tsx:138` warning.

Confirm by reading the file back that **no `console` call includes `email`** — anonymity rule.

- [ ] **Step 3: Commit** (orchestrator)

```bash
git add app/api/family/route.ts
git commit -m "feat(family): owner-only /api/family with automatic Drive sharing"
```

---

### Task 5: Upload receipts into the owner's folder

**Files:**
- Modify: `app/api/ocr/route.ts` (context capture ~lines 155–170, Drive auto-upload ~lines 179–195)

**Interfaces:**
- Consumes: `ActingContext.uploadFolderId` and `ActingContext.ownerEmail` (Task 3).
- Produces: nothing new — behavior change only.

This is the Plan-1 bug: `ensureUploadFolder(token)` searches by folder name, and a member acting on a shared account sees two folders named `סומו - העלאות` (theirs and the owner's), so the image lands in the wrong Drive while the row goes to the owner's spreadsheet.

- [ ] **Step 1: Capture the acting context's folder fields**

Replace the context block at lines ~155–170:

```ts
    let token: string | null = null;
    let spreadsheetId: string | null = null;
    // Shared account => uploads must go to the OWNER's folder, carried in the
    // acting context. Personal account => ensure our own folder as before.
    let isSharedAccount = false;
    let ownerUploadFolderId: string | null = null;
    let knownStores: string[] = body.knownStores ?? [];
    try {
      const ctx = await requireCapability(CAPABILITY.AppendReceipts);
      token = ctx.token;
      spreadsheetId = ctx.spreadsheetId;
      isSharedAccount = ctx.ownerEmail !== null;
      ownerUploadFolderId = ctx.uploadFolderId;
      // Only read the stores tab if the client didn't supply it — cuts one
      // Sheets read per file during a batch.
      if (body.knownStores === undefined) {
        const stores = await getAllStores(token, spreadsheetId);
        knownStores = stores.map((s) => s.canonical);
      }
    } catch (e) {
      console.warn("Could not load spreadsheet context", e);
    }
```

- [ ] **Step 2: Resolve the folder per acting account**

Replace the Drive auto-upload block at lines ~179–195:

```ts
    // Auto-upload local files to Drive so they get a permanent link.
    // Honor a client-supplied folderId; otherwise the owner's folder on a
    // shared account, or our own "סומו - העלאות" on a personal one.
    if (body.kind === "upload" && token && originalBuffer) {
      try {
        const folderId =
          body.folderId ??
          (isSharedAccount ? ownerUploadFolderId : await ensureUploadFolder(token));
        if (!folderId) {
          // Shared account whose owner has no registered upload folder yet.
          // Deliberately NOT falling back to a name search: a file saved in
          // the member's own Drive gives the owner a broken link. The row is
          // still saved, just without an image. The next /api/family write
          // backfills the id and the next account switch repairs the cookie.
          console.warn("No upload folder for the active account — skipping Drive upload");
        } else {
          const uploaded = await uploadFileToDrive(
            token,
            folderId,
            fileName,
            originalBuffer,
            body.mediaType || "image/jpeg",
          );
          driveFileId = uploaded.id;
        }
      } catch (e) {
        console.warn("Drive auto-upload failed", e);
      }
    }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: only the accepted `UploadZone.tsx:138` warning.

Run: `git grep -n "ensureUploadFolder" -- app`
Expected: exactly one hit in `app/api/ocr/route.ts`, on the personal-account side of the ternary.

- [ ] **Step 4: Commit** (orchestrator)

```bash
git add app/api/ocr/route.ts
git commit -m "fix(family): upload receipt images to the owner's Drive folder"
```

---

### Task 6: Active-account chip in the header

**Files:**
- Create: `components/AccountChip.tsx`
- Modify: `components/UserMenu.tsx` (remove the local `roleLabel`, import it instead)
- Modify: `components/Header.tsx`

**Interfaces:**
- Consumes: `peekActingAccount` (Task 3); `FAMILY_ROLE`, `FamilyRole`, `ActingRole` (Plans 1–2); existing `Badge` primitive.
- Produces: `roleLabel(role: FamilyRole): string` and `<AccountChip ownerEmail={string} role={FamilyRole} className?={string} />`, both exported from `components/AccountChip.tsx`.

- [ ] **Step 1: Create the chip component**

`components/AccountChip.tsx` — no `"use client"` directive: it renders in the server-component header, and `UserMenu` (a client component) may still import `roleLabel` from it.

```tsx
import { Badge } from "./ui/badge";
import { FAMILY_ROLE, type FamilyRole } from "@/lib/types";

// Presentation-only role names (not domain values). Exhaustive switch — a
// new FAMILY_ROLE value must be handled here before this compiles.
export function roleLabel(role: FamilyRole): string {
  switch (role) {
    case FAMILY_ROLE.UploadView:
      return "העלאה וצפייה";
    case FAMILY_ROLE.Full:
      return "גישה מלאה";
    case FAMILY_ROLE.FullNoReport:
      return "מלאה ללא הפקת דוח";
  }
}

// Shown in the header whenever the user is acting on someone else's account.
// Nothing else in the UI distinguishes a shared account from a personal one.
export function AccountChip({
  ownerEmail,
  role,
  className,
}: {
  ownerEmail: string;
  role: FamilyRole;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={className}>
      <span className="truncate">{ownerEmail || "חשבון משותף"}</span>
      <span aria-hidden="true">·</span>
      <span className="whitespace-nowrap">{roleLabel(role)}</span>
    </Badge>
  );
}
```

- [ ] **Step 2: Point `UserMenu` at the shared label**

In `components/UserMenu.tsx`: delete the local `roleLabel` function (lines ~32–43), drop `FAMILY_ROLE` from the `@/lib/types` import (keep `type FamilyRole`), and add the import:

```tsx
import { type FamilyRole } from "@/lib/types";
import { roleLabel } from "./AccountChip";
```

Everything else in the file is unchanged — the JSX call `roleLabel(a.role)` still resolves.

- [ ] **Step 3: Render the chip in both header layouts**

In `components/Header.tsx`, replace the import and role lookup at the top:

```tsx
import { peekActingAccount } from "@/lib/accounts";
import { roleCan, CAPABILITY } from "@/lib/types";
import { AccountChip } from "./AccountChip";
```

```tsx
export default async function Header() {
  const session = await getServerSession(authOptions);
  const { role, ownerEmail } = await peekActingAccount();
  const showFullNav = roleCan(role, CAPABILITY.Maintain);
  // role === "owner" means the personal account — no chip at all there.
  const sharedRole = role === "owner" ? null : role;
```

In the **mobile** branch, insert the chip between the nav trigger and the logo. `min-w-0` lets the chip's `truncate` actually shrink instead of pushing the logo out:

```tsx
            <div className="flex md:hidden items-center justify-between w-full gap-2">
              <MobileNav email={session.user.email ?? ""} showFullNav={showFullNav} />
              {sharedRole && (
                <AccountChip
                  ownerEmail={ownerEmail ?? ""}
                  role={sharedRole}
                  className="min-w-0 max-w-[60%] gap-1"
                />
              )}
              <Link href="/" className="font-bold text-lg">סומו</Link>
            </div>
```

In the **desktop** branch, the chip replaces the signed-in email span (that email already heads the dropdown — showing two emails side by side is noise):

```tsx
              <div className="text-sm flex items-center gap-3">
                <ThemeToggle />
                {sharedRole ? (
                  <AccountChip
                    ownerEmail={ownerEmail ?? ""}
                    role={sharedRole}
                    className="max-w-[20rem] gap-1"
                  />
                ) : (
                  <span className="text-muted-foreground">
                    {session.user.email}
                  </span>
                )}
                <UserMenu email={session.user.email ?? ""} />
              </div>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: PASS. `sharedRole` narrows `ActingRole` to `FamilyRole` by excluding `"owner"`, which is what `AccountChip` requires — if it does not narrow, report it instead of casting.

Run: `npm run lint`
Expected: only the accepted `UploadZone.tsx:138` warning.

Run: `git grep -n "roleLabel" -- components`
Expected: the definition in `AccountChip.tsx` plus its uses — exactly one definition.

- [ ] **Step 5: Commit** (orchestrator)

```bash
git add components/AccountChip.tsx components/UserMenu.tsx components/Header.tsx
git commit -m "feat(family): show the active shared account in the header"
```

---

### Task 7: Family-members block in settings

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `components/SettingsForm.tsx`

**Interfaces:**
- Consumes: `/api/family` `POST`/`DELETE` contract (Task 4); `GET /api/settings`, which already returns the whole `UserSettings` including `familyMembers` (Task 2); `roleLabel` (Task 6); `peekActingRole` (Task 3).
- Produces: `<SettingsForm isOwner={boolean} />`.

- [ ] **Step 1: Pass ownership down from the page shell**

In `app/settings/page.tsx`, keep the existing session + capability gate and add the prop:

```tsx
  const role = await peekActingRole();
  if (!roleCan(role, CAPABILITY.SettingsRead)) redirect("/receipts");
```

```tsx
        <CardContent>
          <SettingsForm isOwner={role === "owner"} />
        </CardContent>
```

The prop is UX only — `/api/family` enforces ownership itself.

- [ ] **Step 2: Add the imports and types to `SettingsForm`**

Add to the existing imports at the top of `components/SettingsForm.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { roleLabel } from "./AccountChip";
import { FAMILY_ROLE, FAMILY_ROLE_VALUES, type FamilyMember, type FamilyRole } from "@/lib/types";
```

Extend the response type and add the family response type:

```tsx
interface SettingsResponse {
  myCardsLast4?: string[];
  householdSize?: number | null;
  reportTemplate?: { id: string; name: string } | null;
  familyMembers?: FamilyMember[];
  error?: string;
}

interface FamilyResponse {
  ok?: boolean;
  members?: FamilyMember[];
  sharing?: Array<{ target: string; ok: boolean }>;
  error?: string;
}
```

- [ ] **Step 3: Add the component signature and state**

```tsx
export function SettingsForm({ isOwner }: { isOwner: boolean }) {
```

Add after the existing `error` state declaration:

```tsx
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<FamilyRole>(FAMILY_ROLE.UploadView);
  const [familyBusy, setFamilyBusy] = useState(false);
```

In the existing load `useEffect`, after `setTemplate(...)`, seed the list:

```tsx
        setMembers(Array.isArray(json.familyMembers) ? json.familyMembers : []);
```

- [ ] **Step 4: Add the two handlers**

Place them after `changeTemplateAndSave`:

```tsx
  async function addMember() {
    const email = memberEmail.trim().toLowerCase();
    if (!email) return;
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: memberRole }),
      });
      const json = (await res.json()) as FamilyResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const known = members.some((m) => m.email === email);
      setMembers(json.members ?? []);
      setMemberEmail("");
      toast.success(known ? "ההרשאה עודכנה" : "בן המשפחה נוסף");
      if (json.sharing?.some((s) => !s.ok)) {
        toast.warning("חלק מהשיתופים ב-Drive נכשלו");
      }
    } catch {
      toast.error("הוספת בן המשפחה נכשלה");
    } finally {
      setFamilyBusy(false);
    }
  }

  async function removeMember(email: string) {
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as FamilyResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMembers(json.members ?? []);
      toast.success("בן המשפחה הוסר");
    } catch {
      toast.error("הסרת בן המשפחה נכשלה");
    } finally {
      setFamilyBusy(false);
    }
  }
```

- [ ] **Step 5: Render the block**

Insert this JSX inside the outer `<div className="space-y-6">`, after the report-template block and **before** the `{error && ...}` alert. It follows the same card-chips pattern as the cards block above it:

```tsx
      {isOwner && (
        <div className="space-y-3">
          <Label htmlFor="member-email" className="text-base font-semibold">
            בני משפחה
          </Label>
          <p className="text-sm text-muted-foreground">
            בני משפחה שהוספת יוכלו להיכנס עם חשבון Google שלהם ולעבוד על החשבון
            הזה לפי ההרשאה שתיתן.
          </p>

          {members.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {members.map((m) => (
                <li key={m.email}>
                  <Badge
                    variant="secondary"
                    className="border border-border bg-muted px-3 py-1 text-sm font-normal tracking-normal normal-case gap-1.5"
                  >
                    <span>{m.email}</span>
                    <span className="text-muted-foreground">
                      {roleLabel(m.role)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMember(m.email)}
                      disabled={familyBusy}
                      aria-label={`הסרה ${m.email}`}
                      className="text-muted-foreground hover:text-destructive leading-none disabled:opacity-50"
                    >
                      ×
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 items-start">
            <Input
              id="member-email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addMember(); }
              }}
              type="email"
              inputMode="email"
              placeholder="כתובת אימייל"
              disabled={familyBusy}
              className="flex-1"
            />
            <Select
              value={memberRole}
              onValueChange={(v) => setMemberRole(v as FamilyRole)}
              disabled={familyBusy}
            >
              <SelectTrigger className="w-44" aria-label="הרשאה">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FAMILY_ROLE_VALUES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={addMember}
              variant="outline"
              disabled={!memberEmail || familyBusy}
            >
              {familyBusy && <Loader2 className="animate-spin size-4 me-2" />}
              הוספה
            </Button>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: only the accepted `UploadZone.tsx:138` warning.

Confirm `components/ui/select.tsx` exports every name imported in Step 2 (`Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`). If any is missing, STOP and report — do not add a primitive or hand-roll a `<select>`.

- [ ] **Step 7: Commit** (orchestrator)

```bash
git add app/settings/page.tsx components/SettingsForm.tsx
git commit -m "feat(family): family-members management block in settings"
```

---

### Task 8: Batch gate

**Files:** none — verification only.

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: success. `app/api/family` appears in the route list; the page count is unchanged from Plan 2's 30 except for no new pages (only a new API route).

- [ ] **Step 2: Final typecheck + lint**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run lint`
Expected: only `UploadZone.tsx:138`.

- [ ] **Step 3: Grep audit**

Run: `git grep -n "ensureUploadFolder" -- app lib`
Expected: the definition in `lib/google.ts`, the personal-account branch in `app/api/ocr/route.ts`, and the new-member path in `app/api/family/route.ts`. No other caller.

Run: `git grep -rn "console.*email" -- app/api/family`
Expected: no matches (anonymity rule).

- [ ] **Step 4: Hand off to the user for E2E**

Report that the code is complete and list the E2E script from spec §10 verbatim (seven scenarios, two Google accounts). Flag explicitly that scenario 2 verifies `sendNotificationEmail: false` — **no Google notification email should arrive** — since that parameter could not be confirmed from the documentation and is the one runtime unknown in this plan.

Do **not** run `npm run dev` or attempt visual verification.
