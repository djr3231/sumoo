# Sumoo – Session Context Handoff

> **Purpose of this file:** Provide a fresh Claude Code session with rich context about the codebase, recent decisions, open threads, and domain knowledge needed to continue work effectively. Read this file end-to-end before making changes.

---

## Product mission

**Sumoo** (Hebrew: סומו) is a personal receipt-scanner web app for Israeli households. The owner photographs/scans paper receipts in Hebrew, the app OCR's them with Gemini, classifies into a fixed list of household-budget categories, and writes each receipt as a row in the user's own Google Sheet. A second flow ingests bank/credit-card statements (CSV/Excel) and reconciles them against the scanned receipts.

**Why:** The owner needs receipts categorized in a specific budgeting framework (number-of-people-in-household food category, court-mandated expense categories, etc.) and reconciled against bank transactions. Existing apps don't fit Hebrew + this exact category list + the reconciliation step.

**Hosting:** Deployed at **https://www.chewie.ceo** (custom domain, Vercel).

---

## Tech stack

- **Framework:** Next.js 16.2.4 with App Router (Server Components + API routes)
- **Auth:** NextAuth (Google OAuth, JWT-based session storing accessToken only)
- **AI / OCR:** Google Generative AI SDK (`@google/generative-ai`), using:
  - `gemini-2.5-pro` for receipt extraction (`OCR_MODEL`)
  - `gemini-2.5-flash` for utility tasks like canonicalization and dedup (`UTIL_MODEL`)
- **Storage:** Each user's data lives in **their own Google Sheets spreadsheet** named `"Receipts – sumoo"`, auto-created on first login under their Drive. No app-owned database.
- **Drive integration:** Receipt photos are stored in a per-user `"Receipts – sumoo (uploads)"` Drive folder; the spreadsheet stores a `driveFileId` per receipt so the table can render a "View image" link.
- **Image processing:** `sharp` for resize + EXIF-aware rotation before sending to Gemini.
- **Optional:** Google Places API (New) used by the dedup pipeline to canonicalize OCR'd store names against real businesses.
- **TypeScript:** Strict. `npm run typecheck` must pass (`tsc --noEmit`).
- **Styling:** Tailwind v4, HSL CSS variables (`--background`, `--foreground`, `--border`, `--primary`, etc.), RTL by default (`<html lang="he" dir="rtl">`).

---

## Repository structure

```
sumoo/
├── app/
│   ├── layout.tsx              # Root layout (RTL, Hebrew, Header + Providers)
│   ├── page.tsx                # Landing (sign in)
│   ├── upload/                 # Receipt upload page (drag-drop + Drive import)
│   ├── receipts/               # Main table view (filter, edit, dedup, export)
│   ├── compare/                # Bank/CC reconciliation
│   ├── settings/page.tsx       # Card last-4 list editor (NEW – Nov 2025)
│   └── api/
│       ├── auth/[...nextauth]  # NextAuth Google OAuth
│       ├── ocr/route.ts        # POST: extract receipt fields from image/PDF
│       ├── sheets/route.ts     # GET/POST/PATCH: receipts CRUD
│       ├── dedup/route.ts      # POST: run canonicalization + duplicate detection
│       ├── drive/route.ts      # GET: list files in a Drive folder
│       ├── fix-drive-ids/      # POST: repair broken driveFileId column by filename search
│       ├── match/route.ts      # Match bank txns ↔ receipts
│       ├── statements/         # Parse CSV/Excel bank statements
│       └── settings/route.ts   # GET/POST: user settings (card list)
├── components/
│   ├── Header.tsx              # Top nav (העלאה / קבלות / השוואה / הגדרות)
│   ├── UploadZone.tsx          # Drag-drop multi-file uploader
│   ├── DriveImport.tsx         # Bulk import from a Drive folder with skip-existing
│   ├── ReceiptTable.tsx        # Main table: inline edit, filter, dedup, CSV/XLSX export
│   ├── CompareView.tsx         # Bank-statement reconciliation UI
│   ├── SettingsForm.tsx        # Chip-style card last-4 editor (NEW)
│   └── ui/Button.tsx           # Shared button component
├── lib/
│   ├── types.ts                # SINGLE SOURCE OF TRUTH for enums + sheet schema
│   ├── auth.ts                 # NextAuth config (Google scopes for Drive + Sheets)
│   ├── google.ts               # All Drive + Sheets API calls (≈650 lines)
│   ├── ai.ts                   # All Gemini calls (OCR, canonicalization, dedup)
│   ├── places.ts               # Google Places (New) Text Search wrapper
│   ├── match.ts                # Bank-txn ↔ receipt matching logic
│   ├── parsers.ts              # CSV/Excel statement parsers (per-bank)
│   └── utils.ts                # formatDate, formatILS, cn (clsx), etc.
├── public/
│   ├── manifest.json           # PWA manifest
│   └── icons/                  # icon-192.png, icon-512.png (generated; SVG-based)
└── .env.local.example          # Env var template (NO secrets)
```

