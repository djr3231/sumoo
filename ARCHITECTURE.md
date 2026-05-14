# Sumoo — Architecture

> **This is the source of truth.** When Claude is working on this codebase, every architectural decision should be consistent with this document. If the code contradicts this document, fix the code or update this document — whichever reflects the right answer. SESSION-CONTEXT.md captures recent history; ARCHITECTURE.md captures the timeless design.

---

## 1. Architectural principles

These are the non-negotiable rules. Every change should respect them.

### 1.1 The user's spreadsheet is the database

There is no app-owned database. Every user's data lives in their own Google Sheets file (`Receipts – sumoo`) under their own Google Drive. The app holds no persistent state between requests.

**Consequences:**
- All state-changing operations write to Sheets/Drive on the same request that triggers them. There is no write-behind queue.
- Read-modify-write must be done in a single API call where possible (e.g., `bulkUpdateReceipts` does one read for the id-column, one batch update for the changes).
- The user can edit their spreadsheet directly between sessions — the app must be tolerant of unexpected row shapes, missing columns, and reordering. `rowToReceipt` defends against this with `??` fallbacks.
- Backup, version history, and access control are delegated to Google.
- Multi-device "sync" comes free: any device that authenticates as the same user sees the same spreadsheet.

### 1.2 No magic strings — single source of truth for enums

Every Hebrew label, every internal enum value, every sheet tab name, every column header is declared **once** in `lib/types.ts` as a `const` assertion with a derived TypeScript type. Call sites import the constant — they never inline the literal.

**Why:** Hebrew strings are typo-prone, IDE refactoring is impossible on raw literals, and the typecheck-time `keyof typeof` derivation catches missing-case errors in switch statements.

The **only** allowed places for inline Hebrew literals:
1. `lib/types.ts` itself (the source declarations).
2. `lib/ai.ts` — Gemini prompt text. The prompts are model instructions, not application code, and they necessarily contain natural language.
3. UI strings that are pure presentation (button labels, page titles, error messages) — these are not domain values and don't need to round-trip through the type system.

If you find a literal like `"קבלה"`, `"אשראי"`, `"לא ידוע"`, etc. anywhere except (1) or (2), it's a bug.

### 1.3 Exhaustive switches enforce evolution safety

Any function that maps from a const-enum input to an output must be a `switch` statement (no default), so adding a new enum value forces a typecheck error until the function is updated. The canonical example is `classifyMethod` in `app/api/ocr/route.ts`.

### 1.4 OCR is the only source of truth for receipt content

Gemini's job is to **read** what's printed on the image — not to infer, recognize, or remember. The prompt enforces this aggressively: store names, totals, dates, and card last-4s must come from text the model can visually see. If the model can't read a field, it returns `null` rather than guessing.

**Corollary:** Anti-hallucination rules are part of the architecture, not optimizations. Loosening them invites bad data.

### 1.5 Server-side only for credentials

`GOOGLE_AI_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_CLIENT_SECRET`, and the user's access token never leave the server. The access token is stored in an httpOnly JWT cookie (NextAuth). The browser only ever talks to `/api/*` routes on the same origin.

---

