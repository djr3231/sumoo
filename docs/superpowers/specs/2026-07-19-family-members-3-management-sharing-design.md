# Family Members — Plan 3: Management, Sharing, Indicator, Upload Folder

- **Date:** 2026-07-19
- **Branch:** `feat/family-members` (base commit `701bc17`)
- **Status:** Approved design; implementation plan follows in `docs/superpowers/plans/`
- **Parent spec:** `docs/superpowers/specs/2026-07-17-family-members-design.md` (§8.1, §9, §10.4)

This is an addendum, not a replacement. The 07-17 spec stays authoritative for the
access model, roles, cookie mechanics, and everything Plans 1–2 already delivered.
Where this document deviates from it, the deviation is called out explicitly in §7.

## 1. Scope

Plans 1 and 2 are code-complete and passed user E2E: account discovery, switching, the
signed active-account cookie, and full server-side role enforcement all work. What is
still missing is the ability for an **owner** to actually register a family member from
inside the app, and two gaps found along the way.

Plan 3 delivers four items:

1. **`POST` / `DELETE /api/family`** — owner-only membership management (parent spec §8.1).
2. **Automatic Drive sharing** on add/remove (parent spec §9).
3. **Active-account indicator** in the header — new, no prior spec.
4. **Upload-folder resolution on a shared account** — the known Plan-1 gap.

Item 1 is unusable without the settings UI that drives it, so the family-management
block in `SettingsForm.tsx` (parent spec §10.4) is part of this plan.

## 2. Authorization — a new capability

`roleCan()` in `lib/types.ts` currently returns a blanket `true` for `FAMILY_ROLE.Full`,
so there is no existing way to deny a `full` member an action. Membership management
must be owner-only (parent spec §3), so:

- Add `CAPABILITY.ManageFamily = "manage-family"`.
- Replace the blanket `case FAMILY_ROLE.Full: return true;` with an exhaustive `switch`
  over capabilities, mirroring the other role branches: `ManageFamily` → `false`,
  everything else → `true`.

This keeps `roleCan` the single authorization truth table and preserves the existing
property that adding a capability breaks the build until every role handles it. In
practice only `role === "owner"` passes `ManageFamily`.

## 3. `/api/family`

New route, gated by `requireCapability(CAPABILITY.ManageFamily)`, which also yields the
owner's `spreadsheetId` and token. `ForbiddenError` → 403 via the existing `errorStatus`.

### 3.1 `POST` — add member or change role

Body: `{ email: string, role: FamilyRole }`. Email is lowercased and must contain `@`;
role must be a `FAMILY_ROLE` value. The owner's own email is rejected.

Sequence:

1. **Strict** `getUserSettings(token, spreadsheetId, { strict: true })` — a transient read
   failure must never be treated as "no settings", which would wipe the registry
   (the bug fixed in `092b99b`).
2. `ensureUploadFolder(token)` → persist the id as `uploadFolderId` (see §5). This also
   backfills the key for accounts whose members were registered before Plan 3.
3. Write the updated settings (registry entry upserted by email + `uploadFolderId`) via
   `writeUserSettings`.
4. Share the owner's assets with the member's email (see §4).

Registry is written **before** sharing, per parent spec §9: a registry entry without a
share means a member who simply cannot reach the data, while a share without a registry
entry would be a dangling Drive grant.

**Role change** (email already in the registry) runs the same four steps. An earlier
version of this design skipped sharing on a role change, since Drive grants are identical
across roles — but that made a partially failed share unrepairable: the owner's natural
retry is to add the member again, and that path performed no Drive calls. Sharing is
idempotent (§4), so running it on every `POST` turns "add the member again" into the
repair action.

### 3.2 `DELETE` — remove member

Body: `{ email: string }`. Revokes access on the same asset set (§4), then removes the
entry from the registry with the same strict read-modify-write.

Revocation happens before the registry write here: the shorter the window in which a
removed member still holds Drive access, the better. A failed revoke leaves the entry in
place and is reported to the caller, so the owner can retry rather than end up with a
member who is invisible in the UI but still has file access.

### 3.3 Response shape

`{ ok: true, members: FamilyMember[], sharing: Array<{ target: string, ok: boolean }> }`.

On `POST`, a partial sharing failure does not fail the request: the registry write — the
part that governs in-app access — already succeeded, and the UI surfaces the partial
result as a warning toast (§6.3).

On `DELETE` the asymmetry in §3.2 applies: if any revoke fails, the registry entry is
**kept** and the response reports the failures, so the owner still sees the member in the
UI and can retry the removal. Removing the entry while a Drive grant survived would leave
a dangling grant with no way to reach it from the app.

## 4. Drive sharing mechanics

Two new helpers in `lib/google.ts` (the only `googleapis` importer):

