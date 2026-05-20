# Redesign Plan — Sumoo

> **Read this top-to-bottom before doing anything.** This document is written assuming the executor is a model that may be tempted to improvise. Do not improvise. Follow the protocols.

---

## 0. Mandatory pre-read

Before starting any task in this plan, you must read these files in order:

1. `CLAUDE.MD` — project rules. Branch protection, commit discipline, "teach first" rule.
2. `ARCHITECTURE.md` — system architecture, module boundaries, type-system conventions.
3. `DESIGN-SYSTEM.md` — locked theme tokens, allowed shadcn primitives, forbidden patterns.
4. `SESSION-CONTEXT.md` — recent history (read once, skim).
5. This file — execution order.

After reading, **state explicitly in chat**: *"I have read CLAUDE.MD, ARCHITECTURE.md, DESIGN-SYSTEM.md, SESSION-CONTEXT.md, and REDESIGN-PLAN.md. I will follow these rules."*

If you have not done step 0, do not start any task.

---

## 1. The four inviolable rules

These come from the user. They are non-negotiable.

1. **Mobile-first responsive.** Every layout must work at 375px wide. Add larger breakpoints (`sm:`, `md:`, `lg:`) on top. No design starts at desktop and gets squished down.

2. **Always check the theme and existing shadcn components first.** Before adding any new pattern: scan `DESIGN-SYSTEM.md`, list `components/ui/`, and check https://ui.shadcn.com/docs/components. If a primitive exists for the job, use it. Do not roll your own.

3. **Use only the locked theme.** The theme tokens in `DESIGN-SYSTEM.md` §2 are the entire color palette of the project. Do not introduce new tokens, new colors, new fonts. **If you think you need a new token, STOP and ask the user.**

4. **Do not invent textual content.** If you are about to write a Hebrew label, button text, heading, helper text, error message — and the exact wording isn't already in the codebase or in this plan — **STOP and ask the user what to write**. Better to halt and ask than to invent.

These rules override your judgment. When in doubt: stop, ask, wait.

---

## 2. STOP-and-ASK protocol

Use this protocol every time you reach any of these triggers:

| Trigger                                              | Action                                                 |
| ---------------------------------------------------- | ------------------------------------------------------ |
| You're about to write any Hebrew string              | Search codebase first. If not found → **ask**.         |
| You're about to add a new color, font, or radius     | **Ask**. Tell the user which token and why.            |
| You're about to install a non-shadcn library         | **Ask**. State what it does and what alternatives exist. |
| You're about to add an `npm` dep                     | **Ask**. (Per CLAUDE.MD §5.)                           |
| You're about to write CSS in `globals.css`           | **Ask**.                                               |
| You're about to make a UI decision the spec doesn't cover | **Ask**.                                          |
| The current task's acceptance criteria are ambiguous | **Ask**.                                               |
| A `npm run typecheck` or `npm run build` fails       | Read the error, propose a fix, **ask** before applying. |

The question to the user should always include:
- What you're about to do.
- Why you think it's needed.
- What two or three alternatives you considered.

---

## 3. Tooling

### Required MCPs

Before starting, verify the following are connected (`claude mcp list` should show them as `connected`):

- `context7` — for fresh shadcn/Tailwind/Next.js docs.
- `shadcn-ui` (or `shadcn`) — for component install + reference.

### Skills (optional but recommended)

If installed, the following help with design work:

- `frontend-design`
- `taste-skill`

If neither is installed, ask the user if they want them before continuing. Do not silently proceed without them — the user's intent was that you have them.

### Forbidden tooling

Per `CLAUDE.MD` §Visual and Runtime Verification:

- **Do NOT run `npm run dev`, start servers, take screenshots, or attempt visual verification.**
- **You may run** `npm run typecheck`, `npm run lint`, `npm run build`.
- For visual checks: hand off to the user. State exactly what should be checked and the expected result. Wait.

---

## 4. Branching and commit policy

Per `CLAUDE.MD` §Branch Protection: **never work on `main` or `dev`**.