---

## Data model

### Sheet tabs (each user's `Receipts – sumoo` spreadsheet)

All four tabs are RTL. Headers are in row 1, bold + light-gray background, with a frozen header row and `setBasicFilter` (auto-filter) applied. Tab names are **constants** in `lib/types.ts` — never inline.

| Tab name (Hebrew) | Constant            | Purpose                                                    |
| ----------------- | ------------------- | ---------------------------------------------------------- |
| `קבלות`           | `SHEET_TAB_RECEIPTS`| One row per receipt line (mixed payments → multiple rows) |
| `תנועות`          | `SHEET_TAB_TXNS`    | Bank/credit-card transactions from statement imports       |
| `חנויות`          | `SHEET_TAB_STORES`  | Canonical store names with variant aliases and counts      |
| `הגדרות`          | `SHEET_TAB_SETTINGS`| Key/value user settings (e.g., `myCardsLast4`)             |

### `Receipt` (the central type — see `lib/types.ts`)

15 columns (A–O). Headers in Hebrew (`RECEIPT_HEADERS`); TypeScript field names in English. Maps via `receiptToRow` / `rowToReceipt` in `lib/google.ts`.

| Col | Header (Hebrew)       | Field                | Type / Notes                                    |
| --- | --------------------- | -------------------- | ----------------------------------------------- |
| A   | `id`                  | `id`                 | UUID v4                                         |
| B   | `שם קובץ`             | `fileName`           | Original filename                               |
| C   | `שם חנות`             | `storeName`          | nullable, may be `DEFAULT_STORE_NAME` ("לא ידוע")|
| D   | `סכום`                | `amount`             | This line's portion (mixed payment splits)      |
| E   | `תאריך`               | `date`               | YYYY-MM-DD                                      |
| F   | `קטגוריה`             | `category`           | One of `CATEGORIES` (fixed list of 18)          |
| G   | `סוג מסמך`            | `documentType`       | `DocumentType` enum                             |
| H   | `אמצעי תשלום`         | `paymentMethod`      | `PaymentMethod` enum                            |
| I   | `סכום קבלה כולל`      | `totalReceiptAmount` | The receipt's grand total (≠ amount when split) |
| J   | `4 ספרות אחרונות`     | `cardLast4`          | nullable                                        |
| K   | `מקושר ל`             | `linkedTo`           | UUID of primary row (mixed payments, dupes)     |
| L   | `confidence`          | `confidence`         | `"low" \| "med" \| "high"`                      |
| M   | `drive_file_id`       | `driveFileId`        | Drive file ID for image link                    |
| N   | `נבדק ידנית`          | `reviewed`           | boolean                                         |
| O   | `הערות`               | `notes`              | Free text                                       |

### Other domain entities

- **`Store`** (`חנויות` tab): `{ canonical, count, variants[] }` — variants is comma-separated in the cell, parsed on read.
- **`BankTxn`** (`תנועות` tab): `{ source, date, amount, description, receiptId, status }`. Status values are Hebrew strings: `"תואם" | "חסרה קבלה" | "קבלה ללא תנועה"`.
- **`UserSettings`** (`הגדרות` tab): key/value rows. Currently only `myCardsLast4`.

---

## Critical domain rules

### Categories (`CATEGORIES` — fixed list of 18)

The category list is **fixed and immutable**. Gemini is instructed to never invent a new category. The list reflects an Israeli court-mandated household budget framework (note: `"כלכלה (מזון) - מס' נפשות 3"` literally encodes the household size of 3 into the category name). Most catch-all stuff goes to `"שונות"`.

### Payment methods (`PAYMENT_METHOD`)

User-facing Hebrew labels. The OCR extraction (`EXTRACTED_METHOD`) uses English internal values, then `classifyMethod` in `app/api/ocr/route.ts` maps to user-facing labels.