- `ensureFileSharedWithEmail(token, fileId, email, role: "writer" | "reader")` —
  `permissions.list` (fields `permissions(id,emailAddress,type,role)`) to find an existing
  user permission for the email; none → `permissions.create` with
  `{ type: "user", role, emailAddress: email }`, `fields: "id"`,
  `sendNotificationEmail: false`; present with a different role →
  `permissions.update`; present with the same role → no-op. The lookup is not
  belt-and-braces: `permissions.create` is not the documented way to change an existing
  grantee's role, and idempotency is what makes a failed share repairable (§3.1).
- `revokeFileAccessByEmail(token, fileId, email)` — `permissions.list` with
  `fields: "permissions(id,emailAddress,type)"`, match `type === "user"` and a
  case-insensitive `emailAddress` match, then `permissions.delete`. A no-op when no
  matching permission exists (idempotent — safe to retry).

Verified against current Google Drive v3 documentation (context7,
`/websites/developers_google_workspace_drive`): the `permissions.create` /
`.list` / `.delete` shapes above are current, and the `drive.file` scope is usable with
all Drive API resources for files the app created — no new OAuth scope is needed.

`sendNotificationEmail: false` is a deliberate choice (the owner tells the family member
directly; a surprise Google email is noise). It is a valid Drive v3 parameter but did not
appear in the documentation pages returned by context7, so it is **flagged for runtime
verification during E2E**. If it misbehaves, the fallback is to drop the parameter and
accept the default notification email.

**Assets shared on add** (and revoked on remove):

| Asset | Drive role | Source of the id |
| --- | --- | --- |
| Receipts spreadsheet | `writer` | acting context (`spreadsheetId`) |
| Upload folder `סומו - העלאות` | `writer` | `ensureUploadFolder` (§3.1 step 2) |
| Custom report template | `reader` | `settings.reportTemplate.id`, when set |

`writer` on the spreadsheet is required even for `upload-view`, which appends rows.
The built-in default report template is already publicly readable and is never shared.

## 5. Upload folder on a shared account

**The bug (Plan-1 known gap):** `ensureUploadFolder(token)` searches Drive by folder name
only. A family member acting on a shared account may have two folders named
`סומו - העלאות` visible — their own and the owner's — so the receipt image lands
nondeterministically, often in the member's own Drive, while the row is written to the
owner's spreadsheet. The owner then gets a 403 on the image link.

**The fix — the owner's folder id becomes stored data, not a search result:**

- New `SETTINGS_KEY.UploadFolderId`; `UserSettings.uploadFolderId: string | null`
  (default `null`, written only when set — same pattern as `reportTemplate`).
- **Written by `/api/family` only** (§3.1 step 2). The upload hot path performs no extra
  reads or writes.
- **Carried to the member via the cookie:** `ActiveAccountPayload` gains
  `uploadFolderId: string | null`. `verifyMembership()` already calls `getUserSettings`
  on the owner's spreadsheet, so it returns the folder id alongside the role — at switch
  time and at every TTL re-verification. **Zero additional Google calls.**
  `verifyMembership`'s return type changes from `FamilyRole | null` to
  `{ role: FamilyRole; uploadFolderId: string | null } | null`.
- `ActingContext` gains `uploadFolderId: string | null` (always `null` for personal
  accounts, which keep calling `ensureUploadFolder`).
- `app/api/ocr/route.ts` (the only caller, line ~183): personal → `ensureUploadFolder(token)`
  as today; shared → `ctx.uploadFolderId`. The name-based search never runs on a shared
  account again.

**Edge case — shared account whose cookie has no `uploadFolderId`** (a member registered
before Plan 3, not yet backfilled): skip the Drive upload, keep the receipt row, log a
warning. This falls inside the `try/catch` that already wraps the Drive auto-upload, so
the failure mode is a receipt without an image link. Deliberately **not** falling back to
`ensureUploadFolder`: a file saved in the wrong Drive is worse than a missing link,
because the owner sees a broken link and cannot fix it. Any subsequent `/api/family`
write backfills the key and the next account switch repairs the cookie.

Note: a `full` member who picks a folder explicitly through `DriveImport` still browses
their **own** Drive (`body.folderId`). That is part of the deferred Drive-scope work
(§8), not this fix.

## 6. UI

### 6.1 Active-account indicator (new)

Today nothing in the UI distinguishes acting on a personal account from acting on a
shared one — a real data-safety gap, since the two look identical while writing to
different spreadsheets.

**Data source:** new `peekActingAccount(): Promise<{ role: ActingRole; ownerEmail: string | null }>`
in `lib/accounts.ts` — decodes the signed cookie only: no Google call, no cookie write
(illegal in server components). The existing `peekActingRole()` becomes a thin wrapper
over it, so current callers are untouched.