The current redesign work happens on **`feat/redesign-shadcn`**. If the branch you are on is not `feat/redesign-shadcn` (or a child of it), stop and ask.

**Per task:**
- One conceptual change = one commit.
- Conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- Verify `npm run typecheck` passes before committing.
- Verify `npm run build` passes before declaring a page "done".
- Do NOT push to remote until the user confirms a milestone is good.

**Per page in this plan:**
- One feature branch off `feat/redesign-shadcn`? No — the user's preference is that all redesign work lives on `feat/redesign-shadcn` itself. Use commits, not sub-branches.

---

## 5. Execution order

We redesign from **simplest** to **most complex**, building patterns incrementally so each page reinforces what came before. Do not skip ahead.

| Step | Target                          | Why this order                                                       |
| ---- | ------------------------------- | -------------------------------------------------------------------- |
| 5.1  | Foundation (layout, nav, theme) | Touched by every page. Get the shell right first.                    |
| 5.2  | `/settings`                     | One small form. Establish the form pattern.                          |
| 5.3  | `/upload`                       | Drag-drop + list. Slightly more complex, no table yet.               |
| 5.4  | `/` (landing)                   | Sign-in. Simple but visible. Polish.                                 |
| 5.5  | `/receipts`                     | The hard one — table → card-list on mobile, filters, editing.        |
| 5.6  | `/compare`                      | Last. Also table-heavy but less critical.                            |
| 5.7  | Final pass                      | Dark mode toggle (if user wants), accessibility audit, regressions.  |

Inside each step there is a fixed protocol (§6 below).

---

## 6. Per-step protocol (apply to every step)

For each step in §5, execute in order:

### 6.1 Read the relevant existing code

Read every file you might modify and every file that imports from those files. Build a mental map of what the page does **today**.

If the page imports from `lib/types.ts` constants — **those constants stay**. Do not rename, replace, or reorganize them.

### 6.2 Restate the task in your own words

Write a short message to the user:
- "This step touches: [list of files]."
- "Current behavior: [one paragraph]."
- "Target behavior: [one paragraph]."
- "I will not touch: [the API routes / `lib/*` services / `lib/types.ts` constants — unless the step explicitly says otherwise]."

Wait for the user to confirm before doing anything else.

### 6.3 Identify shadcn primitives to use

List every shadcn primitive you plan to use. For each:
- Is it already in `components/ui/`? If yes, use it.
- If no, install it with `npx shadcn@latest add <name>`. Commit the install as a separate `chore: add <name> primitive` commit before using it.

### 6.4 Implement the changes

Small commits. After each meaningful subtask:
- Run `npm run typecheck` — must pass.
- Run `npm run lint` — must pass (or report errors and ask).
- Commit with conventional prefix.

### 6.5 Verify (no visual)

After the page is structurally complete:
- `npm run typecheck` — pass.
- `npm run build` — pass.
- Run the design-system verification greps from `DESIGN-SYSTEM.md` §10.
- State to the user: "Step X is complete. Please verify visually: [exact checklist]."

### 6.6 Wait

Do not proceed to the next step until the user says go.

---

## 7. The steps

### 7.1 Foundation

**Files in scope:**
- `app/layout.tsx`
- `components/Header.tsx`
- `app/globals.css` (read only — do not edit)
- `components/ui/Button.tsx` (already updated by shadcn init; verify only)
- `components/Providers.tsx` (read only — do not edit unless required)

**Goals:**
- Header is mobile-friendly: on viewport < `md`, the nav should collapse into a `Sheet` (slide-out menu) triggered by a hamburger button. On `md+`, nav stays inline as today.
- Footer (optional, ask user before adding).
- Confirm the body font is correct (read `app/layout.tsx`; do not change the font without asking).
- Ensure `<html dir="rtl" lang="he">` is preserved.

**Shadcn primitives needed:**
- `sheet` (`npx shadcn@latest add sheet`).
- Possibly `button` (already installed; verify variants).