## 2. System topology

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (RTL Hebrew UI, Next.js App Router client components)      │
│   ├─ /upload         drag-drop + DriveImport                       │
│   ├─ /receipts       ReceiptTable (filter/edit/dedup/export)       │
│   ├─ /compare        bank-txn reconciliation                       │
│   └─ /settings       card-list editor                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ fetch /api/...
┌──────────────────────────▼──────────────────────────────────────────┐
│ Next.js API routes (Node runtime, runs on Vercel)                  │
│   /api/auth/*    NextAuth Google OAuth                             │
│   /api/sheets    GET/POST/PATCH receipts                           │
│   /api/ocr       POST: image/PDF → Receipt[]                       │
│   /api/dedup     POST: canonicalize + dedup pipeline               │
│   /api/drive     GET: list folder contents                         │
│   /api/settings  GET/POST: user settings                           │
│   /api/match     POST: bank-txn ↔ receipt matching                 │
│   /api/statements POST: parse CSV/XLSX                             │
│   /api/fix-drive-ids POST: repair driveFileId column               │
└──────────┬─────────────────────────┬────────────────────┬───────────┘
           │                         │                    │
           ▼                         ▼                    ▼
┌─────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ Gemini AI           │  │ Google Drive API   │  │ Google Sheets API  │
│ - 2.5 Pro (OCR)     │  │ - search           │  │ - read/write rows  │
│ - 2.5 Flash (dedup) │  │ - download files   │  │ - tab management   │
└─────────────────────┘  │ - upload files     │  │ - formatting       │
                         └────────────────────┘  └────────────────────┘
                         ┌────────────────────┐
                         │ Places API (New)   │  (optional)
                         │ - Text Search      │
                         └────────────────────┘
```

**Runtime:** All API routes use `export const runtime = "nodejs"` (some need `sharp`, all need the Google client library). No edge runtime.

---

## 3. Module boundaries

The codebase is split into three layers. **Do not cross layers in the wrong direction.**

### Layer 1: `lib/types.ts` — domain types

Pure declarations: enums, type aliases, interfaces, sheet schema constants. No I/O. No dependencies on other `lib/*` modules. Every other module imports from here.

**Rule:** Adding a new domain concept (a new payment method, a new sheet tab, a new column) starts here. The rest of the codebase follows.

### Layer 2: `lib/{google,ai,places,parsers,match,utils,auth}.ts` — services

Each module owns one external integration or one piece of business logic. They depend on `lib/types.ts` and on each other only where necessary.

| Module        | Responsibility                                                    | Allowed dependencies         |
| ------------- | ----------------------------------------------------------------- | ---------------------------- |
| `auth.ts`     | NextAuth config, Google OAuth scopes, token refresh               | `next-auth`, `next-auth/providers/google` |
| `google.ts`   | All Drive + Sheets calls. The only file that imports `googleapis` | `googleapis`, `lib/types`    |
| `ai.ts`       | All Gemini calls + prompts + JSON schemas                         | `@google/generative-ai`, `lib/types` |
| `places.ts`   | Google Places (New) Text Search wrapper                           | `fetch`, `lib/types`         |
| `parsers.ts`  | CSV/XLSX bank statement parsing                                   | `xlsx`, `lib/types`          |
| `match.ts`    | Bank-txn ↔ receipt matching algorithm                             | `lib/types`                  |
| `utils.ts`    | Pure helpers (formatILS, formatDate, cn, chunk, pMapLimit)        | `clsx`, `tailwind-merge`     |

**Rules:**
- API routes import services. Services do not import API routes.
- Components import services only via API routes (`fetch('/api/...')`). Components never call `lib/google.ts` etc. directly — Google credentials are server-side only.
- Don't add a new file under `lib/` unless it owns a distinct responsibility. Cross-cutting helpers go in `utils.ts`.

### Layer 3: `app/` — routes and pages

API routes (`app/api/*/route.ts`) orchestrate services. They handle HTTP concerns (parsing JSON, status codes, error envelopes) and authentication. They do not contain business logic — that belongs in `lib/`.

Page routes (`app/*/page.tsx`) are auth gates plus shells. They redirect unauthenticated users to `/` and render a client component (`<ReceiptTable />`, `<SettingsForm />`, etc.).

Client components (`components/*.tsx`) are stateful UI. They fetch from `/api/*` and never directly touch the Google APIs.

---

## 4. Data model

### 4.1 Sheet tabs (per user, in their own spreadsheet)

| Constant               | Hebrew tab | Contents                          |
| ---------------------- | ---------- | --------------------------------- |
| `SHEET_TAB_RECEIPTS`   | `קבלות`    | One row per receipt line          |
| `SHEET_TAB_TXNS`       | `תנועות`   | Bank/CC transaction history       |
| `SHEET_TAB_STORES`     | `חנויות`   | Canonical store names + variants  |
| `SHEET_TAB_SETTINGS`   | `הגדרות`   | Key/value user settings           |

All tabs are RTL (`rightToLeft: true`), first row is frozen and bold, with `setBasicFilter` applied.

### 4.2 Receipt schema — 15 columns

The `RECEIPT_HEADERS` array in `lib/types.ts` defines the column order. The `Receipt` TypeScript interface defines the in-memory shape. The mapping between them lives in `receiptToRow` / `rowToReceipt` in `lib/google.ts`.

**Critical invariants:**
- Column A is always the UUID. `appendReceipts` is gap-sensitive (Google Sheets' `values.append` skips past trailing empty rows in column A). Never write a row without an id in A.
- Mixed payments produce N linked rows: the first row holds the canonical id, the others have `linkedTo = primaryId`.
- `totalReceiptAmount` is the receipt's grand total. `amount` is this line's portion (equal to total for single-payment receipts).
- `driveFileId` (column M) is the only link back to the original image. Without it, the "view image" button doesn't work — but the row is still valid data.

### 4.3 Settings schema

The `הגדרות` tab is key/value. Each row is `[key, value]`. Currently:

| Key            | Value format                            |
| -------------- | --------------------------------------- |
| `myCardsLast4` | Comma-separated 4-digit strings         |

**Writes use `valueInputOption: "RAW"`** to prevent Sheets from interpreting `"6021,8780,5323"` as a number with thousand-separators. This is a load-bearing decision — do not switch back to `USER_ENTERED`.

To add a new setting, add a key to `SETTINGS_KEY` in `lib/types.ts`, extend `UserSettings`, and extend the read/write helpers in `lib/google.ts`.

### 4.4 Type system

All enums are declared as:

```ts
export const X = { Foo: "foo", Bar: "bar" } as const;
export type X = (typeof X)[keyof typeof X];   // "foo" | "bar"
export const X_VALUES: X[] = Object.values(X);
```

This pattern gives:
- A namespace for constants (`X.Foo`).
- A discriminated string union type (`X = "foo" | "bar"`).
- An iterable list for UI dropdowns (`X_VALUES`).

Schemas sent to Gemini are built from `Object.values(X)` so they stay in sync — never hardcode the enum values in two places.

---

## 5. API contracts

Every endpoint returns JSON. Errors return `{ error: string }` with an HTTP error code.

### `GET /api/sheets`
- Auth: required.
- Side effects: ensures the user's spreadsheet exists (creates if missing).
- Returns: `{ spreadsheetId: string, receipts: Receipt[] }`.

### `POST /api/sheets`
- Auth: required.
- Body: `{ receipts: Receipt[] }`.
- Side effect: appends rows.
- Returns: `{ ok: true, spreadsheetId }`.

### `PATCH /api/sheets`
- Auth: required.
- Body: `Partial<Receipt> & { id: string }`.
- Side effect: updates only the supplied fields by id.
- Returns: `{ ok: true }`.

### `POST /api/ocr`
- Auth: required.
- Body (one of):
  - `{ kind: "upload", fileName, mediaType, base64 }`
  - `{ kind: "drive", driveFileId, fileName, mediaType }`
- Side effects:
  - Calls Gemini 2.5 Pro to extract receipt fields.
  - For `kind: "upload"`, uploads original to user's Drive folder.
  - Increments store-count in `חנויות` tab.
  - Does NOT write the receipt — the client does that via `POST /api/sheets`.
- Returns: `{ ok: true, receipts: Receipt[] }`. Multiple receipts only when the receipt has mixed payment methods (one row per payment).
- Error semantics: `429` for rate limit, `503` for overload, `500` for other errors.

### `POST /api/dedup`
- Auth: required.
- Side effects: runs canonicalization + duplicate detection + Places resolution, writes patches via `bulkUpdateReceipts`.
- Returns: `{ ok: true, dupCount, slipCount, placesResolutions, placesChanges }`.

### `GET /api/drive?folderId=...`
- Auth: required.
- Returns: `{ files: DriveFile[] }`.

### `GET /api/settings`
- Auth: required.
- Returns: `{ myCardsLast4: string[] }`.

### `POST /api/settings`
- Auth: required.
- Body: `{ myCardsLast4: string[] }`. Server validates each entry against `/^\d{4}$/`.
- Returns: `{ ok: true }`.

### `POST /api/match`
- Auth: required.
- Body: `{ txns: BankTxn[] }`.
- Returns: `{ matches: MatchResult[] }`.

### `POST /api/statements`
- Auth: required.
- Body: form-data with the CSV/XLSX file.
- Returns: `{ txns: BankTxn[] }`.

### `POST /api/fix-drive-ids`
- Auth: required.
- Side effect: searches Drive by `fileName` for each receipt, rewrites `driveFileId` if different.
- Returns: `{ ok: true, fixed, alreadyCorrect, notFound, notFoundFiles }`.

---

## 6. Authentication & authorization

### 6.1 OAuth scopes (`lib/auth.ts`)

```
openid, email, profile,
https://www.googleapis.com/auth/drive.readonly  ← list files in user's Drive
https://www.googleapis.com/auth/drive.file      ← create/modify files THIS APP created
https://www.googleapis.com/auth/spreadsheets    ← read/write spreadsheets
```

We deliberately use `drive.file` (per-app) rather than `drive` (full Drive write) for the principle of least privilege. The spreadsheet is created by the app, so `drive.file` is enough for it. `drive.readonly` is needed because users can paste a Drive folder URL containing files the app didn't upload, and we need to read those.

### 6.2 Session

JWT-only. The access token + refresh token live in the JWT. `getServerSession` extracts them server-side; the access token is also exposed on `session.accessToken` for the rare case a client component needs to know it (currently unused — keep it server-side).

### 6.3 Token refresh

`auth.ts` refreshes proactively when the JWT callback runs and `expiresAt` is within 60s of now. If refresh fails, the next API call will hit a 401 from Google and the user must sign in again.

`requireAccessToken()` in `lib/google.ts` is the only authorized way to get a token in an API route. It throws if no session — never call `getServerSession` directly.

### 6.4 Per-spreadsheet authorization

If `SUMOO_SPREADSHEET_ID` env var is set, **all** users hitting the deployment share that one spreadsheet. This is intentional for the personal-use deployment (chewie.ceo) where the owner wants both family members to see the same data. If unset, each user gets their own.

Sharing the env-var-pinned spreadsheet between Google accounts requires manually adding both accounts as editors on the spreadsheet (Google Drive Share UI). The app does not manage this.

---

## 7. Conventions

### 7.1 Hebrew strings in code

- Domain values (categories, document types, payment methods, etc.): **always** import from `lib/types.ts`.
- UI labels (button text, page headings, placeholder text): inline is fine — they're not domain values.
- Prompt text (`lib/ai.ts` only): inline Hebrew is necessary and expected.

### 7.2 Numbers and currency

`formatILS(n)` in `lib/utils.ts` is the only place that formats Israeli Shekels. Don't hand-format with `.toFixed(2) + " ₪"` elsewhere.

### 7.3 Dates

ISO `YYYY-MM-DD` is the wire and storage format. `formatDate(iso)` in `lib/utils.ts` is the only place that converts to display format. Israeli display format is `DD/MM/YYYY`.

### 7.4 Error responses from API routes

```ts
return NextResponse.json({ error: msg }, { status: 500 });
```

Never throw inside an exported route handler — always wrap in try/catch and return a JSON error envelope. Status codes:
- 400 — bad input (validation failed).
- 401 — no session.
- 429 — Gemini rate limit (also handled by retry in `withRetry`).
- 503 — Gemini overload.
- 500 — anything else.

### 7.5 Retries

External calls that can transiently fail (Gemini, Places) go through `withRetry` (`lib/ai.ts`) or equivalent. Two attempts, 3s backoff, only on retryable error patterns (503/429/"overloaded"). Don't retry forever — the user-facing flow surfaces overload with a "pause + resume" UI.

### 7.6 Concurrency

The `DriveImport` component caps bulk OCR concurrency at 2 (`CONCURRENCY = 2`). This is calibrated against Gemini quota for the free tier. Don't raise without proven quota headroom — overloading produces 429s that cascade into halted batches.

### 7.7 Type imports

Use `import type` for type-only imports:

```ts
import type { Receipt, PaymentMethod } from "@/lib/types";
import { PAYMENT_METHOD, type ExtractedMethod } from "@/lib/types";  // mixed is OK
```

This keeps the bundle clean and lets the TypeScript compiler erase type imports.

---

## 8. Anti-patterns (do not do these)

### 8.1 Inline Hebrew domain values
```ts
// ❌
if (r.documentType === "כפילות") { ... }
const fallback = r.storeName ?? "לא ידוע";

// ✅
if (r.documentType === DOCUMENT_TYPE.Duplicate) { ... }
const fallback = r.storeName ?? DEFAULT_STORE_NAME;
```

### 8.2 Reaching past the API boundary from a component
```ts
// ❌
import { google } from "googleapis";
// in a component...

// ✅
const res = await fetch("/api/sheets");
```

### 8.3 `valueInputOption: "USER_ENTERED"` for string values that look like numbers
```ts
// ❌  Sheets parses "6021,8780,5323" as 6,021,878,805,323
valueInputOption: "USER_ENTERED",
values: [[key, list.join(",")]],

// ✅
valueInputOption: "RAW",
values: [[key, list.join(",")]],
```

### 8.4 `default:` in a switch over a const enum
```ts
// ❌  Adding a new EXTRACTED_METHOD value silently falls through
switch (method) {
  case EXTRACTED_METHOD.Cash: return PAYMENT_METHOD.Cash;
  default: return PAYMENT_METHOD.Other;
}

// ✅  Adding a new value forces a typecheck error
switch (method) {
  case EXTRACTED_METHOD.Cash: return PAYMENT_METHOD.Cash;
  case EXTRACTED_METHOD.StandingOrder: return PAYMENT_METHOD.StandingOrder;
  case EXTRACTED_METHOD.Other: return PAYMENT_METHOD.Other;
  case EXTRACTED_METHOD.CreditCard: { ... }
}
```

### 8.5 Manual row-editing without a UUID
The user's spreadsheet sometimes has rows the user added manually. If column A (UUID) is empty, `values.append` will skip past that row and write to the wrong location. When debugging "rows appearing in row 1000", check for gaps in column A.

### 8.6 Calling `getServerSession` directly in an API route
```ts
// ❌  Bypasses requireAccessToken's error contract
const session = await getServerSession(authOptions);
const token = (session as any).accessToken;

// ✅
const token = await requireAccessToken();
```

### 8.7 Inventing categories or payment methods
Gemini is instructed to return one of the fixed `CATEGORIES` and one of the `EXTRACTED_METHOD` values. If you find the model returning something else, fix the prompt — don't widen the schema. Hedging the type system to "accept whatever comes back" defeats the point.

---

## 9. External dependencies and how to handle them

### 9.1 Gemini (Google Generative AI)

- **Models in use:** `gemini-2.5-pro` (OCR), `gemini-2.5-flash` (canonicalization + dedup).
- **Failure modes:** 503 (overload), 429 (rate limit), schema-mismatch JSON.
- **Mitigations:** `withRetry` (2 attempts, 3s backoff). `DriveImport` halts the batch after 3 consecutive overloads and lets the user resume manually.
- **Schema discipline:** Every Gemini call uses `responseMimeType: "application/json"` + `responseSchema`. The schema's `enum` arrays are built from `Object.values(SOME_ENUM)` so the type system enforces consistency.

### 9.2 Google Sheets API

- **Failure modes:** 401 (token expired), 403 (no access — usually the user revoked OAuth), 429 (rate limit), 400 (schema error like `setBasicFilter` overlapping a Table).
- **Mitigations:** Token refresh in NextAuth callback. `applyTabFormatting` isolates the `setBasicFilter` call so Table-overlap errors don't break the rest of the formatting.
- **Gotcha:** `values.append` is gap-sensitive. Always fill column A.

### 9.3 Google Drive API

- **Failure modes:** 404 (file deleted or no access), 401 (token expired).
- **Mitigations:** `/api/fix-drive-ids` is a recovery tool when `driveFileId`s diverge from `fileName`s.

### 9.4 Google Places (New) API

- **Optional dependency.** If `GOOGLE_PLACES_API_KEY` is not set, the dedup pipeline runs without Places verification — store-name canonicalization falls back to LLM-only.
- **API key restrictions:** `Application restrictions: None`, `API restrictions: Places API (New)` only. Server-side requests have no `Referer` header, so HTTP-referrer restrictions break the integration.

### 9.5 `sharp`

- **Used in:** `app/api/ocr/route.ts:shrinkImage`.
- **Why:** EXIF-aware rotate + resize before sending to Gemini. Smaller images = fewer Gemini tokens.
- **Failure modes:** Throws on unsupported formats. We catch and fall through to sending the original (logged as warning).

---

## 10. Deployment

- **Platform:** Vercel.
- **Custom domain:** `chewie.ceo` (production).
- **Branch strategy:** All work happens on feature branches off `main`. Preview deploys go up automatically.
- **Env vars:** Set in Vercel project settings — they must match `.env.local.example` keys.
- **Build:** `next build`. `npm run typecheck` is the first thing that should pass.

---

## 11. Where to add new things

| You want to…                              | Touch these files in order                                  |
| ----------------------------------------- | ----------------------------------------------------------- |
| Add a new payment method                  | `lib/types.ts` (both `EXTRACTED_METHOD` and `PAYMENT_METHOD`) → `lib/ai.ts` (add prompt bullet) → `app/api/ocr/route.ts` (add `case` to `classifyMethod`) |
| Add a new category                        | `lib/types.ts` (`CATEGORIES`) → `lib/ai.ts` (extend the category section of `RECEIPT_SYSTEM`) — that's all, schema picks it up |
| Add a new column to the receipts tab      | `lib/types.ts` (`RECEIPT_HEADERS` + `Receipt`) → `lib/google.ts` (`receiptToRow` + `rowToReceipt`) → `components/ReceiptTable.tsx` (column def) → backfill `lib/ai.ts` if Gemini needs to extract it |
| Add a new setting (key/value)             | `lib/types.ts` (`SETTINGS_KEY` + extend `UserSettings`) → `lib/google.ts` (`getUserSettings` / `writeUserSettings`) → `app/api/settings/route.ts` (validation) → `components/SettingsForm.tsx` (UI) |
| Add a new sheet tab                       | `lib/types.ts` (`SHEET_TAB_*` constant) → `lib/google.ts` (`tabsFromMeta` + `ensureTabs` + new read/write helpers + add to spreadsheet creation) |
| Add a new API route                       | `app/api/<route>/route.ts` — must use `requireAccessToken` for auth, return JSON, set `runtime = "nodejs"` |
| Add a new external service                | `lib/<service>.ts` — wrap all calls, no global state, return typed results |

---

## 12. Reference: file map

| Path                                  | Purpose                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| `app/layout.tsx`                      | Root layout, RTL, Hebrew, Header + NextAuth Providers           |
| `app/page.tsx`                        | Landing / sign-in                                                |
| `app/upload/page.tsx`                 | Upload page shell                                                |
| `app/receipts/page.tsx`               | Main table page shell                                            |
| `app/compare/page.tsx`                | Bank reconciliation page shell                                   |
| `app/settings/page.tsx`               | Settings page shell                                              |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth handler                                                 |
| `app/api/sheets/route.ts`             | Receipts CRUD                                                    |
| `app/api/ocr/route.ts`                | Single-file OCR + classification                                 |
| `app/api/dedup/route.ts`              | Dedup + canonicalization                                         |
| `app/api/drive/route.ts`              | List Drive folder                                                |
| `app/api/settings/route.ts`           | User settings CRUD                                               |
| `app/api/match/route.ts`              | Bank-txn matching                                                |
| `app/api/statements/route.ts`         | Statement parsing                                                |
| `app/api/fix-drive-ids/route.ts`      | Driveold-id recovery                                             |
| `components/Header.tsx`               | Top nav                                                          |
| `components/UploadZone.tsx`           | Drag-drop uploader                                               |
| `components/DriveImport.tsx`          | Bulk Drive folder import                                         |
| `components/ReceiptTable.tsx`         | Main table (filter, edit, dedup, export)                         |
| `components/CompareView.tsx`          | Reconciliation UI                                                |
| `components/SettingsForm.tsx`         | Card-list editor                                                 |
| `components/SignInButton.tsx`         | Auth UI                                                          |
| `components/SignOutButton.tsx`        | Auth UI                                                          |
| `components/Providers.tsx`            | SessionProvider wrapper                                          |
| `components/ui/Button.tsx`            | Shared button                                                    |
| `lib/types.ts`                        | All enums + interfaces + sheet schema                            |
| `lib/auth.ts`                         | NextAuth config + scopes                                         |
| `lib/google.ts`                       | Drive + Sheets calls (single integration point)                  |
| `lib/ai.ts`                           | Gemini calls + prompts + schemas                                 |
| `lib/places.ts`                       | Places (New) wrapper                                             |
| `lib/match.ts`                        | Bank-txn ↔ receipt matching                                      |
| `lib/parsers.ts`                      | CSV/XLSX parsing                                                 |
| `lib/utils.ts`                        | Pure helpers                                                     |
| `public/manifest.json`                | PWA manifest                                                     |
| `public/icons/`                       | PWA icons (192, 512)                                             |
| `SESSION-CONTEXT.md`                  | Handoff document for fresh sessions                              |
| `ARCHITECTURE.md`                     | This file — source of truth for design                           |
