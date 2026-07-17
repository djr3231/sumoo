# Family Members — Design Spec

- **Date:** 2026-07-17
- **Branch:** `feat/family-members` (off `dev`)
- **Status:** Approved design; implementation plans follow in `docs/superpowers/plans/`

## 1. Problem & Goal

Sumoo is strictly single-user today: whoever signs in with Google operates on their own
Drive/Sheets via their own OAuth token. There is no server-side identity (the NextAuth
session callback keeps only `accessToken` and drops the email), no roles, and no notion
of "which account am I working on". The only sharing mechanism is the
`SUMOO_SPREADSHEET_ID` env hack — pinning every signed-in user to one spreadsheet and
relying on manual Drive sharing.

**Goal:** an account owner registers family members (by Google email) with a permission
level. A family member signs in with their **own** Google account, chooses which account
to operate on via a new user menu in the header, and works on the owner's data within
their permission level. Every user can simultaneously manage their personal account and
be a member of other accounts.

## 2. Chosen model — automatic Drive sharing ("Model B")

The member always operates with **their own OAuth token**. When the owner registers a
member, the app shares the owner's app-created Drive assets with the member's email via
the Drive permissions API. In-app roles restrict what the member can do through the app.

Rejected alternative (recorded for history): "system acts as the owner" via an
owner refresh token stored in env vars. Rejected because it limits the deployment to a
single family and requires storing long-lived owner credentials.

**Acknowledged trade-off:** a member has Drive-level access to the shared files outside
the app (e.g. opening the spreadsheet directly in Google Sheets). Role enforcement is an
application-level control, not a data-level one. Acceptable for the family trust model.

## 3. Decisions locked with the user

| Topic | Decision |
| --- | --- |
| Access model | Model B — automatic Drive sharing; member uses own token |
| Permission levels | 3 levels (see §4) |
| Lowest level scope | Upload + view only — no editing, no dedup, no compare, no report, no settings, no export |
| `full-no-report` scope | Entire report wizard usable **except** the two step-6 actions (הפק דוח, נפק PDF) |
| Family list management | Owner only (even `full` members cannot manage members) |
| Default account on sign-in | Remember last choice (persistent cookie); switch via header user menu |
| Personal accounts | Keep working exactly as today, for everyone |

## 4. Roles

New const enum in `lib/types.ts` (standard project pattern — `as const` + derived type +
`_VALUES`). Values are internal English strings; Hebrew names are presentation-only.

```ts
export const FAMILY_ROLE = {
  UploadView: "upload-view",   // upload receipts + view receipts list
  Full: "full",                // everything the owner can do (except managing members)
  FullNoReport: "full-no-report", // everything except generating/exporting the report
} as const;
```

The implicit fourth role is **owner** — the signed-in user operating on their personal
account. Owner is not stored in the registry; it is derived (`activeAccount.kind === "personal"`).

## 5. Data model

### 5.1 Membership registry

Stored in the **owner's** spreadsheet, `הגדרות` tab, as a new key/value row — same
mechanism as existing settings (`valueInputOption: "RAW"`, JSON value):

- New `SETTINGS_KEY.familyMembers`, value: `FamilyMember[]` serialized JSON.
- `FamilyMember = { email: string; role: FamilyRole }` (email lowercased on write).
- `UserSettings` gains `familyMembers: FamilyMember[]` (default `[]`).

### 5.2 Active account

```ts
type ActiveAccount =
  | { kind: "personal" }
  | { kind: "shared"; spreadsheetId: string; ownerEmail: string; role: FamilyRole };
```

Persisted in a signed httpOnly cookie (HMAC using `NEXTAUTH_SECRET`), which doubles as
the "remember last choice" mechanism. Cookie payload includes `verifiedAt`; entries older
than ~10 minutes are re-verified against the owner's registry before use (quota-friendly:
no +1 Sheets read per request against the 60 req/min quota).

## 6. Identity in the session (`lib/auth.ts`)

Persist `email` from the Google profile into the JWT on sign-in and expose it on the
session next to `accessToken`. This is a prerequisite for everything else — today the
session carries no identity at all.

## 7. New service module — `lib/accounts.ts`

Single responsibility: account discovery, membership verification, acting-context
resolution. Depends on `lib/google.ts` + `lib/types.ts`.

- **`listAvailableAccounts(token, myEmail)`** — returns personal + shared accounts:
  Drive search for files named `Receipts – sumoo` with `sharedWithMe = true` (covered by
  the member's existing `drive.readonly` scope), read each candidate's `familyMembers`
  setting (readable — the sheet is shared with the member), include the account iff
  `myEmail` appears in the registry. Owner email comes from the Drive file `owners`
  field. Called on sign-in and when opening the account menu — never per data request.
- **`resolveActingContext()`** — the new front door for API routes, replacing direct
  `requireAccessToken()` + `ensureSpreadsheet()`:
  - Reads session (token + email) + active-account cookie.
  - `personal` → today's behavior (own token, own/ensured spreadsheet), role = owner.
  - `shared` → verify cookie signature/TTL (re-verify registry on expiry), return
    `{ token, spreadsheetId, role, ownerEmail }`. All Google calls still use the
    **member's** token.
  - No/invalid cookie → `personal`.

## 8. API surface

### 8.1 New routes

| Route | Purpose | Access |
| --- | --- | --- |
| `GET /api/accounts` | List available accounts for the menu | any signed-in user |
| `POST /api/accounts/switch` | Body `{ target: "personal" \| spreadsheetId }`; verifies membership, sets signed cookie | any signed-in user |
| `POST /api/family` | Add/update member `{ email, role }`: write registry + Drive shares | owner, personal account only |
| `DELETE /api/family` | Remove member: revoke shares + update registry | owner, personal account only |

`/api/family` is a separate route (not folded into `/api/settings`) because it has Drive
side effects beyond settings persistence.

### 8.2 Permission matrix (server-side enforcement)

`resolveActingContext()` returns the role; every route checks it. UI hiding is UX only —
the API is the enforcement boundary. `403 { error }` on violation.

| Role | Allowed |
| --- | --- |
| owner | everything |
| `full` | everything except `/api/family` writes |
| `full-no-report` | everything `full` has except `POST /api/report/generate` and `POST /api/report/pdf` |
| `upload-view` | `GET /api/sheets`, `POST /api/sheets` (append), `POST /api/ocr`, `GET /api/scan-context`, `GET /api/accounts`, `POST /api/accounts/switch` — nothing else (no PATCH, no dedup/match/statements/fix-drive-ids/settings/report/drive listing beyond what upload needs) |

## 9. Sharing mechanics (owner side)

New helpers in `lib/google.ts` (the only `googleapis` importer):
`shareFileWithEmail(token, fileId, email, role)` and
`revokeFileAccessByEmail(token, fileId, email)` using Drive
`permissions.create` / `permissions.list` / `permissions.delete`.
The owner's `drive.file` scope covers sharing app-created files (exact semantics to be
verified against current googleapis docs via context7 during implementation-plan
writing).

