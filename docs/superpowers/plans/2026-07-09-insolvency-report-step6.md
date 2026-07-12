# Insolvency Report — Wizard Step 6 ("הפקת דוח") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the final wizard step: generate the working spreadsheet ("חישוב תדפיסי בנק") and the filled government report (copy of the clean template) into the period's Drive folder.

**Architecture:** A pure rollup module (`lib/report/rollup.ts`) turns the wizard's decision state into per-category × per-month sums (shared by the step-6 preview UI and the server). A server module (`lib/report/generate.ts`) writes two artifacts via new generic `lib/google.ts` helpers: (1) a working spreadsheet created in the period folder, (2) a copy of the template xlsx converted to a Google Sheet whose cells are filled by **label-anchored** lookup (find the fixed category strings in the grid, write relative to them) — never hardcoded A1 addresses. One new API route orchestrates. Settings gain two entries (household size, template file) following the existing `myCardsLast4` pattern.

**Tech Stack:** Next.js 16 (App Router, Node runtime), TypeScript strict, googleapis (Drive v3 + Sheets v4), shadcn primitives already in the repo. **No new dependencies.**

---

## Execution & model protocol (user-mandated)

- **Planning/research:** done (this document, authored by Fable 5 after inspecting the real Drive files).
- **Orchestration + review of subagent reports:** the executing session runs on **Opus 4.8**. It uses `superpowers:subagent-driven-development`: dispatch one task at a time, review the subagent's report AND the actual diff (run `npm run typecheck` itself before accepting), then commit/proceed.
- **Implementation:** each task is executed by a **Sonnet 5 subagent** (Agent tool with `model: "sonnet"`). Give the subagent: the full task text, the **Global Constraints** section verbatim, and nothing else — tasks are self-contained.
- **Escalation:** any ambiguity, template-shape surprise, failing conversion, or new Hebrew string not in the **Approved strings** list → STOP and ask the user (CLAUDE.md STOP-and-ASK). Do not improvise.
- Subagents MUST call the context7 MCP for googleapis specifics before writing Drive/Sheets code (project rule).

## Global Constraints

- Branch: create `feat/report-generate` off `dev`. Never commit to `dev`/`main`. PR into `dev` at the end.
- Conventional commits; one logical change per commit; `npm run typecheck` must pass before every commit.
- No new npm dependencies. No theme/token changes; shadcn primitives only; never `rounded-*`; no `alert()`.
- All Google API access via `lib/google.ts` only. All Hebrew domain strings from `lib/types.ts` / constants — no inline Hebrew literals except the approved UI strings below.
- API routes: `export const runtime = "nodejs"`, auth via `requireAccessToken()`, whole handler in try/catch, success `{ ok: true, ... }`, error `{ error: string }` + 4xx/5xx.
- Const-enum discipline (ARCHITECTURE.md §4.4): maps from const-enums are exhaustive; iterate via `GOV_*_CATEGORIES` arrays.
- Do NOT run `npm run dev` or attempt visual verification — hand off to the user (CLAUDE.md).
- Quota frugality: a full generation must stay ≲ 12 Sheets/Drive calls total. Batch writes; never per-row/per-cell calls.

## Decisions locked with the user (2026-07-09)

