# Design System — Sumoo

> **Locked.** This file is the source of truth for the design system. The theme, the spacing scale, the primitives — they were chosen, registered, and locked. **Do not edit values in this file unless the user explicitly asks.** When in doubt about a styling choice, **read this file before improvising.**

---

## 1. How the design system was installed

The project's shadcn configuration was generated with a registered preset on https://ui.shadcn.com/create:

```bash
npx shadcn@latest init --preset b1tzID8AS --template next --rtl --pointer
```

- **`--preset b1tzID8AS`** — the registered theme preset. Tokens come from this preset, not from defaults.
- **`--template next`** — Next.js App Router scaffolding.
- **`--rtl`** — right-to-left support for Hebrew.
- **`--pointer`** — adds the cursor-pointer rule on interactive elements.

If for any reason `app/globals.css` is regenerated from scratch, run the exact command above. Do not run `init` with different flags.

---

## 2. Theme tokens — **locked**

These are the only color tokens that exist in the project. Reference them as Tailwind classes (`bg-background`, `text-foreground`, `border-border`, etc.). **Never** write raw hex, hsl, or oklch values inline in components.

### Light (`:root`)

```
--background:         oklch(1 0 0)
--foreground:         oklch(0.148 0.004 228.8)
--card:               oklch(1 0 0)
--card-foreground:    oklch(0.148 0.004 228.8)
--popover:            oklch(1 0 0)
--popover-foreground: oklch(0.148 0.004 228.8)
--primary:            oklch(0.488 0.243 264.376)
--primary-foreground: oklch(0.97 0.014 254.604)
--secondary:          oklch(0.967 0.001 286.375)
--secondary-foreground: oklch(0.21 0.006 285.885)
--muted:              oklch(0.963 0.002 197.1)
--muted-foreground:   oklch(0.56 0.021 213.5)
--accent:             oklch(0.963 0.002 197.1)
--accent-foreground:  oklch(0.218 0.008 223.9)
--destructive:        oklch(0.577 0.245 27.325)
--border:             oklch(0.925 0.005 214.3)
--input:              oklch(0.925 0.005 214.3)
--ring:               oklch(0.723 0.014 214.4)
--chart-1:            oklch(0.865 0.127 207.078)
--chart-2:            oklch(0.715 0.143 215.221)
--chart-3:            oklch(0.609 0.126 221.723)
--chart-4:            oklch(0.52 0.105 223.128)
--chart-5:            oklch(0.45 0.085 224.283)
--radius:             0
--sidebar:            oklch(0.987 0.002 197.1)
--sidebar-foreground: oklch(0.148 0.004 228.8)
--sidebar-primary:    oklch(0.546 0.245 262.881)
--sidebar-primary-foreground: oklch(0.97 0.014 254.604)
--sidebar-accent:     oklch(0.963 0.002 197.1)
--sidebar-accent-foreground:  oklch(0.218 0.008 223.9)
--sidebar-border:     oklch(0.925 0.005 214.3)
--sidebar-ring:       oklch(0.723 0.014 214.4)
```

### Dark (`.dark`)

```
--background:         oklch(0.148 0.004 228.8)
--foreground:         oklch(0.987 0.002 197.1)
--card:               oklch(0.218 0.008 223.9)
--card-foreground:    oklch(0.987 0.002 197.1)
--popover:            oklch(0.218 0.008 223.9)
--popover-foreground: oklch(0.987 0.002 197.1)
--primary:            oklch(0.424 0.199 265.638)
--primary-foreground: oklch(0.97 0.014 254.604)
--secondary:          oklch(0.274 0.006 286.033)
--secondary-foreground: oklch(0.985 0 0)
--muted:              oklch(0.275 0.011 216.9)
--muted-foreground:   oklch(0.723 0.014 214.4)
--accent:             oklch(0.275 0.011 216.9)
--accent-foreground:  oklch(0.987 0.002 197.1)
--destructive:        oklch(0.704 0.191 22.216)
--border:             oklch(1 0 0 / 10%)
--input:              oklch(1 0 0 / 15%)
--ring:               oklch(0.56 0.021 213.5)
--chart-1:            oklch(0.865 0.127 207.078)
--chart-2:            oklch(0.715 0.143 215.221)
--chart-3:            oklch(0.609 0.126 221.723)
--chart-4:            oklch(0.52 0.105 223.128)
--chart-5:            oklch(0.45 0.085 224.283)
--sidebar:            oklch(0.218 0.008 223.9)
--sidebar-foreground: oklch(0.987 0.002 197.1)
--sidebar-primary:    oklch(0.623 0.214 259.815)
--sidebar-primary-foreground: oklch(0.97 0.014 254.604)
--sidebar-accent:     oklch(0.275 0.011 216.9)
--sidebar-accent-foreground:  oklch(0.987 0.002 197.1)
--sidebar-border:     oklch(1 0 0 / 10%)
--sidebar-ring:       oklch(0.56 0.021 213.5)
```