**Acceptance criteria:**
- At 375px width, Header shows: logo, hamburger button on the trailing side, no inline nav.
- Tap hamburger → Sheet opens from the start side (RTL: right) with nav links stacked vertically + user email + sign-out.
- At `md+` width, Header looks like today (per existing `Header.tsx`).
- All current nav links present: העלאה, קבלות, השוואה, הגדרות.
- No hardcoded text added; reuse existing strings from `Header.tsx`.

**Hand off to user:** "Foundation done. Please verify: open the app on a phone (or DevTools at 375px), confirm hamburger nav works. Open at desktop, confirm nav is inline. Confirm no regression on auth state (signed out shows sign-in, signed in shows nav)."

---

### 7.1.5 Cross-cutting foundation (run before §7.2)

Three project-wide patterns must be in place before per-page work continues. Each is a separate commit.

#### 7.1.5.a — Dark mode toggle

- `npm i next-themes` *(~2 KB. Industry standard for Next.js dark-mode. Handles SSR hydration without flash, persists via localStorage.)*
- `components/Providers.tsx`: wrap `<SessionProvider>` with `<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>` from `next-themes`.
- New file `components/ThemeToggle.tsx` (client): `useTheme()`, lucide `Sun` + `Moon` icons, `<Button variant="ghost" className="size-10 p-0">`. `aria-label="החלף ערכת נושא"` with `sr-only` text. Toggles between `"light"` and `"dark"` only — no `system`.
- `components/Header.tsx`: place the toggle in the desktop right-cluster (next to email/sign-out) AND inside the mobile Sheet (after nav links, before sign-out).
- Default theme = **dark** (user decision; no `prefers-color-scheme` auto-follow).

**Verification:** load `/`, page is dark on first paint (no white flash); click toggle, page flips to light; reload, choice persists.

#### 7.1.5.b — Messaging foundation (replace every `alert()`)