1. **One anonymous report file per period.** A report belongs to the one account set that went through the wizard — nothing more. The app NEVER writes personal details of any kind (no name, case number, phone, address, signature) and no personal details may appear anywhere in the code, constants, comments, or examples. The user handles everything beyond the numbers outside the app.
2. **Canonical template** = Drive file `12gLxQ7ASHXIZnX-Y_MTT_68d3bwL_13B` ("דו'ח דו-חודשי יחיד בהליך חדלות פירעון.xlsx") — a clean, anonymous xlsx with two tabs: `דו"ח` (the report) and `פירוטים` (food breakdown). Template ID resolution order: user setting → `SUMOO_REPORT_TEMPLATE_ID` env → hardcoded default constant. Settings UI gets a Drive **file** picker to change it.
3. **Household size (מס' נפשות)** is a persisted user setting (like `myCardsLast4`), injected as a variable into the Food category label everywhere it is rendered/written: `` `${GOV_EXPENSE_CATEGORY.Food}, מס' נפשות ${n}` ``.
4. **Other income** (included family transfers + credits routed to "income") is written to the first empty income continuation row (row 7) with label **"העברות ואחר"**.
5. Credits routed to "expense" (refunds) subtract from **שונות** (Miscellaneous) in the category rollup, so the category cells still sum to the on-screen expense total.
6. Because the template is xlsx, the copy MUST convert to a native Google Sheet (`files.copy` with `mimeType: application/vnd.google-apps.spreadsheet`) so cells can be written via Sheets API. Output artifacts are native Google Sheets.

## Template ground truth (inspected 2026-07-09)

Clean template, tab `דו"ח`, effective grid (columns 0-based; derived from the file's CSV projection — Task 4 verifies at runtime by label anchoring, never by these indices):

- Header rows: a row contains `בהתייחס לחודשים` (label at col 1; month-name cells at cols 2,3; `של שנת` at col 5; year cell at col 6).
- Income block: header row contains `הכנסות היחיד/ה` … with four cells equal to `חודש` (left value cols 2,3; right value cols 6,7) and `הכנסות המשך` at col 4. Rows 1–6: number at col 0, label at col 1 (some labels have trailing spaces — **trim before comparing**), values at cols 2,3. Continuation rows: number `7`–`11` at col 4, empty label at col 5, values at cols 6,7. Totals row: `סה"כ הכנסות` at col 4, values at cols 6,7 (`₪ 0.00` in the clean template — likely formulas; see read-back rule in Task 5).
- Expense block: same structure; left rows 1–13 (`שכר דירה` … `חינוך ותרבות`), right rows 13–23 (`נסיעות` … `כלי בית ותחזוקה`, row 23 blank) plus a `הוצאות נוספות וחריגות` sub-header row. Food label cell is `כלכלה (מזון), מס' נפשות __` → **match by prefix** `כלכלה (מזון)` and overwrite the label cell with the formatted label. Totals row: `סה"כ הוצאות`, values at cols 6,7.
- Footer: a row contains `תאריך:` (write generation date DD/MM/YYYY into the next cell). Address/phone/name/case cells stay untouched (anonymous).
- Tab `פירוטים`: row with `חודש אחד` / `חודש שתיים`; row with two `סה"כ כלכלה` cells + sum cells; row with `תאריך`/`סכום` headers (cols 1,2 for month 1; cols 4,5 for month 2); data rows below.

Prior-period reference values for E2E verification (period 3-4_2026, from the user's hand-made report): income totals `18,566.57 / 18,594.64`; expense totals `19,258.71 / 18,208.57`; e.g. כלכלה `4,680.44 / 7,585.57`, תשלום לממונה `5,200 / 5,200`.

## Approved strings (the complete list — anything else → STOP-and-ASK)

| Purpose | String |
|---|---|
| Working spreadsheet file name | `חישוב תדפיסי בנק <m1>-<m2>_<year>` (e.g. `חישוב תדפיסי בנק 3-4_2026`) |
| Working sheet tab | `חיובים דיירקט` |
| Working sheet headers | `שם בית עסק`, `סכום חיוב`, `מטבע חיוב`, `פירוט נוסף`, `תאריך חיוב`, `קטגוריה`, `קבלה` |
| Gov report file name | `דוח דו-חודשי <m1>-<m2>_<year>` |
| Other-income row label | `העברות ואחר` |
| Food label pattern | `כלכלה (מזון), מס' נפשות <n>` |
| Hebrew month names | `ינואר, פברואר, מרץ, אפריל, מאי, יוני, יולי, אוגוסט, ספטמבר, אוקטובר, נובמבר, דצמבר` |
| Month header cell | `חודש <name>` (e.g. `חודש מרץ`) |
| Step-6 UI | `תצוגה מקדימה`, `הכנסות`, `הוצאות`, `סה"כ`, `מס' נפשות: <n>`, `שינוי בהגדרות`, `הפק דוח`, `הפק מחדש`, `מפיק…`, `הדוח הופק בהצלחה`, `גיליון עבודה`, `דוח דו-חודשי`, `יש לעבד מסמכים תחילה בשלב פירוק וסיווג.`, `הפקת הדוח נכשלה` |
| Settings UI | `מס' נפשות בבית`, `מספר הנפשות שיירשם בשורת "כלכלה (מזון)" בדוח.`, `תבנית הדוח הדו-חודשי`, `קובץ התבנית שממנו יופק הדוח. ברירת מחדל: התבנית המובנית.`, `חפש קובץ ב-Drive...`, `לא נמצאו קבצים`, `ברירת מחדל (תבנית מובנית)` |

---

### Task 0: Branch, plan doc, CLAUDE.md reference, memory (orchestrator does this itself — no subagent)

**Files:**
- Create: `docs/superpowers/plans/2026-07-09-insolvency-report-step6.md` (copy of this plan file)
- Modify: `CLAUDE.md` (Source of Truth section)

**Steps:**
- [ ] `git checkout dev && git pull && git checkout -b feat/report-generate`
- [ ] Copy this plan file into `docs/superpowers/plans/2026-07-09-insolvency-report-step6.md`.
- [ ] In `CLAUDE.md`, after the REDESIGN-PLAN.md paragraph in the "Source of Truth" section, add:

```markdown
For the bi-monthly insolvency report feature, **INSOLVENCY-REPORT-PLAN.md** is the
feature spec. The report-generation step (wizard step 6) is executed per
**docs/superpowers/plans/2026-07-09-insolvency-report-step6.md** — follow its
model-split protocol and approved-strings list exactly.
```

- [ ] Write a memory file `C:\Users\dajro\.claude\projects\C--Development-sumoo\memory\project_report_anonymity.md` (type: project): the generated report is always a single anonymous numbers-only file for the account set processed by the wizard; personal details (names, case numbers, addresses, phones) are entirely out of the app's scope and must NEVER appear in code, constants, examples, or generated output — the user handles them outside the app. Canonical clean template Drive ID `12gLxQ7ASHXIZnX-Y_MTT_68d3bwL_13B`. Add an index line to `MEMORY.md`.
- [ ] Commit: `docs: add step-6 execution plan and CLAUDE.md reference`

### Task 1: Settings data layer — household size + report template

**Files:**
- Modify: `lib/types.ts` (SETTINGS_KEY, UserSettings, new constants)
- Modify: `lib/google.ts` (`getUserSettings`, `writeUserSettings`)
- Modify: `app/api/settings/route.ts`

**Interfaces (produces):**
- `UserSettings` gains `householdSize: number | null` and `reportTemplate: { id: string; name: string } | null`.
- `lib/types.ts` exports `DEFAULT_HOUSEHOLD_SIZE = 3`, `HEBREW_MONTHS: readonly string[]` (12 names from the approved list), and `formatFoodCategory(householdSize: number): string`.

**Steps:**
- [ ] **lib/types.ts** — extend the Settings section:

```ts
export const SETTINGS_KEY = {
  MyCardsLast4: "myCardsLast4",
  HouseholdSize: "householdSize",
  ReportTemplate: "reportTemplate",
} as const;
export type SettingsKey = (typeof SETTINGS_KEY)[keyof typeof SETTINGS_KEY];

export interface UserSettings {
  myCardsLast4: string[]; // exactly 4-digit strings, validated
  householdSize: number | null; // 1..20; null = unset (fall back to DEFAULT_HOUSEHOLD_SIZE)
  reportTemplate: { id: string; name: string } | null; // null = built-in default template
}

// Household-size default for the Food row when the setting is unset (user-confirmed).
export const DEFAULT_HOUSEHOLD_SIZE = 3;

// The Food row label carries the household size in both the working sheet and
// the government report (user-confirmed uniformity requirement).
export function formatFoodCategory(householdSize: number): string {
  return `${GOV_EXPENSE_CATEGORY.Food}, מס' נפשות ${householdSize}`;
}

// Hebrew month names for the gov-report header (1-based month → index-1).
export const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;
```

- [ ] **lib/google.ts** — in `getUserSettings`, extend `empty` to `{ myCardsLast4: [], householdSize: null, reportTemplate: null }` and add to the row loop:

```ts
if (key === SETTINGS_KEY.HouseholdSize) {
  const n = Number(value);
  out.householdSize = Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}
if (key === SETTINGS_KEY.ReportTemplate) {
  try {
    const t = JSON.parse(value) as { id?: unknown; name?: unknown };
    if (typeof t.id === "string" && t.id && typeof t.name === "string") {
      out.reportTemplate = { id: t.id, name: t.name };
    }
  } catch { /* malformed row — treat as unset */ }
}
```

  In `writeUserSettings`, build the rows array conditionally (only write set keys) and pass it to the existing single `values.update`:

```ts
const rows: string[][] = [[SETTINGS_KEY.MyCardsLast4, validCards.join(",")]];
if (s.householdSize !== null) rows.push([SETTINGS_KEY.HouseholdSize, String(s.householdSize)]);
if (s.reportTemplate !== null) rows.push([SETTINGS_KEY.ReportTemplate, JSON.stringify(s.reportTemplate)]);
```

  (Import `SETTINGS_KEY` from `@/lib/types` if not already imported.)
- [ ] **app/api/settings/route.ts** — POST currently parses only `myCardsLast4` and overwrites the whole tab; extend body parsing so the other settings are not silently erased:

```ts
const body = await req.json() as {
  myCardsLast4?: unknown; householdSize?: unknown; reportTemplate?: unknown;
};
const raw = Array.isArray(body.myCardsLast4) ? body.myCardsLast4 : [];
const myCardsLast4 = (raw as unknown[])
  .filter((v): v is string => typeof v === "string" && /^\d{4}$/.test(v));
const hs = Number(body.householdSize);
const householdSize = Number.isInteger(hs) && hs >= 1 && hs <= 20 ? hs : null;
const rt = body.reportTemplate as { id?: unknown; name?: unknown } | null | undefined;
const reportTemplate =
  rt && typeof rt.id === "string" && rt.id && typeof rt.name === "string"
    ? { id: rt.id, name: rt.name }
    : null;
await writeUserSettings(token, spreadsheetId, { myCardsLast4, householdSize, reportTemplate });
```

  **Client contract:** POST replaces the whole settings object — the settings form must always send all fields (Task 2 handles this).
- [ ] `npm run typecheck` → PASS (fix any `UserSettings` construction sites; grep `writeUserSettings(` and `getUserSettings(` callers — `app/api/scan-context/route.ts` and `app/api/ocr/route.ts` only read, but any literal `{ myCardsLast4 }` object must gain the new fields).
- [ ] Commit: `feat(settings): add householdSize and reportTemplate settings`

### Task 2: Settings UI — household size field + Drive file picker

**Files:**
- Modify: `lib/google.ts` (add `searchDriveFiles`)
- Create: `app/api/drive/files/route.ts`
- Create: `components/DriveFilePicker.tsx`
- Modify: `components/SettingsForm.tsx`

**Interfaces:**
- Consumes: Task 1's `UserSettings` shape and POST contract (always send all fields).
- Produces: `searchDriveFiles(accessToken, query): Promise<{id, name}[]>`; `<DriveFilePicker value onChange/>` with `FileSelection = { kind: "default" } | { kind: "drive"; id: string; name: string }`.

**Steps:**
- [ ] **lib/google.ts** — clone `searchDriveFolders` (google.ts:667) into `searchDriveFiles`, searching spreadsheet files instead of folders:

```ts
// Name-contains search over spreadsheet-like files (native Sheets + xlsx),
// used by the report-template picker. Max 20, excludes trashed.
export async function searchDriveFiles(
  accessToken: string,
  query: string,
): Promise<Array<{ id: string; name: string }>> {
  const drive = driveClient(accessToken);
  const escaped = query.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name contains '${escaped}' and trashed = false and (mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`,
    fields: "files(id, name)",
    pageSize: 20,
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
}
```

  (Match the exact escaping/`fields` conventions of `searchDriveFolders` — read it first.)
- [ ] **app/api/drive/files/route.ts** — exact clone of `app/api/drive/folders/route.ts` with `searchDriveFiles` and `{ files }` payload key.
- [ ] **components/DriveFilePicker.tsx** — copy `DriveFolderPicker.tsx` structure verbatim, renamed: `FileSelection` type, sentinel label `ברירת מחדל (תבנית מובנית)`, fetch `/api/drive/files?q=`, placeholder `חפש קובץ ב-Drive...`, empty text `לא נמצאו קבצים`.
- [ ] **components/SettingsForm.tsx** — extend state with `householdSize: number | null` and `template: FileSelection`; populate from GET (`json.householdSize`, `json.reportTemplate`); render below the cards section:
  - a `Label` `מס' נפשות בבית` + helper text `מספר הנפשות שיירשם בשורת "כלכלה (מזון)" בדוח.` + numeric `Input` (integer 1–20, blur/Enter saves),
  - a `Label` `תבנית הדוח הדו-חודשי` + helper text `קובץ התבנית שממנו יופק הדוח. ברירת מחדל: התבנית המובנית.` + `<DriveFilePicker/>` (onChange saves).
  - `persist()` must now always POST the **full** object: `{ myCardsLast4, householdSize, reportTemplate }` where `reportTemplate` is `null` for `{kind:"default"}`.
- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(settings): household-size input and report-template Drive file picker`

### Task 3: Pure rollup module — `lib/report/rollup.ts`

**Files:**
- Create: `lib/report/rollup.ts`

**Interfaces:**
- Consumes: `CategorizedExpense` (`lib/report/process.ts`), `IncomeItem`/`TransferItem`/`ReviewCredit` (`lib/report/reconcile.ts`), `GOV_*` enums + `formatFoodCategory` (`lib/types.ts`).
- Produces (used by Tasks 4–6): `OTHER_INCOME_LABEL`, `RollupInput`, `ReportRollup`, `WorkingRow`, `buildReportRollup(input: RollupInput): ReportRollup`. **Client-safe: no googleapis imports.**

**Steps:**
- [ ] Create the module:

```ts
// Pure category rollup for wizard step 6. Turns the wizard's decision state
// (live expenses + inclusion/routing maps) into the per-month figures written
// to the working sheet and the government report. Client-safe (no I/O) — the
// step-6 preview and the /api/report/generate route share this single source
// of truth, so what the user previews is exactly what gets written.
import {
  GOV_EXPENSE_CATEGORIES,
  GOV_EXPENSE_CATEGORY,
  GOV_INCOME_CATEGORIES,
  formatFoodCategory,
  type GovExpenseCategory,
  type GovIncomeCategory,
} from "@/lib/types";
import type { CategorizedExpense } from "@/lib/report/process";
import type {
  IncomeItem,
  ReviewCredit,
  TransferItem,
} from "@/lib/report/reconcile";

// Label for the income continuation row holding included family transfers +
// credits the user routed to income (no fixed gov row fits them; user-approved).
export const OTHER_INCOME_LABEL = "העברות ואחר";

export interface RollupInput {
  months: [number, number];
  expenses: CategorizedExpense[];
  income: IncomeItem[];
  transfers: TransferItem[];
  reviewCredits: ReviewCredit[];
  // Same semantics as the wizard state: absent expense/income key = included;
  // absent transfer key = excluded; absent credit key = excluded.
  expenseIncluded: Record<string, boolean>;
  incomeIncluded: Record<string, boolean>;
  transferInclude: Record<string, boolean>;
  creditRoute: Record<string, "income" | "expense" | "exclude">;
  householdSize: number;
}

// One working-sheet row, in the exact column order of the חיובים דיירקט tab.
export interface WorkingRow {
  merchant: string;
  amount: number;
  currency: string; // always "₪" — bank truth (see docs/reconciliation-source-of-truth.md)
  note: string;
  date: string; // DD/MM/YYYY or ""
  categoryLabel: string; // Food carries the household size
  receipt: string; // receipt fileName or "-"
}

export interface ReportRollup {
  months: [number, number];
  householdSize: number;
  incomeByCategory: Record<GovIncomeCategory, [number, number]>;
  otherIncome: [number, number];
  expenseByCategory: Record<GovExpenseCategory, [number, number]>;
  incomeTotals: [number, number];
  expenseTotals: [number, number];
  foodBreakdown: [FoodLine[], FoodLine[]];
  workingRows: WorkingRow[];
}

export interface FoodLine {
  date: string; // DD/MM/YYYY or ""
  amount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ddmmyyyy = (iso?: string) =>
  iso ? iso.split("-").reverse().join("/") : "";

export function buildReportRollup(input: RollupInput): ReportRollup {
  const { months, householdSize } = input;
  const monthIdx = (m: number): 0 | 1 | null =>
    m === months[0] ? 0 : m === months[1] ? 1 : null;
  const isExpenseIncluded = (id: string) => input.expenseIncluded[id] ?? true;
  const isIncomeIncluded = (id: string) => input.incomeIncluded[id] ?? true;
  const isTransferIncluded = (id: string) =>
    input.transferInclude[id] ?? false;

  const incomeByCategory = Object.fromEntries(
    GOV_INCOME_CATEGORIES.map((c) => [c, [0, 0]]),
  ) as Record<GovIncomeCategory, [number, number]>;
  for (const it of input.income) {
    const i = monthIdx(it.month);
    if (i === null || !isIncomeIncluded(it.lineId)) continue;
    incomeByCategory[it.category][i] += it.amount;
  }

  const otherIncome: [number, number] = [0, 0];
  for (const t of input.transfers) {
    const i = monthIdx(t.month);
    if (i === null || !isTransferIncluded(t.lineId)) continue;
    otherIncome[i] += t.amount;
  }
  for (const c of input.reviewCredits) {
    const i = monthIdx(c.month);
    if (i === null || input.creditRoute[c.lineId] !== "income") continue;
    otherIncome[i] += c.amount;
  }

  const expenseByCategory = Object.fromEntries(
    GOV_EXPENSE_CATEGORIES.map((c) => [c, [0, 0]]),
  ) as Record<GovExpenseCategory, [number, number]>;
  const included = input.expenses.filter((e) => isExpenseIncluded(e.lineId));
  for (const e of included) {
    const i = monthIdx(e.month);
    if (i === null) continue;
    expenseByCategory[e.category][i] += e.amount;
  }
  // Credits the user routed to "expense" are refunds: they reduce שונות so the
  // 23 category cells still sum to the on-screen expense total (user-approved).
  for (const c of input.reviewCredits) {
    const i = monthIdx(c.month);
    if (i === null || input.creditRoute[c.lineId] !== "expense") continue;
    expenseByCategory[GOV_EXPENSE_CATEGORY.Miscellaneous][i] -= c.amount;
  }

  const sum2 = (rec: Record<string, [number, number]>): [number, number] =>
    Object.values(rec).reduce<[number, number]>(
      (a, v) => [a[0] + v[0], a[1] + v[1]],
      [0, 0],
    );
  const incomeSums = sum2(incomeByCategory);
  const incomeTotals: [number, number] = [
    r2(incomeSums[0] + otherIncome[0]),
    r2(incomeSums[1] + otherIncome[1]),
  ];
  const expenseSums = sum2(expenseByCategory);
  const expenseTotals: [number, number] = [r2(expenseSums[0]), r2(expenseSums[1])];

  const foodBreakdown: [FoodLine[], FoodLine[]] = [[], []];
  for (const e of included) {
    const i = monthIdx(e.month);
    if (i === null || e.category !== GOV_EXPENSE_CATEGORY.Food) continue;
    foodBreakdown[i].push({ date: ddmmyyyy(e.date), amount: r2(e.amount) });
  }
  for (const list of foodBreakdown) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  const workingRows: WorkingRow[] = included
    .slice()
    .sort(
      (a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        a.description.localeCompare(b.description, "he"),
    )
    .map((e) => ({
      merchant: e.description,
      amount: r2(e.amount),
      currency: "₪",
      note: "",
      date: ddmmyyyy(e.date),
      categoryLabel:
        e.category === GOV_EXPENSE_CATEGORY.Food
          ? formatFoodCategory(householdSize)
          : e.category,
      receipt: e.receipt || "-",
    }));

  const round2All = (rec: Record<string, [number, number]>) => {
    for (const k of Object.keys(rec)) {
      rec[k] = [r2(rec[k][0]), r2(rec[k][1])];
    }
  };
  round2All(incomeByCategory);
  round2All(expenseByCategory);

  return {
    months,
    householdSize,
    incomeByCategory,
    otherIncome: [r2(otherIncome[0]), r2(otherIncome[1])],
    expenseByCategory,
    incomeTotals,
    expenseTotals,
    foodBreakdown,
    workingRows,
  };
}
```

- [ ] **Consistency check (critical):** the totals produced here MUST equal the step-3 on-screen totals computed at `ReportWizard.tsx:1247-1291` for the same state (income + included transfers + income-routed credits; included expenses − expense-routed credits). Re-read that block and confirm term-by-term.
- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(report): pure category rollup for step-6 generation`

### Task 4: Generic Drive/Sheets helpers in `lib/google.ts`

**Files:**
- Modify: `lib/google.ts`

**Interfaces (produces, consumed by Task 5):**
- `copyDriveFileAsSheet(accessToken, fileId, name, parentId): Promise<string>`
- `createSpreadsheetInFolder(accessToken, name, parentId): Promise<string>` (find-or-create by name)
- `listSheetTabs(accessToken, spreadsheetId): Promise<Array<{ sheetId: number; title: string }>>`
- `getSheetGrid(accessToken, spreadsheetId, tabTitle, unformatted?): Promise<string[][]>`
- `batchWriteCells(accessToken, spreadsheetId, data: Array<{ range: string; values: (string | number)[][] }>): Promise<void>`
- `clearSheetRange(accessToken, spreadsheetId, range): Promise<void>`

**Steps:**
- [ ] **context7 first** (project rule): resolve `googleapis` and query "Drive v3 files.copy convert xlsx to Google Sheet mimeType" + "Sheets v4 values.batchUpdate". Confirm `files.copy` accepts `requestBody.mimeType` for conversion; if it does NOT, fall back to `downloadDriveFile` + `drive.files.create` with `requestBody.mimeType = "application/vnd.google-apps.spreadsheet"` and `media` = the xlsx buffer (conversion-on-upload is definitively supported). Note which path was taken in the task report.
- [ ] Add to `lib/google.ts` (near the other Drive helpers, following their style):

```ts
// Copy a Drive file into a folder, converting it to a native Google Sheet
// (required: the report template is an .xlsx, which Sheets API cannot edit).
export async function copyDriveFileAsSheet(
  accessToken: string,
  fileId: string,
  name: string,
  parentId: string,
): Promise<string> {
  const drive = driveClient(accessToken);
  const res = await drive.files.copy({
    fileId,
    requestBody: {
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    fields: "id",
  });
  return res.data.id!;
}

// Find-or-create a blank native spreadsheet by name inside a folder.
// (ensureSpreadsheet creates only the main app sheet at Drive root.)
export async function createSpreadsheetInFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string> {
  const existing = await findDriveFileInFolder(accessToken, parentId, name);
  if (existing) return existing;
  const drive = driveClient(accessToken);
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [parentId],
    },
    fields: "id",
  });
  return res.data.id!;
}

export async function listSheetTabs(
  accessToken: string,
  spreadsheetId: string,
): Promise<Array<{ sheetId: number; title: string }>> {
  const sheets = sheetsClient(accessToken);
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  return (res.data.sheets ?? []).map((s) => ({
    sheetId: s.properties!.sheetId!,
    title: s.properties!.title!,
  }));
}

// Whole-tab read as a 2D string grid. `unformatted` returns raw numbers
// (needed when comparing totals to computed values); default returns the
// display strings (needed for label anchoring).
export async function getSheetGrid(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  unformatted = false,
): Promise<string[][]> {
  const sheets = sheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle.replace(/'/g, "''")}'`,
    valueRenderOption: unformatted ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
  });
  return (res.data.values ?? []).map((row) => row.map((c) => String(c ?? "")));
}

// Write many discrete ranges in ONE API call (quota-frugal; the report fill
// is a single batch). RAW: numbers stay numbers (template cell formats apply
// the ₪), strings are never reinterpreted (ARCHITECTURE.md §8.3).
export async function batchWriteCells(
  accessToken: string,
  spreadsheetId: string,
  data: Array<{ range: string; values: (string | number)[][] }>,
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

export async function clearSheetRange(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
}
```

- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(google): drive copy-as-sheet, spreadsheet-in-folder, generic cell read/write helpers`

### Task 5: Server generation module — `lib/report/generate.ts`

**Files:**
- Create: `lib/report/generate.ts`

**Interfaces:**
- Consumes: Task 3's `ReportRollup`/`OTHER_INCOME_LABEL`, Task 4's helpers, `ReportFolders` (`lib/report/period.ts`), `HEBREW_MONTHS`/`formatFoodCategory`/`GOV_*` (`lib/types.ts`), `UserSettings`.
- Produces (consumed by Task 6): `generateReportArtifacts(accessToken, args): Promise<GenerateResult>` where:

```ts
export interface GenerateArgs {
  period: ReportPeriod; // { year, month1, month2, folderName }
  folders: ReportFolders;
  rollup: ReportRollup;
  templateId: string; // already resolved (setting → env → default)
}
export interface GenerateResult {
  working: { id: string; url: string };
  report: { id: string; url: string };
}
```

**Implementation spec (write exactly this logic; helper decomposition is the implementer's choice, but keep the module ≤ ~300 lines and comment the anchor rules):**

1. **Constants:**

```ts
export const DEFAULT_REPORT_TEMPLATE_ID = "12gLxQ7ASHXIZnX-Y_MTT_68d3bwL_13B";
export function resolveTemplateId(settings: UserSettings): string {
  return (
    settings.reportTemplate?.id ??
    process.env.SUMOO_REPORT_TEMPLATE_ID ??
    DEFAULT_REPORT_TEMPLATE_ID
  );
}
const WORKING_SHEET_PREFIX = "חישוב תדפיסי בנק";
const REPORT_FILE_PREFIX = "דוח דו-חודשי";
const WORKING_TAB = "חיובים דיירקט";
const DETAILS_TAB = "פירוטים";
const WORKING_HEADERS = ["שם בית עסק", "סכום חיוב", "מטבע חיוב", "פירוט נוסף", "תאריך חיוב", "קטגוריה", "קבלה"];
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;
```

2. **Working spreadsheet:** name `` `${WORKING_SHEET_PREFIX} ${period.folderName}` ``; `createSpreadsheetInFolder` under `folders.periodId`; `ensureNamedTab(token, id, WORKING_TAB)`; `clearSheetRange(token, id, `'${WORKING_TAB}'`)`; one `batchWriteCells` writing `[WORKING_HEADERS, ...rollup.workingRows.map(r => [r.merchant, r.amount, r.currency, r.note, r.date, r.categoryLabel, r.receipt])]` at `'חיובים דיירקט'!A1`. (Note: `createSpreadsheetInFolder` creates a default `Sheet1`/`גיליון1` tab — leave it; deleting costs an extra call and it is harmless in the working file. If trivial, delete it in the same `batchUpdate` as a follow-up polish, but do not add calls.)

3. **Government report:** file name `` `${REPORT_FILE_PREFIX} ${period.folderName}` ``. `findDriveFileInFolder(token, folders.periodId, name)` → reuse if found (regenerate case), else `copyDriveFileAsSheet(token, templateId, name, folders.periodId)`.

4. **Anchor-based fill of the report tab** (the tab whose title contains `דו"ח` — discover via `listSheetTabs`; if exactly two tabs exist use the non-`פירוטים` one; if ambiguous, throw with a clear error message). Read the grid once (`getSheetGrid`, formatted). All coordinates are found by scanning cell text (trimmed), NEVER hardcoded. Build one `batchWriteCells` payload (single API call) containing:
   - **Months/year header:** row containing `בהתייחס לחודשים` at column c → write `HEBREW_MONTHS[month1-1]` at (row, c+1), `HEBREW_MONTHS[month2-1]` at (row, c+2); on the same row find `של שנת` at column c2 → write `period.year` at (row, c2+1).
   - **Block month headers:** in the income header row (contains `הכנסות היחיד/ה`) and the expense header row (contains `הוצאות היחיד/ה`), every cell equal to `חודש` or starting with `חודש ` alternates left-m1, left-m2, right-m1, right-m2 → overwrite with `` `חודש ${HEBREW_MONTHS[mX-1]}` ``. Record the four column indices: `leftCols = [first, second]`, `rightCols = [third, fourth]` (per block; income and expense blocks are scanned independently, income block = rows from its header to the expense header, expense block = rows from its header to the `תאריך:` row).
   - **Income rows:** for each of the 6 `GOV_INCOME_CATEGORIES`, find the row in the income block whose trimmed cell equals the category (any column ≤ leftCols[0]); write `incomeByCategory[cat][0]` / `[1]` to that row at leftCols. Write `""` instead of `0` (keeps the report visually clean and erases stale values on regenerate).
   - **Other income (row 7):** find the income-block row whose cell at the right-block number column (the column of `הכנסות המשך`) equals `7`; write `OTHER_INCOME_LABEL` at the next column and the two `otherIncome` values at rightCols. If both values are 0, write `""` to all three cells.
   - **Expense rows:** for each of the 23 `GOV_EXPENSE_CATEGORIES`, find its row by trimmed equality — **except Food**, matched by `cell.trim().startsWith(GOV_EXPENSE_CATEGORY.Food)`; for Food also overwrite the label cell itself with `formatFoodCategory(rollup.householdSize)`. Left-block labels get leftCols, right-block labels (cell column > left label column region — i.e. column ≥ the `הוצאות המשך` column) get rightCols. Write `""` for 0.
   - **Totals:** rows containing `סה"כ הכנסות` / `סה"כ הוצאות` → after the category batch write, read those 4 cells back **unformatted**; if a read-back value differs from the computed total by > 0.01, include the computed totals in a second small `batchWriteCells`. (The clean template shows `₪ 0.00` — likely `SUM` formulas; this rule preserves formulas when present and guarantees correct totals when not.)
   - **Date:** row containing `תאריך:` at column c → write today's `DD/MM/YYYY` at (row, c+1).
   - **Anonymity check (hard rule):** never write to the rows containing `בעניין: היחיד/ה`, `מס' תיק ממונה`, `כתובת עדכנית`, `טלפון היחיד/ה`, `חתימת היחיד/ה` — these template cells stay blank. No personal detail exists anywhere in this feature's code.
   - **Missing anchors:** if any of the 6+23 category labels, the totals labels, or the header anchors are not found → throw `Error` naming the missing label (surfaces as the route's `{error}`); do not write a partial report.
   - Convert (row, col) indices to A1 via a small local helper (`colA1(c) = letters`, `range = '${tab}'!${colA1(c)}${row+1}`).

5. **פירוטים tab:** clear `'פירוטים'!A3:F` (keep the two header rows), then one `batchWriteCells`:
   - month-1 lines at columns B,C from row 4 (template rows: 1 = `חודש אחד/שתיים`, 2 = `סה"כ כלכלה` sums, 3 = `תאריך/סכום` headers — verify by scanning for the `תאריך` header row and write below it),
   - month-2 lines at columns E,F,
   - the two `סה"כ כלכלה` sum cells: same formula-preserving read-back rule as the totals (write `r2(Σ foodBreakdown[i])` only if read-back mismatches).
   Values: `[line.date, line.amount]` (RAW; dates as strings).

6. Return `{ working: { id, url: sheetUrl(id) }, report: { id: reportId, url: sheetUrl(reportId) } }`.

**Call budget check:** working (find + maybe-create + ensureTab + clear + write = 5) + report (find + maybe-copy + listTabs + grid read + batch write + totals read-back + maybe-totals-write + פירוטים clear + פירוטים write ≈ 7–9). Total ≤ 14 on first run, ≤ 12 on regenerate — acceptable; do not add more calls.

**Steps:**
- [ ] Implement per the spec above.
- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(report): generate working sheet and fill government report from template`

### Task 6: API route — `app/api/report/generate/route.ts`

**Files:**
- Create: `app/api/report/generate/route.ts`

**Interfaces:**
- Consumes: `buildReportRollup`/`RollupInput` (Task 3), `generateReportArtifacts`/`resolveTemplateId` (Task 5), `getUserSettings`, `resolveSpreadsheetId`, `requireAccessToken`, `DEFAULT_HOUSEHOLD_SIZE`.
- Produces: `POST /api/report/generate` with body:

```ts
{
  period: { year: number; month1: number; month2: number; folderName: string };
  folders: ReportFolders;
  rollupInput: Omit<RollupInput, "months" | "householdSize">;
}
```

  → `{ ok: true, working: { id, url }, report: { id, url }, householdSize: number }` or `{ error }`.

**Steps:**
- [ ] Implement:

```ts
import { NextResponse } from "next/server";
import {
  getUserSettings,
  requireAccessToken,
  resolveSpreadsheetId,
} from "@/lib/google";
import { buildReportRollup } from "@/lib/report/rollup";
import {
  generateReportArtifacts,
  resolveTemplateId,
} from "@/lib/report/generate";
import { DEFAULT_HOUSEHOLD_SIZE } from "@/lib/types";
import type { ReportFolders } from "@/lib/report/period";
import type { RollupInput } from "@/lib/report/rollup";
import type { ReportPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface GenerateBody {
  period: ReportPeriod;
  folders: ReportFolders;
  rollupInput: Omit<RollupInput, "months" | "householdSize">;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<GenerateBody>;
    const { period, folders, rollupInput } = body;
    if (
      !period?.year || !period.month1 || !period.month2 ||
      !folders?.periodId || !rollupInput
    ) {
      return NextResponse.json({ error: "חסרים נתוני תקופה" }, { status: 400 });
    }
    const token = await requireAccessToken();
    const spreadsheetId = await resolveSpreadsheetId(token);
    const settings = await getUserSettings(token, spreadsheetId);
    const householdSize = settings.householdSize ?? DEFAULT_HOUSEHOLD_SIZE;
    const rollup = buildReportRollup({
      ...rollupInput,
      months: [period.month1, period.month2],
      householdSize,
    });
    const result = await generateReportArtifacts(token, {
      period,
      folders,
      rollup,
      templateId: resolveTemplateId(settings),
    });
    return NextResponse.json({ ok: true, ...result, householdSize });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
```

  (The 400 error string `חסרים נתוני תקופה` is hereby part of the approved list.)
- [ ] `npm run typecheck` → PASS.
- [ ] Commit: `feat(report): generate API route`

### Task 7: Wizard step-6 UI + progress persistence

**Files:**
- Modify: `components/ReportWizard.tsx` (replace placeholder at ~lines 2254–2259; add state + handler)
- Modify: `lib/report/progress.ts` (persist generation output)

**Interfaces:**
- Consumes: Task 3's `buildReportRollup` (client-side preview), Task 6's route contract.
- Produces: persisted `generated` field on progress.

**Steps:**
- [ ] **progress.ts** — add to BOTH `WizardProgressState` and `ReportProgress` (schemaVersion stays 1; optional field is backward-compatible):

```ts
// Step-6 output: ids/urls of the generated artifacts (null until first generation).
generated: {
  workingId: string; workingUrl: string;
  reportId: string; reportUrl: string;
  generatedAt: string; // ISO
} | null;
```

  Thread it through `serializeProgress`/`hydrateProgress` (`generated: state.generated` / `generated: progress.generated ?? null`).
- [ ] **ReportWizard.tsx** — add state `const [generated, setGenerated] = useState<WizardProgressState["generated"]>(null);`, `const [generating, setGenerating] = useState(false);`, `const [generateError, setGenerateError] = useState<string | null>(null);`, `const [householdSize, setHouseholdSize] = useState<number | null>(null);`. Include `generated` in the progress-state object passed to `useReportProgress` and restore it in the hydrate path (find where `hydrateProgress` output is applied and set all fields symmetrically).
- [ ] On entering step 5 (e.g. `useEffect` on `step === 5`), fetch `/api/settings` once and `setHouseholdSize(json.householdSize ?? 3)`.
- [ ] Compute the preview rollup with `useMemo` (only when `step === 5 && result && pair`):

```ts
const rollup = useMemo(() => {
  if (!result || !pair) return null;
  return buildReportRollup({
    months: [pair.m1, pair.m2],
    expenses,
    income: result.income,
    transfers: result.transfers,
    reviewCredits: result.reviewCredits,
    expenseIncluded, incomeIncluded, transferInclude, creditRoute,
    householdSize: householdSize ?? 3,
  });
}, [result, pair, expenses, expenseIncluded, incomeIncluded, transferInclude, creditRoute, householdSize]);
```

- [ ] Replace the placeholder branch (`ReportWizard.tsx:2254-2259`) with, structurally (reuse `Section`, `Table*`, `Button`, `formatILS`, existing patterns; all strings from the approved list):
  - guard: `!result || !rollup` → `<p>יש לעבד מסמכים תחילה בשלב פירוק וסיווג.</p>` (muted).
  - `Section` `תצוגה מקדימה`: two tables. **הכנסות**: a row per `GOV_INCOME_CATEGORIES` entry (label | month1 | month2, `formatILS`, blank for 0) + an `העברות ואחר` row (only if nonzero) + a bold `סה"כ` row from `rollup.incomeTotals`. **הוצאות**: a row per `GOV_EXPENSE_CATEGORIES` (Food label via `formatFoodCategory(householdSize ?? 3)`) + bold `סה"כ` row. Skip-vs-show zero rows: show all fixed rows (mirrors the gov form).
  - a muted line: `` מס' נפשות: {householdSize ?? 3} `` with a `Link` to `/settings` labeled `שינוי בהגדרות`.
  - generate button: label `הפק דוח` (or `הפק מחדש` when `generated !== null`), disabled while `generating`, spinner text `מפיק…`. onClick:

```ts
async function generateReport() {
  if (!result || !pair || !created || !rollup) return;
  setGenerating(true);
  setGenerateError(null);
  try {
    const res = await fetch("/api/report/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: { year, month1: pair.m1, month2: pair.m2, folderName: created.folderName },
        folders: created.folders,
        rollupInput: {
          expenses,
          income: result.income,
          transfers: result.transfers,
          reviewCredits: result.reviewCredits,
          expenseIncluded, incomeIncluded, transferInclude, creditRoute,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setGenerated({
      workingId: data.working.id, workingUrl: data.working.url,
      reportId: data.report.id, reportUrl: data.report.url,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    setGenerateError((e as Error).message);
  } finally {
    setGenerating(false);
  }
}
```

  - on success (`generated !== null`): `הדוח הופק בהצלחה` + two external links (`<a target="_blank" rel="noreferrer">`): `גיליון עבודה` → `generated.workingUrl`, `דוח דו-חודשי` → `generated.reportUrl`.
  - on error: destructive-styled paragraph `הפקת הדוח נכשלה` + the message.
- [ ] `npm run typecheck` → PASS. Also `npm run lint`.
- [ ] Commit: `feat(report): step-6 UI — preview, generate, artifact links`

### Task 8: Full verification + handoff (orchestrator)

- [ ] `npm run typecheck` && `npm run lint` && `npm run build` — all pass.
- [ ] Design-system greps clean: `grep -rn "rounded-" components/ app/ --include=*.tsx` (no new hits vs dev), `grep -rn "alert(" components/ app/` (none).
- [ ] Diff review vs `dev`: no changes outside the files this plan names; no new dependencies in package.json.
- [ ] **Hand off to the user** (do NOT run the dev server): ask them to run the wizard end-to-end for period `3-4_2026` with the prior docs and verify: (a) step-6 preview totals equal the step-3 summary totals; (b) generated working sheet rows match the on-screen expense table; (c) gov report category cells/totals match the preview and roughly the hand-made reference (`18,566.57 / 18,594.64` income, `19,258.71 / 18,208.57` expenses — exact match depends on their classification edits); (d) Food label shows the configured household size; (e) the `פירוטים` tab lists the per-month food lines and its `סה"כ כלכלה` sums equal the two `כלכלה (מזון)` cells in the report; (f) regeneration overwrites cleanly; (g) the template file remains untouched; (h) no personal detail appears anywhere in the generated files.
- [ ] After user confirmation: PR `feat/report-generate` → `dev` (via `mcp__github__*` tools, not `gh`).

---

## Self-review notes

- Spec coverage: plan-§4.1 artifacts (working sheet + filled gov report in period folder) → Tasks 5; §4.3 `generate.ts` → Task 5; §4.4 route → Task 6; wizard step 6 → Task 7; template-ID open decision → resolved (clean template + setting + env); household size → Tasks 1–3; anonymity → Task 5 anchor rules.
- Deliberately NOT done (out of scope, per spec/user): learned merchant→category map tab (already handled by classify flow), any multi-individual/personal-details handling (obsolete — the report is a single anonymous file; personal details are out of the app's scope), email receipts (Phase B), xlsx-format output (would need a new dependency).
- No test framework exists in this repo; verification is typecheck/lint/build + user E2E (CLAUDE.md forbids agent-side visual/runtime verification). The rollup module's correctness is pinned by the Task 3 consistency check against the step-3 totals code and the user's E2E numbers.
