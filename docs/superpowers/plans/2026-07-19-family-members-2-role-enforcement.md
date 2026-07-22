# Family Members — Plan 2: Role Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three family roles actually bind: `upload-view` can only upload + view, `full-no-report` can do everything except the two step-6 report actions, and every restriction is enforced server-side (403) with matching UI hiding.

**Architecture:** A pure capability model in `lib/types.ts` (`CAPABILITY` + `roleCan(role, cap)`, exhaustive switches). Server boundary: `requireCapability(cap)` in `lib/accounts.ts` wraps `resolveActingContext()` and throws `ForbiddenError` → routes return `403 { error }`. UI: page shells read the signed active-account cookie **synchronously** via `peekActingRole()` (HMAC-verified decode, zero Google calls, no cookie writes — safe in server components) and pass booleans down as props. UI hiding is UX only; the API is the enforcement boundary.

**Tech Stack:** Next.js 16 App Router (async `cookies()` read in server components), TypeScript strict, existing shadcn primitives (no new ones).

**Spec:** `docs/superpowers/specs/2026-07-17-family-members-design.md` §8.2, §10.3
**Branch:** `feat/family-members` — **Base commit:** `718a442`

## Global Constraints

- TypeScript strict; no `any` without an explaining comment.
- Exhaustive `switch` with no `default` over const enums — `roleCan` must be structured so adding a role or capability forces a typecheck error.
- No inline Hebrew **domain** literals outside `lib/types.ts`. Approved new Hebrew UI string for this plan: `הפקת הדוח זמינה לבעל החשבון בלבד`. API error strings are English. Any other new Hebrew string → STOP and ask.
- Quota frugality: enforcement must add **zero** extra Google API calls. `peekActingRole` is a pure cookie decode; `requireCapability` reuses the acting-context resolution the route already performed.
- `lib/google.ts` stays the only `googleapis` importer; `lib/accounts.ts` stays the only authorization module.
- **No test suite.** Per task: `npm run typecheck` + `npm run lint` (accepted pre-existing: UploadZone.tsx:138); `npm run build` once at the end. Runtime E2E handed to the user.
- **Implementers do NOT commit** — the orchestrator reviews the diff, runs typecheck, and commits with the message in each task's final step.

---

### Task 1: Capability model in `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (append to the Family members section added in Plan 1, after `FamilyMember`)

**Interfaces:**
- Consumes: `FAMILY_ROLE`, `FamilyRole` (Plan 1).
- Produces (later tasks import these exact names): `CAPABILITY` const enum, `Capability` type, `ActingRole` type alias, `roleCan(role: ActingRole, cap: Capability): boolean`.

- [ ] **Step 1: Append the capability model**

```ts
// A signed-in user acting on an account is either its owner or a family
// member with one of the FAMILY_ROLE values.
export type ActingRole = "owner" | FamilyRole;

export const CAPABILITY = {
  ViewReceipts: "view-receipts", // GET /api/sheets
  AppendReceipts: "append-receipts", // POST /api/sheets, /api/ocr, GET /api/scan-context
  EditReceipts: "edit-receipts", // PATCH /api/sheets + inline editing UI
  Maintain: "maintain", // dedup, fix-drive-ids, match, statements, /compare
  DriveBrowse: "drive-browse", // /api/drive* listing (DriveImport + pickers)
  ReportBuild: "report-build", // report wizard pipeline except export
  ReportExport: "report-export", // POST /api/report/generate + /api/report/pdf
  SettingsRead: "settings-read", // GET /api/settings + /settings page
  SettingsWrite: "settings-write", // POST /api/settings
} as const;
export type Capability = (typeof CAPABILITY)[keyof typeof CAPABILITY];

// The single authorization truth table. Exhaustive switches, no defaults —
// adding a role or a capability must break the build until handled here.
export function roleCan(role: ActingRole, cap: Capability): boolean {
  switch (role) {
    case "owner":
      return true;
    case FAMILY_ROLE.Full:
      return true;
    case FAMILY_ROLE.FullNoReport:
      switch (cap) {
        case CAPABILITY.ReportExport:
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
          return false;
      }
      break;
  }
  // Unreachable — every case above returns; TypeScript needs the closer.
  return false;
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` clean; `npm run lint` only the accepted warning.

- [ ] **Step 3: Orchestrator commits**