- `npm i sonner` *(~5 KB. shadcn's official toast since v3, theme-aware via `richColors`.)*
- `components/Providers.tsx`: add `<Toaster richColors position="top-center" dir="rtl" />` inside the ThemeProvider tree.
- New file `components/ui/Alert.tsx` written manually (shadcn CLI registry auth is broken for this repo — see `SESSION-CONTEXT.md`). API: `<Alert variant="default" | "destructive">` + `<AlertTitle>` + `<AlertDescription>`. Tokens only: `border border-border bg-background` (default), `border-destructive text-destructive` (destructive). Single CVA, no rounded.
- **Replace every `alert()` call** (find with `grep -rn "alert(" components/ app/ --include='*.tsx'` — currently 6 sites):

  | File:line | Replace with |
  |-----------|--------------|
  | `components/ReceiptTable.tsx:136` (dedup error) | `toast.error("שגיאה: " + (j.error \|\| r.status))` |
  | `components/ReceiptTable.tsx:152` (dedup multi-line success) | `toast.success(msg)` — keep the existing `msg` string verbatim |
  | `components/ReceiptTable.tsx:277` (fix-drive-ids error) | `toast.error("שגיאה: " + (j.error \|\| r.status))` |
  | `components/ReceiptTable.tsx:278` (fix-drive-ids success) | `toast.success(...)` — preserve existing message string |
  | `components/DriveImport.tsx:57` (folder load fail) | `toast.error(json.error \|\| "שגיאה בטעינת התיקייה")` |
  | `components/CompareView.tsx:63` (statements saved) | `toast.success("נשמר ל-tab התנועות בגיליון.")` |

- **Inline field validation** — replace any "alert on submit" pattern with inline error text under the field (`<p className="text-xs text-destructive mt-1">`):
  - `SettingsForm.tsx` — already has `draftError`. Polish: add `aria-describedby` linking the input to the helper text. No new strings.
  - `DriveImport.tsx` folder-id input — add `required`; if `folderId.trim() === ""` on submit, show inline error and skip the fetch. **STOP-and-ASK** the user for the exact error string (suggested: "הדבק קישור או מזהה תיקייה").
  - `CompareView.tsx` file input — before parse, validate file MIME (csv/xlsx/pdf); on mismatch show inline error. **STOP-and-ASK** for the exact error string.

**Verification:** `grep -rn "alert(" components/ app/ --include='*.tsx'` → zero matches. Simulate a 500 from `/api/dedup` → `toast.error` appears with server message.

#### 7.1.5.c — Pretty loaders

No new deps.

- New file `components/ui/Skeleton.tsx`: `<div className="animate-pulse bg-muted">` wrapper. `animate-pulse` is built into Tailwind v3 — no plugin needed.
- Replace every plain `<p>טוען…</p>` with shape-matched Skeletons:

  | File:line | Today | Replace with |
  |-----------|-------|--------------|
  | `SettingsForm.tsx:85` | `<p>טוען...</p>` | 2–3 chip-shaped Skeletons (`h-8 w-20`) inside `flex gap-2 flex-wrap` |
  | `ReceiptTable.tsx:323-324` | `<p>טוען...</p>` | 6 row-shaped Skeletons (`h-10 w-full`) inside the table container |
  | `DriveImport.tsx:182` | `<p>טוען תיקייה וקבצים קיימים...</p>` | 3–4 row Skeletons + keep the existing label as `sr-only` for screen readers |

- **Button spinner pattern** — `Loader2` from `lucide-react` with `className="animate-spin size-4 me-2"` (RTL-aware margin). Apply while in-progress state is true:
  - `UploadZone` "התחל סריקה" while `running`
  - `DriveImport` "טען תיקייה" while `loadingFolder`, scan buttons while `running`
  - `CompareView` "פרסר והשווה" while `loading`
  - `SettingsForm` "שמור" while `saving`
  - `ReceiptTable` dedup + fix-drive-ids buttons while their respective state is true

**Verification:** every loading state shows shape-matched Skeleton or button spinner; zero bare "טוען…" text remains.

**Files touched during §7.1.5:**
- New: `components/ThemeToggle.tsx`, `components/ui/Alert.tsx`, `components/ui/Skeleton.tsx`
- Modified: `package.json` (next-themes, sonner), `components/Providers.tsx`, `components/Header.tsx`, `components/ReceiptTable.tsx`, `components/DriveImport.tsx`, `components/CompareView.tsx`, `components/SettingsForm.tsx`, `components/UploadZone.tsx`

**STOP-and-ASK triggers in §7.1.5:**
- Writing any new Hebrew string not already in the codebase or in this section (specifically the two inline-validation strings flagged above).
- Adding a `size="icon"` variant to `Button` — defer; use `className="size-10 p-0"` workaround.
- Any deviation from `defaultTheme="dark"` / `enableSystem={false}`.

**Hand off to user:** "§7.1.5 complete. Please verify: dark theme on first paint, toggle persists across reload, every failure path shows a toast not an alert, every loading state shows a skeleton or button spinner. Confirm before I start §7.2."

---

### 7.2 `/settings`

**Files in scope:**
- `app/settings/page.tsx`
- `components/SettingsForm.tsx`

**Out of scope (do not touch):**
- `app/api/settings/route.ts`
- `lib/google.ts:getUserSettings` / `writeUserSettings`
- `lib/types.ts` (`SETTINGS_KEY`, `UserSettings`)

**Goals:**
- Replace the current ad-hoc form with shadcn primitives.
- The chip-list of card last-4 stays — that's the core UX.
- Add visible validation messaging.
- Layout: at mobile width, full width. At `md+`, max-width container.

**Shadcn primitives needed:**
- `card` (`npx shadcn@latest add card`).
- `input`, `label` (`npx shadcn@latest add input label`).
- `button` (already installed).
- `badge` for the chips (`npx shadcn@latest add badge`).

**Acceptance criteria:**
- Page is contained inside a `Card` with `CardHeader` (title + description) and `CardContent` (the form).
- Input is shadcn's `Input` with `Label` above it.
- Add button uses `Button`.
- Each chip is a shadcn `Badge` with a small `×` button on the trailing side.
- "שמור" button at the bottom of `CardContent` (or in `CardFooter`, ask user which).
- All existing strings preserved verbatim from current `SettingsForm.tsx` — do not invent new copy.
- Empty state preserved.
- Validation error rendering uses muted-foreground text below the input, no raw red — use `text-destructive` token.
- (per §7.1.5) SettingsForm uses Skeleton on initial load; "שמור" button shows `Loader2` spinner while `saving`; save success → `toast.success("נשמר ✓")` instead of the inline "נשמר ✓" indicator.

**Hand off:** "Settings page redone with shadcn. Please verify: add a 4-digit card, remove it, save, refresh — state persists. Mobile view OK. No new strings introduced."

---

### 7.3 `/upload`

**Files in scope:**
- `app/upload/page.tsx`
- `components/UploadZone.tsx`
- `components/DriveImport.tsx`

**Out of scope:**
- `app/api/ocr/route.ts`
- `app/api/drive/route.ts`
- All `lib/*` services

**Goals:**
- Make the drop zone visually obvious as a target (dashed border using `border-dashed border-border`, large hit area).
- Reorganize the page: two sections, "העלאה ישירה" (current uploader) and "ייבוא מ-Drive" (current DriveImport), separated visually.
- Progress UI: use shadcn's `Progress` component, not the custom div.
- Use `Alert` for the "Gemini overloaded" pause state.

**Shadcn primitives needed:**
- `card`
- `progress` (`npx shadcn@latest add progress`)
- `alert` (`npx shadcn@latest add alert`)
- `input` (for the folder ID input)
- `button`

**Acceptance criteria:**
- Both upload and Drive-import sections sit inside `Card`s.
- Drop zone visually distinct — dashed border, centered icon + label.
- On mobile, sections stack vertically; on `md+`, can sit side-by-side (or stay stacked — ask user).
- Progress bar uses `<Progress value={pct} />`.
- Error banner uses `<Alert variant="destructive">`.
- Pause banner uses `<Alert>` (default).
- All existing user-visible strings preserved exactly.
- (per §7.1.5) Every scan button shows `Loader2` spinner during work; `alert()` in `DriveImport.tsx` is gone (replaced with `toast.error`); folder-id input has inline validation.

**Hand off:** "Upload page redone. Please verify: upload a small image works end-to-end, Drive import works, error state appears correctly. Mobile responsive."

---

### 7.4 `/` (landing)

**Files in scope:**
- `app/page.tsx`

**Goals:**
- Center a sign-in card. Title, one-line description, sign-in button.
- That's it. Do not add marketing copy without asking.

**Shadcn primitives needed:**
- `card`, `button`.

**Acceptance criteria:**
- Vertically and horizontally centered card.
- Title is whatever the current `app/page.tsx` uses.
- No new strings.

**Hand off:** "Landing redone. Please verify: visit `/` while signed out, sign in works."

---

### 7.5 `/receipts` — the hard one

**Files in scope:**
- `app/receipts/page.tsx`
- `components/ReceiptTable.tsx`

**Out of scope:**
- `lib/types.ts` constants (column definitions, enums)
- `lib/google.ts`
- `app/api/sheets/route.ts`
- `app/api/dedup/route.ts`
- `app/api/fix-drive-ids/route.ts`

**Goals:**
This is the most complex page. We rebuild it in three subtasks, each its own commit:

#### 7.5.a Desktop table → shadcn `Table`

- Replace the raw `<table>` with shadcn `Table` (`npx shadcn@latest add table`).
- Headers, body rows, cells all using shadcn primitives.
- Filter inputs use shadcn `Input`.
- Category/payment/document dropdowns use shadcn `Select` (`npx shadcn@latest add select`).
- Manually-edited cells use shadcn `Input` or `Select` consistently.
- "Reviewed" toggle uses shadcn `Checkbox`.

#### 7.5.b Mobile card-list

At viewport `< md`, the table is **replaced** (not shrunk) with a card list. Each receipt becomes a `Card` showing:
- Store name (heading)
- Amount (large, prominent)
- Date (small, muted)
- Category + payment method as `Badge`s
- A "View details" / "Edit" expand action — uses shadcn `Drawer` (`npx shadcn@latest add drawer`) for editing on mobile.

Use `hidden md:block` / `block md:hidden` to swap presentations.

**Ask the user:** what should the card show by default, and what should be hidden behind the drawer? Default proposal: store, amount, date, category, payment. Drawer reveals all 15 fields for editing. **Get approval before implementing.**

#### 7.5.c Action toolbar

The current page has buttons for: dedup, fix-drive-ids, CSV export, XLSX export. On desktop: a horizontal toolbar. On mobile: a shadcn `DropdownMenu` (`npx shadcn@latest add dropdown-menu`) labeled "פעולות" so it doesn't crowd the screen.

Filters that today are dispersed in headers should:
- Desktop: stay in headers.
- Mobile: a "מסננים" button that opens a `Sheet` with all filters.

**Acceptance criteria:**
- All existing functionality preserved: inline edit, filter, dedup button, fix-drive-ids button, CSV + XLSX export.
- All existing labels preserved verbatim.
- `npm run build` passes.
- Run all DESIGN-SYSTEM grep checks — clean.
- (per §7.1.5) Initial table load shows 6 row-shaped Skeletons; dedup + fix-drive-ids buttons show `Loader2` spinner; results surface as toast (success/error); inline cell edits remain inline — no toast/alert per edit.

**Hand off:** "Receipts page redone. Please verify (desktop + mobile): inline edit a row, change a category, run dedup, run fix-drive-ids, export CSV, export XLSX. All should match prior behavior."

#### 7.5.d Mobile filter Sheet — redesign (supersedes §7.5.c filter)

**Why this exists:** §7.5.c shipped (commit `f889464`) with a broken mental model. Each filterable column rendered every unique value as a toggle `Button` chip (`variant={active ? "default" : "outline"}`). The handler, when `colFilters[col.key]` was `undefined`, *initialized the Set with every value* (`new Set(values)`) and then removed the clicked one. Net effect: tap one chip → every *other* chip flips to "default" variant, looking selected, while the one you tapped goes "outline". The semantic was "filter-out" but the visual screamed "select these" — inverted, unintuitive, unusable.

We replace it with the canonical shadcn "product-list-filters" pattern (ref: `shadcndesign.com/pro-blocks/product-list-filters`): collapsible facets, checkbox rows, additive selection (empty = no filter), selection summary, sticky footer.

**Component graph:**

```
Sheet (side="right" on mobile, "left" makes more sense in RTL — use side="right" anyway,
       the Sheet primitive handles RTL via dir="rtl" on <html>)
├─ SheetTrigger: Button "מסננים" + Badge with active-filter count
├─ SheetContent (flex flex-col, h-full, max-w-sm)
│  ├─ SheetHeader: SheetTitle "מסננים" + (right-aligned) Button ghost "נקה הכל"
│  │                                       (visible only if any filter active)
│  ├─ (optional) Selected-summary row: flex flex-wrap of <Badge variant="secondary"> chips,
│  │              one per active value, each with a small X to remove. Hidden when nothing selected.
│  ├─ ScrollArea (flex-1, overflow-y-auto, p-4)
│  │  └─ Accordion type="multiple" defaultValue={facets with active filters}
│  │     └─ AccordionItem per filterable column (one per COLUMNS.filter(c=>c.filterable))
│  │        ├─ AccordionTrigger:
│  │        │     <span>{col.label}</span>
│  │        │     {active>0 && <Badge variant="secondary">{active}</Badge>}
│  │        └─ AccordionContent:
│  │           └─ vertical list of:
│  │              <Label className="flex items-center gap-2 py-1.5 cursor-pointer">
│  │                <Checkbox checked={set?.has(v) ?? false} onCheckedChange={...} />
│  │                <span className="flex-1 truncate">{v || "(ריק)"}</span>
│  │                <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
│  │              </Label>
│  └─ SheetFooter (sticky, border-t, bg-background, p-4, gap-2):
│     ├─ SheetClose asChild: Button "החל" (default variant) — closes sheet
│     └─ Button variant="ghost" "סגור" — also closes (escape hatch)
└─ end
```

**State semantics (the part that was wrong):**

`colFilters[key]` is a `Set<string>` of **explicitly included** values.

| State | Meaning |
|-------|---------|
| `colFilters[key]` is `undefined` (key absent) | No filter on this column — all values pass |
| `colFilters[key]` is empty Set (`size === 0`) | No filter — same as undefined (cleanup to undefined) |
| `colFilters[key]` has N values | Show only rows where the column equals one of those N values |

Handler logic (replace the broken `new Set(values)` initializer):

```ts
function toggleFilterValue(key: SortKey, v: string) {
  setColFilters((prev) => {
    const cur = prev[key];
    const next = cur ? new Set(cur) : new Set<string>();  // start EMPTY, not full
    if (next.has(v)) next.delete(v);
    else next.add(v);
    if (next.size === 0) {
      const { [key]: _drop, ...rest } = prev;
      return rest;
    }
    return { ...prev, [key]: next };
  });
}
```

**Visual rules:**

- Checked checkbox = value is included in the filter. Period. No "inverted" mode.
- A facet with zero checked items behaves identically to a facet that's never been touched — no filter applied.
- Trigger button shows `<Badge>` with `Object.values(colFilters).reduce((n, s) => n + (s?.size ?? 0), 0)`. Hide the badge if 0.
- AccordionItem header shows the per-facet count badge (only when > 0). Items with active filters auto-expand on Sheet open.

**Counts next to each value:**

```ts
const valueCounts: Record<string, Record<string, number>> = useMemo(() => {
  const out: Record<string, Record<string, number>> = {};
  for (const col of COLUMNS.filter((c) => c.filterable)) {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const v = col.getValue(r);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    out[col.key] = counts;
  }
  return out;
}, [rows]);
```

Use these inside the AccordionContent rows. Counts reflect the *unfiltered* row count for the given value — they don't recompute as the user toggles other facets (that adds a lot of complexity and slows scroll; not worth it here).

**Sort dropdown — small fix while you're here:**

The existing "מיין לפי" `DropdownMenu` has two real bugs:
1. The direction `DropdownMenuRadioGroup` has an early-return `if (!sort) return;` — the user can't pick a direction before picking a key. Remove the guard: store dir even with no key (`useState<{ key: SortKey | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" })`).
2. Labels `"A→Z" / "Z→A"` are misleading for numbers/dates/booleans. Replace with `"עולה" / "יורד"`.

**Out of scope for §7.5.d:**

- Desktop column-header sort+filter panels (`openCol` panel logic) — keep unchanged.
- Refactoring `colFilters` semantics elsewhere — the broken handler exists only in the mobile Sheet block.
- Real-time recomputation of counts as filters interact — explicit non-goal.

**New shadcn primitives needed:**

- `Accordion` — `npx shadcn@latest add accordion` (registry is auth-broken for this repo — write manually following the shadcn source: `@radix-ui/react-accordion` + the four wrapper components, tokens-only styling, no animation deps beyond `data-[state=open]`).
- `ScrollArea` — optional; if Sheet body already scrolls cleanly with `overflow-y-auto`, skip. Add only if scroll feels janky.
- `Badge` — already installed (§7.2).
- `Checkbox` — already installed (§7.5.a).
- `Label` — already installed (§7.2).

**Files modified:**

- `components/ReceiptTable.tsx` — replace the mobile Sheet body block (currently lines ~470-520 in the post-§7.5.c file), the `toggleFilterValue` handler, and the sort DropdownMenu guard/labels.
- `components/ui/Accordion.tsx` — new.

**Acceptance criteria:**

- Tap one value in any facet → only rows matching that value remain. Tap a second value in the same facet → both pass (OR within facet). Tap a value in a different facet → AND across facets.
- Untap the last value in a facet → that facet's filter clears (no rows lost from facets touched).
- Trigger button shows badge with total selected count. Badge hidden at 0.
- Open Sheet a second time → facets that had selections are still expanded; others stay collapsed.
- "נקה הכל" in header empties `colFilters` and collapses everything.
- Sort dropdown: can pick "עולה / יורד" before picking a column; A→Z / Z→A strings gone from codebase.
- Existing desktop column-header behavior unchanged.
- `npm run build` passes; design-system greps clean.

**Hand off:** "Mobile filter Sheet redesigned. Please verify on a real phone: open סינון, tap values across multiple facets, watch the table narrow correctly, hit נקה הכל, confirm reset. Then verify sort dropdown lets you change direction without first picking a column."

---

### 7.6 `/compare`

**Files in scope:**
- `app/compare/page.tsx`
- `components/CompareView.tsx`

**Out of scope:**
- `lib/match.ts`, `lib/parsers.ts`
- `app/api/match/route.ts`, `app/api/statements/route.ts`

**Goals:**
- Same patterns as `/receipts`: shadcn `Table` on desktop, card list on mobile.
- File-upload input uses shadcn `Input type="file"` inside a `Card`.

**Acceptance criteria:**
- Existing functionality preserved.
- Mobile responsive.
- (per §7.1.5) File input has inline validation (file MIME/extension check before parse); parse button shows `Loader2` spinner while `loading`; save action surfaces as toast.

**Hand off:** "Compare page redone. Please verify: upload a sample statement, match against receipts, see results."

---

### 7.7 Final pass

After all pages are individually done:

1. **Cross-page audit.** Click through every nav link at 375px and at 1280px. Note any regressions.
2. **Theme audit.** Run all greps in `DESIGN-SYSTEM.md` §10. All should be empty (or match only the allowed exceptions).
3. **Build + typecheck.** Both must pass.
4. ~~**Ask the user about dark mode.** Do they want a toggle? If yes: `npx shadcn@latest add theme-toggle` (or follow shadcn dark-mode docs) — install + wire it up. If no, do nothing.~~ *(Resolved in §7.1.5.a: dark by default, toggle wired into Header.)*
5. **Accessibility quick pass.** Every interactive element has a label, `aria-label`, or text content. Every input has a `Label`.

---

## 8. What you must NEVER do during the redesign

- Touch files under `lib/` (except reading).
- Touch files under `app/api/` (except reading).
- Touch `lib/types.ts` (the const enums are the API).
- Modify Hebrew domain values (the receipt categories, document types, payment methods).
- Rename existing data fields.
- Add new server-side logic.
- Add tracking, analytics, telemetry.
- Reformat unrelated files.
- "Improve" code outside the page being redesigned.

If you find a bug in code that's out of scope, **note it for the user; do not fix it in the redesign commit.**

---

## 9. Definition of done (whole redesign)

The redesign is "done" when **all** of the following are true:

- [ ] `npm run typecheck` passes on `feat/redesign-shadcn`.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] All five greps in `DESIGN-SYSTEM.md` §10 are clean (no unexpected matches).
- [ ] Every page works at 375px width.
- [ ] Every page works at 1280px width.
- [ ] User has signed off on each page (`/settings`, `/upload`, `/`, `/receipts`, `/compare`).
- [ ] All `SESSION-CONTEXT.md`-listed flows still work: scan a receipt, edit a row, dedup, fix-drive-ids, export, settings save, bank match.
- [ ] No new strings exist in the codebase that the user did not approve.
- [ ] No new colors, fonts, or radii exist beyond the locked theme.

---

## 10. Quick reference

- Theme tokens: `DESIGN-SYSTEM.md` §2
- Allowed primitives: `components/ui/` + https://ui.shadcn.com/docs/components
- Install primitive: `npx shadcn@latest add <name>`
- Verification greps: `DESIGN-SYSTEM.md` §10
- Branch: `feat/redesign-shadcn` (never `main`, never `dev`)
- Commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Verification commands you can run: `npm run typecheck`, `npm run lint`, `npm run build`
- Verification commands you cannot run: `npm run dev`, anything that starts a server
- When in doubt: **stop and ask the user.**