| Internal (`EXTRACTED_METHOD`) | User-facing (`PAYMENT_METHOD`) | When                                                                                       |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `credit_card`                 | `אשראי` or `מזומן`            | "אשראי" if card last-4 is in user's card list; "מזומן" if it's a foreign card. If list is empty → trust receipt → "אשראי" |
| `cash`                        | `מזומן`                        | Always                                                                                     |
| `standing_order`              | `הוראת קבע`                    | Always (NEW — utilities, mobile, daycare on automatic bank-debit)                          |
| `other`                       | `אחר`                          | Check / transfer / unclear                                                                 |

`classifyMethod` is an **exhaustive switch over `ExtractedMethod`** — adding a new value without updating the switch will fail typecheck. This is intentional.

### Document types (`DOCUMENT_TYPE`)

`קבלה | חשבונית מס | ספח אשראי | כפילות | לא ידוע`. `כפילות` ("duplicate") is assigned only by the dedup pipeline; the OCR layer never produces it.

### "Card list" logic

Stored at `myCardsLast4` key in the `הגדרות` tab as a single cell of comma-separated 4-digit strings. The stored value is written with `valueInputOption: "RAW"` because `"USER_ENTERED"` makes Sheets parse `6021,8780,5323` as a number with thousands separators and corrupts it.