**Desktop** (`Header.tsx`): when the account is shared, the `<span>` showing the
signed-in email is **replaced** by `Badge variant="secondary"` reading
`{ownerEmail} · {roleLabel}`. Two emails side by side would be noise, and the signed-in
email already heads the dropdown. On a personal account the header is byte-identical to
today.

**Mobile** (`Header.tsx` mobile branch): a compact badge between the hamburger and the
logo, with `truncate` and a max width so a long owner email cannot push the logo out.

**Shared label source:** the exhaustive `roleLabel` switch currently living inside
`UserMenu.tsx` moves to a new `components/AccountChip.tsx`, which exports both the chip
component and `roleLabel`; `UserMenu` imports it from there. One source of truth for the
Hebrew role names.

`Badge` is an existing project primitive. No new color, radius, font, or custom CSS —
DESIGN-SYSTEM.md rules hold.

### 6.2 Approved Hebrew strings

Presentation-only, no new domain strings:

- Role names — reused verbatim from `UserMenu.tsx`: `העלאה וצפייה`, `גישה מלאה`,
  `מלאה ללא הפקת דוח`.
- Settings block: `בני משפחה`, `כתובת אימייל`, `הרשאה`, `הוספה`, `הסרה`.
- Toasts: `בן המשפחה נוסף`, `בן המשפחה הוסר`, `ההרשאה עודכנה`,
  `הוספת בן המשפחה נכשלה`, `חלק מהשיתופים ב-Drive נכשלו`.

Any string not on this list is a STOP-and-ASK.

### 6.3 Settings — family management block (parent spec §10.4)

New block in `SettingsForm.tsx`, rendered only when the acting context is the owner's
personal account. The `isOwner` flag is computed server-side in the page shell and passed
as a prop — the same pattern as `canExport` in Plan 2. Server-side enforcement remains
`/api/family` itself; the prop is UX only.

Contents, following the existing card-chips pattern in that file: email `Input` + role
`Select` + add button, and the member list as chips (email + role badge + remove ×).
Success → refresh the settings data. `sharing` entries with `ok: false` → warning toast.

## 7. Deviations from the parent spec (approved)

1. **The report root folder is not shared.** Parent spec §9 lists it. There is no stored
   id for it — it is located by name on each report run — so sharing it would require
   exactly the kind of fragile name search this plan removes. It moves to Plan 4 together
   with the rest of the report path (§8).
2. **`sendNotificationEmail: false`** — an addition to §9, flagged for runtime
   verification (§4).

## 8. Out of scope (recorded, not lost)

- **Report path on a shared account** — report folder tree and the template picker still
  act on the member's own Drive (`report/period`, `report/process`, `drive*` routes).
  Deferred to Plan 4 by explicit user decision; the report feature is in production and
  touching it deserves its own plan.
- **Stale report-template grants.** `DELETE` revokes the template currently configured.
  If the owner switched templates after adding the member, the member keeps a `reader`
  grant on the previous template file forever, invisible to the app. Fixing it properly
  means recording the actually-shared file ids per member — a registry shape change.
  Deferred to Plan 4 with the rest of the report/template path (user decision,
  2026-07-19). Risk is low: a template is an empty structural file shared read-only.
- Pagination in `listSharedSumooFiles` (pageSize 10).
- Cross-checking `active` against `shared[]` in `GET /api/accounts`.
- Invitation/acceptance emails; multi-owner accounts (parent spec §12).

## 9. Known race (accepted)

`POST /api/settings` and `POST /api/family` both read-modify-write the `הגדרות` tab —
last-write-wins on the whole key/value range. Both use the strict read and preserve each
other's fields, and the exposure window is two users saving settings within the same few
seconds on the same account. Accepted; recorded in the Minor list rather than solved with
locking, which the Sheets-as-database model does not support.

## 10. Verification

Per project rules: `npm run typecheck` + `npm run lint` (accepted pre-existing warning
`UploadZone.tsx:138`) per task, `npm run build` at batch end. Runtime/visual E2E is handed
to the user and needs two real Google accounts:

1. Owner opens settings → the family block appears; a member added with a role shows as a
   chip, and a `familyMembers` row plus an `uploadFolderId` row appear in `הגדרות`.
2. The member's Drive shows the shared spreadsheet and upload folder — **and no Google
   notification email arrives** (verifies `sendNotificationEmail: false`).
3. Member signs in and switches to the owner's account → the header shows the chip with
   the owner's email and role; on the personal account there is no chip.
4. Member uploads a receipt → the row lands in the owner's spreadsheet **and the image
   lands in the owner's upload folder**, with a link the owner can open.
5. Owner changes the member's role → no new Drive shares; the member's effective
   permissions change within the cookie TTL.
6. Owner removes the member → the shared items disappear from the member's Drive and the
   account leaves their switcher menu.
7. A `full` member does not see the family-management block, and a direct `POST
   /api/family` from that account returns 403.