```bash
git add lib/types.ts
git commit -m "feat(family): capability model — roleCan truth table"
```

---

### Task 2: Enforcement + UI-peek helpers in `lib/accounts.ts`

**Files:**
- Modify: `lib/accounts.ts`

**Interfaces:**
- Consumes: Plan 1's `resolveActingContext`, `decodeActiveAccount`, `ACTIVE_ACCOUNT_COOKIE`; Task 1's `roleCan`, `Capability`, `ActingRole`.
- Produces: `ForbiddenError` class, `requireCapability(cap, opts?): Promise<ActingContext>`, `errorStatus(err: unknown): number`, `peekActingRole(): Promise<ActingRole>`, and a new `spreadsheet?: boolean` option on `resolveActingContext`.

- [ ] **Step 1: Extend `resolveActingContext` with a no-spreadsheet mode**

Change the signature and the personal-path fallback (the shared-cookie path already has the id for free):

```ts
export async function resolveActingContext(
  opts: { ensure?: boolean; spreadsheet?: boolean } = {},
): Promise<ActingContext> {
  const { ensure = true, spreadsheet = true } = opts;
```

and replace the final personal-path block with:

```ts
  // spreadsheet: false — caller only needs identity + role (token-only
  // routes). Skips the Drive lookup entirely; spreadsheetId must not be used.
  const spreadsheetId = !spreadsheet
    ? ""
    : ensure
      ? await ensureSpreadsheet(token)
      : await resolveSpreadsheetId(token);
  return { token, email, spreadsheetId, role: "owner", ownerEmail: null };
```

- [ ] **Step 2: Add the enforcement + peek helpers (append to the module)**

Add imports: `roleCan`, `type ActingRole`, `type Capability` from `./types`. Update the existing `ActingContext.role` type annotation to `ActingRole` (same union, now named).

```ts
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
```

- [ ] **Step 3: Verify** — `npm run typecheck` clean; lint only the accepted warning.

- [ ] **Step 4: Orchestrator commits**

```bash
git add lib/accounts.ts
git commit -m "feat(family): requireCapability, ForbiddenError, peekActingRole"
```

---

### Task 3: Gate the API routes

**Files (route → capability → resolution opts):**

| Route file | Handler | Capability | Opts |
| --- | --- | --- | --- |
| `app/api/sheets/route.ts` | GET | `ViewReceipts` | — |
| `app/api/sheets/route.ts` | POST | `AppendReceipts` | — |
| `app/api/sheets/route.ts` | PATCH | `EditReceipts` | — |
| `app/api/ocr/route.ts` | POST (the `resolveActingContext()` site, ~line 157) | `AppendReceipts` | — |
| `app/api/ocr/route.ts` | POST (the token-only `requireAccessToken()` site, ~line 106) | `AppendReceipts` | `{ spreadsheet: false }` |
| `app/api/scan-context/route.ts` | GET | `AppendReceipts` | — |
| `app/api/dedup/route.ts` | POST | `Maintain` | — |
| `app/api/fix-drive-ids/route.ts` | POST | `Maintain` | — |
| `app/api/match/route.ts` | POST | `Maintain` | — |
| `app/api/statements/route.ts` | POST | `Maintain` | `{ spreadsheet: false }` |
| `app/api/drive/route.ts` | GET | `DriveBrowse` | `{ spreadsheet: false }` |
| `app/api/drive/files/route.ts` | GET | `DriveBrowse` | `{ spreadsheet: false }` |
| `app/api/drive/folders/route.ts` | GET | `DriveBrowse` | `{ spreadsheet: false }` |
| `app/api/report/period/route.ts` | all handlers | `ReportBuild` | `{ spreadsheet: false }` |
| `app/api/report/process/route.ts` | POST | `ReportBuild` | `{ spreadsheet: false }` |
| `app/api/report/parse/route.ts` | POST | `ReportBuild` | `{ spreadsheet: false }` |
| `app/api/report/classify/route.ts` | POST | `ReportBuild` | `{ spreadsheet: false }` |
| `app/api/report/receipts/route.ts` | GET | `ReportBuild` | — |
| `app/api/report/progress/route.ts` | GET/POST/DELETE | `ReportBuild` | `{ ensure: false }` |
| `app/api/report/generate/route.ts` | POST | `ReportExport` | `{ ensure: false }` |
| `app/api/report/pdf/route.ts` | POST | `ReportExport` | `{ ensure: false }` |
| `app/api/settings/route.ts` | GET | `SettingsRead` | — |
| `app/api/settings/route.ts` | POST | `SettingsWrite` | — |