**Three-way fallback in `classifyMethod`:**
1. Card list **empty** → trust the receipt's `credit_card` classification → `אשראי`.
2. Card list non-empty + receipt's `card_last4` matches → `אשראי`.
3. Card list non-empty + no match (or no `card_last4`) → `מזומן` (foreign card, owner doesn't pay this — reconciled against personal cash).

---

## Recent decisions and lessons learned (chronological — most recent at top)

### ✅ Bi-monthly insolvency report wizard — COMPLETE, in production (2026-07-13)

The project's biggest feature arc is finished: the six-step **הכנת דוח דו-חודשי**
wizard at `/report` (period folders → statement parsing/reconciliation → receipt
matching → cash → classification → step 6). Step 6 produces:
- **הפק דוח** — a working sheet + the anonymous government report filled from the
  clean template (label-anchored writes, anonymity guard, `lib/report/generate.ts`).
- **נפק PDF** — a signed PDF bundle (`lib/report/pdf.ts`): personal details are
  collected one-time in a dialog, written to a **temp Sheet copy deleted in
  `finally`**, the report tab is exported fit-to-page (`scale=4`), the signature is
  stamped via pdf-lib (RTL-mirrored geometry, Illustrator-calibrated constants),
  source documents + attached receipts are appended (jimp-compressed), progress is
  streamed as NDJSON to the dialog, and a **תצוגה מקדימה** mode returns just the
  stamped page with zero Drive writes.

**Rules that outlive the feature:** personal details exist ONLY in the output PDF
(name-prefixed filename, every version kept) — never in code/Sheets/progress/logs;
Hebrew UI strings come from per-plan approved lists (STOP-and-ASK otherwise).
Feature docs: `INSOLVENCY-REPORT-PLAN.md` (historical spec) +
`docs/superpowers/specs/` + `docs/superpowers/plans/`. Known deferred perf item:
Drive downloads/moves in the PDF bundle are sequential (progress makes the wait
transparent; parallelizing is a future step).

**How it was built (the repo's standing workflow, see CLAUDE.md "Planning &
Execution Workflow"):** a chain of handoff plans — Fable brainstorms/writes each
spec+plan, an Opus session orchestrates `superpowers:subagent-driven-development`
with cheap Sonnet implementer subagents (no-commit; orchestrator reviews every
report+diff, runs typecheck, commits), E2E findings roll into the next plan in the
chain, and `.superpowers/sdd/progress.md` carries cross-session state.

### Card-list serialization: USER_ENTERED → RAW (commit `aaedb99`)

`writeUserSettings` was using `valueInputOption: "USER_ENTERED"`, which made Google Sheets parse `"6021,8780,5323"` as a number with thousands separators (storing it as 6,021,878,805,323). Switched to `RAW`. Users with corrupted data must re-save once via `/settings`.

### Big feature: user-configurable card list + הוראת קבע (commits `1d29e92`, `2a9e9ed`)

Previously the app had a single hardcoded card last-4 (`MY_CREDIT_CARD_LAST4=6021` env var, with `"6021"` as a literal fallback in code and in the prompt). Problems: (1) "6021" was a real card number leaking into a public repo, (2) the owner pays with multiple cards (physical, Google Wallet virtual, spouse's), and (3) bills paid by direct debit ("הוראת קבע") got bucketed as `אחר` or `מזומן`, breaking reconciliation.

Replaced with:
- A new sheet tab `הגדרות` storing `myCardsLast4` as a list.
- `/settings` page with a chip-style editor (`components/SettingsForm.tsx`).
- New payment method `PAYMENT_METHOD.StandingOrder = "הוראת קבע"`, detected by the Gemini prompt.
- Centralized all string literals in `lib/types.ts` as const enums (`EXTRACTED_METHOD`, `PAYMENT_METHOD`, `DOCUMENT_TYPE`, `EXTRACTED_DOC_TYPE`). All call sites refactored to reference constants. Adding a new enum value forces typecheck-time exhaustiveness errors.

### PWA icon 404s + Sheets Table conflict (commit `856629d`)

Two unrelated bugs surfaced after deploying to chewie.ceo:
1. `public/icons/icon-192.png` and `icon-512.png` were missing — generated with `sharp` from inline SVG (dark navy bg, Hebrew letter ס).
2. Owner had accidentally created a Google Sheets **Table** (the new feature, Insert → Table) on a range in the spreadsheet. `applyTabFormatting` called `setBasicFilter` over a range that partially overlapped the Table, which Sheets rejected. Fix: split formatting into two separate `batchUpdate` calls — the header formatting (always succeeds) and the per-tab `clearBasicFilter` + `setBasicFilter` wrapped in try/catch with a warning log.

### driveFileId column corruption + `/api/fix-drive-ids` (commit `637b6e1`)

A bug caused widespread mismatch between `fileName` and `driveFileId` in column M of the receipts tab (filenames correct, IDs pointing to wrong files). Wrote a recovery endpoint `POST /api/fix-drive-ids` that searches Drive by filename for each receipt and rewrites `driveFileId`. Returns `{ fixed, alreadyCorrect, notFound, notFoundFiles }`. Triggered from the `/receipts` page via a "תקן קישורי Drive" button. Now part of normal operations.

### DriveImport: skip-existing + loading state (commits `1ebfc49`, `5bb3ca5`)

After bulk-importing 117 receipts via DriveImport, the owner accidentally exited mid-scan at 104/117. There was no way to resume without re-scanning everything (creating duplicates). Now on folder load, the component fetches the existing sheet, builds a `Set<string>` of `driveFileId`s, and shows "סרוק חדשים (N)" alongside "סרוק הכל מחדש". The folder-load operation has a proper loading indicator to avoid showing a stale button briefly.

### Date validation, prompt anti-hallucination (commits `00cec0c`, `ba75dc2`)

Gemini occasionally invented store names by recognizing receipt formats from training data (e.g., reading "מאפית הצבי" as some chain it knew). The OCR prompt was rewritten with a `## CRITICAL: Only read from the image. Never use training knowledge.` section. Also added: valid date range 2018–2030 (rejects OCR errors like year 1990 or 2044), strict `לתשלום` parsing rules (vs `מזומן`/`עודף` which trip up the model), and "store name lives in the first line" hint. Image orientation is also handled — the user pre-rotated their existing 117 receipts with a `rotate-smart.mjs` script (Gemini Flash detected rotation per image, ImageMagick rotated; the script lives locally, not in the repo).

### Fixed-list categories (commit `f2a9641`)

Replaced an LLM-generated category guesser with the fixed list of 18 Israeli household-budget categories (see `CATEGORIES` in `lib/types.ts`). Gemini is told "pick exactly one — never invent". The category list reflects the owner's specific budgeting context.

### OCR_MODEL = Pro, English prompts, slip linking (commit `4001245`)

Originally prompts were Hebrew — switched to English (better Gemini compliance). Switched OCR_MODEL to Gemini 2.5 Pro (Flash had too many extraction errors on Hebrew receipts). Added the credit-slip pairing logic (`ספח אשראי` paired to its parent receipt during dedup).

---

## Important code patterns

### Single source of truth for enums

**Never inline Hebrew strings** like `"לא ידוע"`, `"קבלה"`, `"אשראי"` in call sites. Always import from `lib/types.ts`:

```ts
import { DOCUMENT_TYPE, PAYMENT_METHOD, DEFAULT_STORE_NAME } from "@/lib/types";

// good:
const docType = DOCUMENT_TYPE.Duplicate;
if (r.documentType === DOCUMENT_TYPE.CreditSlip) { ... }
const store = r.storeName ?? DEFAULT_STORE_NAME;

// bad:
const docType = "כפילות";                    // typo-prone, no rename safety
if (r.documentType === "ספח אשראי") { ... }   // ditto
```

The only exception is `lib/ai.ts` — the Gemini prompts themselves necessarily contain Hebrew literals because they are model instructions, not code. Same for the literal sheet tab/header strings declared once in `lib/types.ts`.

### Exhaustive switches over const enums

`classifyMethod` in `app/api/ocr/route.ts` is the canonical pattern. Adding a new `EXTRACTED_METHOD` value without a `case` clause is a typecheck error:

```ts
function classifyMethod(method: ExtractedMethod, ...): PaymentMethod {
  switch (method) {
    case EXTRACTED_METHOD.Cash: return PAYMENT_METHOD.Cash;
    case EXTRACTED_METHOD.StandingOrder: return PAYMENT_METHOD.StandingOrder;
    case EXTRACTED_METHOD.Other: return PAYMENT_METHOD.Other;
    case EXTRACTED_METHOD.CreditCard: { ... }
  }
}
```

### Spreadsheet bootstrapping

`ensureSpreadsheet(token)` in `lib/google.ts`:
1. If `SUMOO_SPREADSHEET_ID` env var is set, use it.
2. Else, search the user's Drive for a file named `"Receipts – sumoo"`.
3. If still nothing, create a new spreadsheet with all four tabs.
4. Always call `ensureTabs` to backfill missing tabs (so older user spreadsheets get `הגדרות` added automatically on next login).

`ensureTabs` checks each tab name against existing tabs from the spreadsheet metadata; if a tab is missing, it appends it via `addSheet` and writes headers.

### Sheet read/write idioms

- All reads/writes go through `lib/google.ts` — never call `google.sheets()` directly from API routes.
- `bulkUpdateReceipts` finds rows by id via a one-shot `values.get('id column')` then issues a `values.batchUpdate`.
- `appendReceipts` uses `values.append` — **be aware**: `append` is gap-sensitive. If there are empty rows in column A, append will jump past them. We learned this the hard way; always fill column A (UUID) when adding rows manually.
- `applyTabFormatting` runs **two** batch updates: (1) header bold + freeze (never fails); (2) per-tab `clearBasicFilter` + `setBasicFilter` in try/catch (fails if a Sheets Table exists on the range, but we don't want that to break onboarding).

### Image preprocessing

`sharp` in `app/api/ocr/route.ts:shrinkImage` rotates per EXIF, resizes to `MAX_DIM=1568` inside-fit, JPEG quality 85. Crucial: `.rotate()` honors EXIF (so a portrait phone photo lands upright). In practice, the owner's batch of 117 receipts had `Orientation: 1` for all of them (camera lost the metadata), so EXIF rotation was a no-op and we pre-rotated with a Gemini-Flash-based script outside the app.

### Retries on Gemini overload

`lib/ai.ts:withRetry` retries on 503/429/"overloaded" with a 3s delay (max 2 attempts). `DriveImport` additionally pauses the batch if 3 consecutive overloads happen and offers a "המשך סריקה" button.

---

## How requests flow

### Scan a single receipt (single file)

1. User drops a JPG/PNG/PDF on `/upload` → `UploadZone` reads to base64.
2. `POST /api/ocr` (`kind: "upload"`):
   - `shrinkImage` resizes via sharp.
   - `requireAccessToken` + `ensureSpreadsheet` + `getAllStores` + `getUserSettings` run in parallel-ish.
   - `extractReceipt` in `lib/ai.ts` calls Gemini 2.5 Pro with the receipt schema + known canonical store names.
   - File is uploaded to the user's `(uploads)` Drive folder for permanent storage.
   - `classifyMethod` maps Gemini's `credit_card`/`cash`/etc + the user's card list → final `PaymentMethod`.
   - Mixed payments → multiple linked rows with `linkedTo` pointing to the primary row's id.
3. Server returns `{ receipts: Receipt[] }`.
4. Client `POSTs /api/sheets` with the new receipts → `appendReceipts` writes rows.
5. User navigates to `/receipts` to see / edit / dedup.

### Bulk import from Drive folder

`DriveImport` component lists files in a Drive folder, fetches existing `driveFileId`s from `/api/sheets`, and offers two scan buttons (new only / all). Concurrency is 2. Per-file `POST /api/ocr` (`kind: "drive"`) with the Drive file id; the server downloads, OCRs, and returns receipts. The client then writes them via `POST /api/sheets`.

### Dedup pipeline (`/api/dedup`)

Three steps:
1. **Canonicalize store names** — `canonicalizeStoreNames` in `lib/ai.ts` clusters OCR'd store names structurally (district codes, suffixes, prefixes, distinctive brand words). Optionally cross-checks via Google Places (New).
2. **Group by (date, storeName, totalReceiptAmount)** — exact-match dedup. Tax-invoice > Receipt > Credit-slip > Unknown wins the "primary" slot; the rest get `documentType=כפילות` or stay as `ספח אשראי` if they were already credit slips.
3. **Fuzzy dedup via LLM** — `detectDuplicatesAndPairs` finds harder cases (e.g., same receipt scanned twice with slight OCR variance).

Returns a summary with `dupCount`, `slipCount`, `placesResolutions` count, and a `placesChanges` array showing renames.

### Bank reconciliation (`/compare`)

Out of scope for the current branch's work — handled by `CompareView` + `lib/parsers.ts` + `lib/match.ts`. Mention only if the user asks.

---

## Running locally

```bash
npm install
npm run dev      # http://localhost:3000
npm run typecheck
npm run build
npm run lint
```

Requires `.env.local` with all the keys from `.env.local.example` plus your own values. Google OAuth requires `http://localhost:3000/api/auth/callback/google` to be an authorized redirect URI in the Google Cloud project.

---

## Open threads / things to watch

- **Existing user with corrupted card-list cell:** after the RAW fix (`aaedb99`), they need to re-save their cards via `/settings`. Read path returns empty list if the cell has thousand-separator-formatted numbers.
- **The owner's spreadsheet may have a Table:** if `setBasicFilter` keeps logging warnings, the owner can convert the Table back to a range (Table Design → Convert to Range) to silence them.
- **`PaymentMethod = "מעורב"` is in the enum but never written** — left in for future use when we might want to surface "this receipt had multiple payment methods" at the parent-row level instead of per-line.
- **`fix-drive-ids` is a one-shot recovery tool**, not part of the regular flow. The button to trigger it is on `/receipts`.
- **No tests yet** — the project is a personal tool, tests are out of scope unless the user requests.

---

## Branch state at handoff

- **Workflow:** `main` (production, Vercel auto-deploy) ← `dev` (integration) ←
  `feat/<name>` branches. Never commit to `main`/`dev` directly; the owner opens
  and merges PRs himself.
- **As of 2026-07-13:** the report-wizard arc is fully merged — `feat/report-pdf`
  → `dev` (PR #32) → `main`. No feature work in flight.
- **Deployed:** https://www.chewie.ceo (auto-deploy from `main` via Vercel).

---

## Glossary (Hebrew → English, app-specific)

| Hebrew                  | English / meaning                                            |
| ----------------------- | ------------------------------------------------------------ |
| קבלה                   | Receipt                                                      |
| חשבונית מס             | Tax invoice                                                  |
| ספח אשראי              | Credit-card slip (the small paper from the terminal)        |
| כפילות                 | Duplicate (assigned by dedup pipeline)                       |
| הוראת קבע / הו"ק       | Standing order / direct debit                                |
| לתשלום                 | "To pay" — the canonical total-amount label                 |
| מזומן                  | Cash                                                         |
| אשראי                  | Credit (in this app, means "owner's own credit card")       |
| ח.פ. / ע.מ.            | Israeli business ID prefixes                                 |
| ארנונה                 | Municipal property tax                                       |
| תאגיד מים              | Water utility corporation                                    |
| חברת החשמל             | Israel Electric Corporation                                  |
| ועד בית                | Building maintenance / HOA                                   |
| מעון / צהרון            | Daycare / after-school                                       |
| חברת מים, בזק, HOT, etc. | Specific utility brand names that appear in receipts        |

---

## Suggested first prompt for a new session

> "Read SESSION-CONTEXT.md and CLAUDE.md for project context. The bi-monthly
> report wizard (including the signed-PDF export) is complete and in production;
> there is no feature work in flight. For any sizable feature, follow CLAUDE.md's
> 'Planning & Execution Workflow' (spec+plan chain, Sonnet implementer subagents,
> orchestrator reviews+commits). Open items live in DOTO.md. Next thing I want to
> work on is: [YOUR NEXT TASK]."