> **`--radius: 0`** is intentional. The whole UI is sharp-cornered. Do not add `rounded-*` utility classes unless the user explicitly asks for a specific element.

---

## 3. Adding a shadcn component

Use the official CLI. Never copy code from somewhere else:

```bash
npx shadcn@latest add <component-name>
```

After install, the file lands at `components/ui/<name>.tsx`. Check it in to git. **Do not edit shadcn-generated files manually** unless the user asks — the value of shadcn is that components are predictable and can be re-fetched with the same CLI.

### How to know which component to use

1. Look at https://ui.shadcn.com/docs/components for the canonical list.
2. If a primitive exists for what you need, **use it** — don't reinvent.
3. If nothing fits and you think you need a custom primitive, **STOP and ask the user.**

### Components currently installed

Read live: `ls components/ui/`.

Whatever is in that folder is what's available. If you need something not there, add it via `npx shadcn@latest add <name>` and commit it as a separate `chore: add <name> primitive` commit before using it.

---

## 4. Styling rules

### 4.1 Color usage

| Use case                          | Tailwind class                              |
| --------------------------------- | ------------------------------------------- |
| Page background                   | `bg-background`                             |
| Primary text                      | `text-foreground`                           |
| Secondary/muted text              | `text-muted-foreground`                     |
| Card surfaces                     | `bg-card text-card-foreground`              |
| Popover surfaces                  | `bg-popover text-popover-foreground`        |
| Borders and dividers              | `border-border`                             |
| Form inputs                       | `bg-input` (background) `border-input`      |
| Focus rings                       | `ring-ring`                                 |
| Primary CTA                       | `bg-primary text-primary-foreground`        |
| Secondary action                  | `bg-secondary text-secondary-foreground`    |
| Subtle accent                     | `bg-accent text-accent-foreground`          |
| Destructive action                | `bg-destructive text-destructive-foreground` |

**Forbidden:**
- Raw hex/hsl/oklch values in className (`bg-[#fff]`, `text-[hsl(...)]`, etc.).
- Tailwind's default palette (`bg-blue-500`, `text-gray-700`, etc.) — those bypass the theme.
- Custom CSS variables that aren't in the locked list above.

### 4.2 Spacing

Use Tailwind's default scale (`p-1`, `gap-4`, `space-y-6`, etc.). Standard increments:

| Density | Class      | Use                       |
| ------- | ---------- | ------------------------- |
| Tight   | `gap-1`    | inline icon + label       |
| Default | `gap-2`    | most flex/grid layouts    |
| Loose   | `gap-4`    | top-level sections        |
| Section | `gap-6/8`  | between major page blocks |

**Forbidden:** arbitrary values like `gap-[13px]`. If you genuinely need an off-scale value, **ask first.**

### 4.3 Typography

The font is whatever was installed at `app/layout.tsx` via `next/font`. **Do not change the font without asking.**

Typography classes — use Tailwind's defaults:

| Role            | Class               |
| --------------- | ------------------- |
| Page title (h1) | `text-2xl font-bold` |
| Section (h2)    | `text-xl font-semibold` |
| Subsection (h3) | `text-lg font-semibold` |
| Body            | (default)           |
| Small/caption   | `text-sm text-muted-foreground` |
| Numbers         | add `tabular-nums` for tables/amounts |

### 4.4 Borders and radius

`--radius` is `0`. Use `border` / `border-t` / etc. as needed. **No `rounded-*` classes** unless the user explicitly approves one for a specific element (e.g., maybe avatars, but ask).

### 4.5 Shadows and elevation

Use `shadow-sm` for very subtle separation only. Default is no shadow — surfaces are separated by `border-border`. **Do not** use `shadow-md` or above without asking.

---

## 5. Layout primitives

### 5.1 Page shell

Pages live under `app/<route>/page.tsx` and render inside the `<main>` in `app/layout.tsx`:

```tsx
<main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
  {/* page content */}
</main>
```

Page-level structure:

```tsx
<div className="space-y-4">
  <header>
    <h1 className="text-2xl font-bold">...</h1>
    <p className="text-sm text-muted-foreground">...</p>
  </header>
  {/* page body */}
</div>
```

### 5.2 Cards / sections