`/api/accounts` and `/api/accounts/switch` stay capability-free (any signed-in user).

- [ ] **Step 1: Apply the two mechanical patterns per row**

Pattern A — routes already on the acting context:

```ts
// before
const { token, spreadsheetId } = await resolveActingContext();
// after
const { token, spreadsheetId } = await requireCapability(CAPABILITY.ViewReceipts);
```

(keep the row's Opts as the second argument, e.g. `requireCapability(CAPABILITY.ReportExport, { ensure: false })`). Imports per file: `requireCapability` (+ `errorStatus`) from `@/lib/accounts`, `CAPABILITY` from `@/lib/types`; drop `resolveActingContext` from the import if no handler in the file still uses it.

Pattern B — token-only routes currently on `requireAccessToken()` (drive×3, report/period, report/process) and any handler with no auth call at all (`statements`, `report/parse`, `report/classify` — verify each file before editing):

```ts
// before (token-only)
const token = await requireAccessToken();
// after
const { token } = await requireCapability(CAPABILITY.DriveBrowse, { spreadsheet: false });

// before (no auth at all — parse/classify/statements, if so)
// (first line of the try block)
// after — add as the first line of the try block:
await requireCapability(CAPABILITY.ReportBuild, { spreadsheet: false });
```

Remove `requireAccessToken` from `@/lib/google` imports where it becomes unused.

**Every gated handler's catch** must map the status:

```ts
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
```

(Keep any richer existing catch logic — e.g. `describe(err)` in sheets — and change only the status argument.) The NDJSON-streaming `report/pdf` route: gate BEFORE the stream starts (first statement of the handler, outside the stream), so a 403 returns as a plain JSON response.

- [ ] **Step 2: Verify coverage**

Run: `grep -rn "resolveActingContext\|requireAccessToken" app/api`
Expected: **no matches at all** (accounts routes use `requireSessionIdentity`; every data route now goes through `requireCapability`). If any remain, they were missed.

Run: `grep -rln "requireCapability" app/api | wc -l` → expected **19** files.

- [ ] **Step 3: Verify** — `npm run typecheck` clean; lint only the accepted warning.

- [ ] **Step 4: Orchestrator commits**

```bash
git add app/api
git commit -m "feat(family): enforce role capabilities on all data routes"
```

---

### Task 4: Server-side page gates + nav filtering

**Files:**
- Modify: `app/compare/page.tsx`, `app/report/page.tsx`, `app/settings/page.tsx`, `app/upload/page.tsx`, `app/receipts/page.tsx`
- Modify: `components/Header.tsx`, `components/MobileNav.tsx`

**Interfaces:**
- Consumes: `peekActingRole` (Task 2), `roleCan`/`CAPABILITY` (Task 1).
- Produces: `ReceiptTable` receives `readOnly: boolean`; `ReportWizard` receives `canExport: boolean`; `MobileNav` receives `showFullNav: boolean` (Tasks 5-6 implement the component sides).

- [ ] **Step 1: Gate the three restricted pages**

In `app/compare/page.tsx`, `app/report/page.tsx`, `app/settings/page.tsx` — after the existing session gate (`if (!session) redirect("/");`) add:

```ts
  const role = await peekActingRole();
  if (!roleCan(role, CAPABILITY.Maintain)) redirect("/receipts");
```

with the capability per page: compare → `CAPABILITY.Maintain`, report → `CAPABILITY.ReportBuild`, settings → `CAPABILITY.SettingsRead`. Imports: `peekActingRole` from `@/lib/accounts`; `roleCan, CAPABILITY` from `@/lib/types`.

- [ ] **Step 2: Upload page — hide DriveImport for upload-view**

In `app/upload/page.tsx` (current layout: two Cards in a 2-col grid, lines 21-39): compute `const role = await peekActingRole();` and `const canDriveImport = roleCan(role, CAPABILITY.DriveBrowse);`, then wrap the second Card:

```tsx
        {canDriveImport && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ייבוא מתיקיית Google Drive</CardTitle>
            </CardHeader>
            <CardContent>
              <DriveImport />
            </CardContent>
          </Card>
        )}
```

(existing Hebrew strings unchanged). When hidden, the grid naturally collapses to one card.

- [ ] **Step 3: Receipts page — pass readOnly**

In `app/receipts/page.tsx`: `const role = await peekActingRole();` and render `<ReceiptTable readOnly={!roleCan(role, CAPABILITY.EditReceipts)} />`. Also make the subtitle honest: keep the existing subtitle only when editable, else the plain first sentence:

```tsx
        <p className="text-sm text-muted-foreground">
          {roleCan(role, CAPABILITY.EditReceipts)
            ? "טבלה מלאה. ניתן לערוך תאים inline; שינויים נשמרים אוטומטית ל-Google Sheets."
            : "טבלה מלאה."}
        </p>
```

(both strings already exist in the file — no new Hebrew).

- [ ] **Step 4: Report page — pass canExport**

In `app/report/page.tsx`: `<ReportWizard canExport={roleCan(role, CAPABILITY.ReportExport)} />` (reuse the `role` from Step 1's gate).

- [ ] **Step 5: Header + MobileNav nav filtering**

In `components/Header.tsx` (server component): `const role = await peekActingRole();` and `const showFullNav = roleCan(role, CAPABILITY.Maintain);`. In the desktop `<nav>` (lines 26-42), keep העלאה + קבלות always; wrap the השוואה, דוח דו-חודשי, הגדרות `<Link>`s in `{showFullNav && (<>...</>)}`. Pass `showFullNav={showFullNav}` to `<MobileNav />`.

In `components/MobileNav.tsx`: extend props to `{ email: string; showFullNav: boolean }` and wrap the same three links in `{showFullNav && (<>...</>)}`.

(Note: for the current roles, `Maintain`/`ReportBuild`/`SettingsRead` are all-or-nothing together, so one boolean is honest; the per-page gates in Step 1 remain per-capability.)

- [ ] **Step 6: Verify** — `npm run typecheck` clean (it will FAIL until Tasks 5-6 add the new props — coordinate: implementer of this task adds the props to `ReceiptTable`/`ReportWizard` signatures as part of THIS task only if executing tasks out of order is unavoidable; the intended order is 5 → 6 → 4, see Execution order note below).

- [ ] **Step 7: Orchestrator commits**

```bash
git add app/compare/page.tsx app/report/page.tsx app/settings/page.tsx app/upload/page.tsx app/receipts/page.tsx components/Header.tsx components/MobileNav.tsx
git commit -m "feat(family): role-gated pages and navigation"
```

**Execution order note:** run Task 5 (ReceiptTable prop) and Task 6 (ReportWizard prop) BEFORE Task 4 so every intermediate state typechecks. The orchestrator dispatches 5, 6, then 4.

---

### Task 5: ReceiptTable read-only mode

**Files:**
- Modify: `components/ReceiptTable.tsx`

**Interfaces:**
- Consumes: nothing new (pure prop).
- Produces: `export function ReceiptTable({ readOnly = false }: { readOnly?: boolean })` — Task 4 passes it.

Anchors (line numbers at base commit — match on code, not numbers):

- [ ] **Step 1: Add the prop** — change line 169 `export function ReceiptTable() {` to `export function ReceiptTable({ readOnly = false }: { readOnly?: boolean }) {`.

- [ ] **Step 2: Hard-guard `patch()`** (line ~211) — first line of the function body:

```ts
    if (readOnly) return; // UI guard; the API enforces with 403 anyway
```

- [ ] **Step 3: Desktop toolbar (lines ~436-469)** — wrap the two maintenance buttons (`runDedup` button, `runFixDriveIds` button), the two export buttons (`downloadCSV`, `downloadXLSX`), and the `פתח ב-Google Sheets` `<a>` in `{!readOnly && (<>...</>)}` (keep the search `Input` and the `<div className="flex-1" />` spacer outside the wrapper so layout holds).

- [ ] **Step 4: Mobile toolbar (lines ~482-522)** — wrap the entire `<DropdownMenu>…</DropdownMenu>` (the פעולות menu) in `{!readOnly && (...)}`. Keep the adjacent `<Sheet>` (filters) untouched.

- [ ] **Step 5: Desktop inline editors** — in the desktop table row render, add `disabled={readOnly}` to every cell editor that calls `patch(r.id, …)`: the storeName Input (~730), amount Input (~742), paymentMethod Select (~757), date Input (~780), category Select (~791), documentType Select (~806), reviewed Checkbox (~839). For `Select` components the prop goes on the `SelectTrigger`'s `Select` root (`disabled` is supported on the shadcn `Select` root); for `Checkbox` use its `disabled` prop.

- [ ] **Step 6: Mobile edit drawer** — the drawer edits via `patch(editing.id, …)` (lines ~994-1134). Do NOT touch the individual fields; instead find the affordance that opens the drawer (the call site that does `setEditing(r)` from a row tap — grep `setEditing(`) and guard it: `if (!readOnly) setEditing(r)` (or conditionally omit the onClick). The `patch()` hard-guard from Step 2 is the safety net.

- [ ] **Step 7: Verify** — `npm run typecheck` clean; lint only the accepted warning. Then grep sanity: `grep -n "readOnly" components/ReceiptTable.tsx` shows the prop, the patch guard, 2 toolbar wrappers, 7 disabled props, and the drawer guard.

- [ ] **Step 8: Orchestrator commits**

```bash
git add components/ReceiptTable.tsx
git commit -m "feat(family): read-only receipts table for upload-view role"
```

---

### Task 6: ReportWizard export gating

**Files:**
- Modify: `components/ReportWizard.tsx`

**Interfaces:**
- Produces: `export function ReportWizard({ canExport = true }: { canExport?: boolean })` — Task 4 passes it.

- [ ] **Step 1: Add the prop** — line ~297 `export function ReportWizard() {` → `export function ReportWizard({ canExport = true }: { canExport?: boolean }) {`.

- [ ] **Step 2: Gate the step-6 action row** (lines ~2688-2702). Replace the actions `<div className="flex items-center gap-3 flex-wrap">…</div>` content so both buttons render only when allowed, with a notice otherwise:

```tsx
                <div className="flex items-center gap-3 flex-wrap">
                  {canExport ? (
                    <>
                      <Button onClick={generateReport} disabled={generating}>
                        {generating ? "מפיק…" : generated !== null ? "הפק מחדש" : "הפק דוח"}
                      </Button>
                      {generated !== null ? (
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() => setPdfDialogOpen(true)}
                        >
                          נפק PDF
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      הפקת הדוח זמינה לבעל החשבון בלבד
                    </p>
                  )}
                </div>
```

(the only new Hebrew string is the approved notice; everything else is verbatim existing code moved inside the conditional).

- [ ] **Step 3: Verify** — `npm run typecheck` clean; lint only the accepted warning.

- [ ] **Step 4: Orchestrator commits**

```bash
git add components/ReportWizard.tsx
git commit -m "feat(family): hide report generate/export from full-no-report role"
```

---

### Task 7: Batch gate + E2E handoff

- [ ] **Step 1:** `npm run typecheck` clean; `npm run lint` only UploadZone.tsx:138; `npm run build` succeeds.

- [ ] **Step 2: Hand E2E to the user** (do NOT run the dev server). Setup: same two accounts as Plan 1; set the member's registry role per scenario (edit the `familyMembers` JSON in the owner's `הגדרות` tab), and note role changes take up to 10 minutes (cookie TTL) or immediately after switching accounts back and forth.

As member with `upload-view` on the shared account:
1. Nav shows only העלאה + קבלות (desktop + mobile); direct URLs `/compare`, `/report`, `/settings` redirect to `/receipts`.
2. Upload page shows only local upload (no Drive-import card); uploading works and lands in the owner's sheet.
3. Receipts table: no edit affordances (cells disabled, no mobile edit drawer), no dedup/fix buttons, no CSV/Excel export, no Sheets link, no mobile פעולות menu.
4. API enforcement: from DevTools, `fetch('/api/dedup', {method:'POST'})` returns **403**; `PATCH /api/sheets` returns **403**.
5. Personal account of the same member: everything unrestricted (role applies only to the shared account).

As member with `full-no-report`:
6. Everything works incl. /compare, /settings, report wizard steps 1-5; step 6 shows the notice instead of הפק דוח / נפק PDF; `POST /api/report/generate` from DevTools returns **403**.

As member with `full` + as owner:
7. No visible change from before this plan (all actions available, report export works).

Also re-verify the Plan-1 fix if not yet done: switching between "החשבון שלי" and the owner's account shows different data.