**On add member:** write registry, then share:
- spreadsheet → `writer` (even `upload-view` appends rows),
- upload folder `סומו - העלאות` → `writer`,
- report root folder (if it exists) → `writer`,
- custom report template file (if `reportTemplate` set) → `reader`
  (the default template is already publicly readable).

**On remove member:** revoke on the same set, update registry.
**On role change:** registry only — Drive grants are identical across roles.

Failure handling: sharing is a multi-step Drive operation; the route reports per-file
results in its JSON response and the registry is written **first** (a member with a
registry entry but a failed share simply cannot access data; a share without a registry
entry would be a dangling grant — avoided by ordering).

## 10. UI

### 10.1 Header user menu (new)

Today the header shows a bare email `<span>` + sign-out button (desktop) and the same in
`MobileNav`'s sheet footer; there is no user icon/menu. Replace both with a user menu
built on the existing `components/ui/dropdown-menu.tsx` primitive (already used in
`ReceiptTable`):

- Trigger: ghost icon button (existing `Button variant="ghost" size="icon"` pattern).
- Content: signed-in email (label), account list as `DropdownMenuRadioGroup` —
  "החשבון שלי" + one item per shared account (owner email + role caption) — separator,
  sign out.
- Switching calls `POST /api/accounts/switch` then refreshes data (router refresh).

### 10.2 Account context for client components

A provider (wired in `Providers.tsx`) exposing `{ activeAccount, role }` from
`GET /api/accounts`; client components read it to gate actions.

### 10.3 Role gating

- **`upload-view`:** nav shows only העלאה + קבלות; `/compare`, `/report`, `/settings`
  page shells redirect server-side (extending the existing binary session gate);
  `ReceiptTable` renders read-only — no inline edit (desktop table **and** mobile edit
  drawer), no dedup / fix-drive-ids buttons, no CSV/XLSX export, no "פתח ב-Google
  Sheets" link — covering **both** the desktop toolbar and the mobile actions
  `DropdownMenu` render paths. On the upload page, only local upload (`UploadZone`) is
  available — `DriveImport` (and the Drive folder/file pickers backing it) is hidden,
  and the corresponding `/api/drive*` routes stay blocked for this role.
- **`full-no-report`:** only the two step-6 actions in `ReportWizard.tsx` are
  hidden/disabled — the הפק דוח button and the נפק PDF dialog trigger (~lines
  2690/2697). The rest of the wizard (steps 1–5, classification, editing) stays usable.
- **`full`:** UI identical to owner except the family-management section.

### 10.4 Settings — family members section

New block in `SettingsForm.tsx`, rendered only when the acting context is the owner's
personal account. Mirrors the existing card-chips pattern: email input + role select +
member chips (email + role badge + remove ×). Calls `/api/family`. All new Hebrew UI
labels are presentation-only strings; any new domain string goes to `lib/types.ts`.

## 11. Security notes

- The API layer is the enforcement boundary; UI gating is convenience.
- Membership claims in the cookie are HMAC-signed and TTL-bound; tampering or staleness
  forces re-verification against the owner's registry.
- A removed member loses Drive access (revoke) *and* fails re-verification at most
  ~10 minutes later even with a stale cookie.
- Registry emails are matched case-insensitively against the session email.
- No personal details enter code, logs, or report progress (existing anonymity rule).

## 12. Out of scope

- Retiring `SUMOO_SPREADSHEET_ID` pinning (this feature supersedes it; owner's call later).
- Invitation emails / acceptance flow — registration by the owner is immediate.
- Per-member data visibility (a member sees the whole account's data per their role).
- Multi-owner accounts.

## 13. Verification

Per project rules: `npm run typecheck` + `npm run lint` (accepted pre-existing warning
`UploadZone.tsx:138`) per task, `npm run build` at batch end. Runtime/visual E2E is
handed to the user (requires two real Google accounts):

1. Owner adds member email with a role → member's Drive shows shared items; registry row
   appears in `הגדרות`.
2. Member signs in → user menu lists the owner's account → switch → data loads from the
   owner's spreadsheet.
3. Member uploads a receipt → row lands in the owner's sheet, file in the owner's upload
   folder.
4. Role limits hold: `upload-view` gets read-only UI + 403 on blocked APIs;
   `full-no-report` sees step 6 without הפק דוח / נפק PDF and gets 403 on those routes.
5. Last-choice memory: reload → still on the chosen account.
6. Owner removes member → member loses Drive access and the account disappears from the
   menu (≤ cookie TTL).