Use shadcn's `Card`, `CardHeader`, `CardContent`, `CardFooter` (`npx shadcn@latest add card`). Don't roll your own card with raw borders.

### 5.3 Forms

Use shadcn's `Form` + `react-hook-form` + `zod` (`npx shadcn@latest add form input label`). Don't write `<input>` directly — wrap in shadcn's `Input` component.

---

## 6. Mobile-first responsive rules

Every component must be readable and operable on a phone-sized viewport (375px wide) before any larger breakpoint is considered. The progression:

```
default (mobile)
  → sm:  (≥ 640px)  tablet portrait
  → md:  (≥ 768px)  tablet landscape
  → lg:  (≥ 1024px) desktop
  → xl:  (≥ 1280px) large desktop
```

**Rules:**
- Write the mobile layout first (no breakpoint prefix). Add `sm:` / `md:` / `lg:` to scale up.
- Long horizontal tables on mobile must collapse into a card-list view. Use `hidden md:table-cell` / `md:hidden` to swap presentations.
- Touch targets must be at least `h-10` (40px). Don't make icon-only buttons smaller than `size-10`.
- Inputs must be at least `h-10`.
- Avoid horizontal scrollbars at 375px width. If a component requires scrolling, use a `Drawer` or `Sheet` (`npx shadcn@latest add drawer sheet`).

---

## 7. Dark mode

The theme has full dark-mode tokens. The dark mode is **opt-in via `.dark` class on `<html>` or a parent element**. There is no auto-detect via `prefers-color-scheme` in the locked theme — that was the old behavior, removed by the new preset.

If the user wants a theme toggle, install `npx shadcn@latest add theme-provider` and follow shadcn docs. Until they ask, don't add a toggle.

---

## 8. RTL specifics

- `<html dir="rtl">` is set in `app/layout.tsx`.
- Use logical Tailwind utilities where they exist: `ps-*` (padding-start), `pe-*` (padding-end), `ms-*` / `me-*` for margins, `start-*` / `end-*` for positioning. These respect RTL.
- For Hebrew + Latin mixed content, set `dir="auto"` on the relevant element.
- Numbers (amounts, card last-4s) should always render LTR: wrap in `<span dir="ltr">...</span>` if a Hebrew sentence contains them.

---

## 9. Forbidden patterns (exhaustive)

| ❌ Forbidden                                  | ✅ Use instead                       |
| --------------------------------------------- | ----------------------------------- |
| Inline hex/hsl/oklch (`bg-[#fff]`)            | Theme tokens (`bg-background`)      |
| Default Tailwind palette (`bg-blue-500`)      | Theme tokens                        |
| Custom CSS in `globals.css`                   | Tailwind utilities                  |
| `rounded-*` (any value)                       | Square corners (the theme is `0`)   |
| `shadow-md` / `shadow-lg` / `shadow-xl`       | `border-border` or `shadow-sm`      |
| Arbitrary spacing (`p-[13px]`)                | Tailwind scale (`p-3`, `p-4`)       |
| Custom `<input>` / `<button>`                 | shadcn `Input` / `Button`           |
| Inline Hebrew domain values (`"קבלה"`)       | Constants from `lib/types.ts`       |
| Editing `components/ui/*` manually            | Re-fetch via shadcn CLI             |
| Changing theme tokens                         | **STOP. ASK THE USER.**             |
| New fonts                                     | **STOP. ASK THE USER.**             |

---

## 10. Verification commands

Run these from the repo root to verify the design system is being respected:

```bash
# No raw color values in components/app
grep -rn '#[0-9a-fA-F]\{3,8\}\|hsl(\|oklch(' app components --include='*.tsx' --include='*.ts' | grep -v 'globals.css'

# No tailwind default palette
grep -rn 'bg-\(red\|blue\|green\|yellow\|gray\|slate\|zinc\|neutral\|stone\|orange\|amber\|lime\|emerald\|teal\|cyan\|sky\|indigo\|violet\|purple\|fuchsia\|pink\|rose\)' app components --include='*.tsx'

# No rounded utilities
grep -rn 'rounded-' app components --include='*.tsx' --include='*.ts'

# No shadow above sm
grep -rn 'shadow-\(md\|lg\|xl\|2xl\)' app components --include='*.tsx'

# No inline Hebrew domain values (should only match lib/types.ts and lib/ai.ts)
grep -rn '"לא ידוע"\|"קבלה"\|"כפילות"\|"ספח אשראי"' app components --include='*.tsx' --include='*.ts'
```

Any non-empty output (outside the allowed exceptions) is a regression.
