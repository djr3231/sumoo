# Clickable Wizard Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Implementation addendum (2026-07-06):** As shipped, `maxStep` is adjusted
> during render (`if (step > maxStep) setMaxStep(step)`), not via the `useEffect`
> shown in Task 2 — the effect form tripped `react-hooks/set-state-in-effect`
> (commit `8dd74e6`). `discardProgress` also resets it (`setMaxStep(0)`, commit
> `3af0ca1`). See the spec's State section for rationale.

**Goal:** Let the user jump between report-wizard steps by clicking the stepper header, restricted to steps already reached.

**Architecture:** Add a derived `maxStep` state to `ReportWizard.tsx` that tracks the furthest step reached (bumped by an effect keyed on `step`, never lowered). Rework the stepper `<li>` map so each step renders as a `<button>` that navigates via `setStep(i)` when `i <= maxStep`, and is disabled otherwise. No persistence, gate, or resume changes.

**Tech Stack:** Next.js (App Router) client component, React `useState`/`useEffect`, Tailwind with the locked shadcn theme, `cn` class helper.

**Spec:** `docs/superpowers/specs/2026-07-06-clickable-wizard-steps-design.md`

## Global Constraints

- Work in an isolated worktree `C:/Development/sumoo-clickable-steps` on branch `feat/clickable-wizard-steps` off `dev`. Do NOT touch the main dir's `:3000` dev server or its `.next`.
- Real `npm install` in the worktree (NOT a junction/symlink) so `npm run build` works with Turbopack.
- No test runner exists. Verification per task = `npm run typecheck` (PASS) + `npm run lint` (zero NEW errors; the ONLY accepted pre-existing lint error is `components/UploadZone.tsx:135` react-hooks/set-state-in-effect). `npm run build` once before the final commit. Visual behavior is verified by the USER on `:3000` after merge — do NOT run `next dev`/screenshots.
- Design-system tokens ONLY: no `rounded-*`, no palette/raw hex/hsl/oklch colors, no `shadow-md`+. RTL logical utilities where padding/margin is directional. Touch targets ≥ `h-10`.
- No NEW Hebrew UI strings (step labels come from the existing `STEPS` const).
- TypeScript strict; no `any` without a comment.
- Conventional Commits; end each message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git reset`/force-push/rewrite history.

## File Structure

- **Modify:** `components/ReportWizard.tsx`
  - Add `maxStep` state + effect near the existing `step` state (`:268`).
  - Replace the stepper header `<ol>` map (`:953-977`).
- **Include (already written, commit on this branch):** `docs/superpowers/specs/2026-07-06-clickable-wizard-steps-design.md`, `docs/superpowers/plans/2026-07-06-clickable-wizard-steps.md`.

---

### Task 1: Create the isolated worktree

**Files:** none modified (environment setup).

- [ ] **Step 1: Create worktree + branch off dev**

Run from `C:\Development\sumoo`:
```bash
git worktree add C:/Development/sumoo-clickable-steps -b feat/clickable-wizard-steps dev
```
Expected: `Preparing worktree ... HEAD is now at 90c9503 ...`

- [ ] **Step 2: Real npm install in the worktree**

Run from `C:\Development\sumoo-clickable-steps`:
```bash
npm install
```
Expected: completes with no errors; a real `node_modules` directory exists (NOT a junction).

- [ ] **Step 3: Baseline typecheck**

Run from `C:\Development\sumoo-clickable-steps`:
```bash
npm run typecheck
```
Expected: PASS (exit 0), no output errors. This confirms the worktree builds before any change.

---

### Task 2: Add `maxStep` state and tracking effect

**Files:**
- Modify: `components/ReportWizard.tsx` (near `:268`)

**Interfaces:**
- Consumes: existing `const [step, setStep] = useState(0)`.
- Produces: `maxStep: number` — the highest step index reached so far; used by Task 3's stepper render.

- [ ] **Step 1: Add the state and effect**

Immediately after the existing line `const [step, setStep] = useState(0);` (currently `ReportWizard.tsx:268`), add:

```tsx
  // Highest step the user has reached. Derived from `step` (never lowered), so
  // jumping backward keeps every previously-reached step navigable, and resume
  // (which calls setStep(hydrated.step)) lifts this automatically — no need to
  // persist it in WizardProgressState.
  const [maxStep, setMaxStep] = useState(0);
  useEffect(() => {
    setMaxStep((m) => Math.max(m, step));
  }, [step]);
```

Confirm `useEffect` is already imported at the top of the file (it is — used elsewhere). If it were missing, add it to the existing `react` import.

- [ ] **Step 2: Typecheck**

Run from `C:\Development\sumoo-clickable-steps`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

- [ ] **Step 3: Commit**

```bash
git add components/ReportWizard.tsx docs/superpowers/specs/2026-07-06-clickable-wizard-steps-design.md docs/superpowers/plans/2026-07-06-clickable-wizard-steps.md
git commit -m "feat(report): track furthest-reached wizard step

Add derived maxStep state to prepare clickable stepper navigation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Render the stepper as clickable buttons (three states)

**Files:**
- Modify: `components/ReportWizard.tsx` (the `<ol>` at `:953-977`)

**Interfaces:**
- Consumes: `step`, `setStep`, `maxStep` (Task 2), `STEPS`, `cn`.
- Produces: interactive stepper header. No new exports.

- [ ] **Step 1: Replace the stepper `<ol>` block**

Replace the entire block currently at `ReportWizard.tsx:953-977` (from `<ol className="flex flex-wrap gap-2">` through its closing `</ol>`) with:

```tsx
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => {
          const reachable = i <= maxStep;
          const active = i === step;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                disabled={!reachable}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 border px-3 py-2 text-xs transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : reachable
                      ? "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                      : "border-border text-muted-foreground opacity-50 cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center text-[11px] font-semibold",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>
```

Notes for the implementer:
- The active step is intentionally NOT disabled; clicking it calls `setStep(i)` with the current index — a harmless no-op.
- Unreached steps (`i > maxStep`) are `disabled`, so they are keyboard- and pointer-inert; no hover classes are applied to them.
- `min-h-10` gives the ≥40px touch target; `px-3 py-2` and the `size-5` badge match the previous look. No new colors/radii/shadows introduced.

- [ ] **Step 2: Typecheck**

Run from `C:\Development\sumoo-clickable-steps`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

- [ ] **Step 3: Lint**

Run from `C:\Development\sumoo-clickable-steps`:
```bash
npm run lint
```
Expected: zero NEW errors. Only `components/UploadZone.tsx:135` (react-hooks/set-state-in-effect) is an accepted pre-existing error.

- [ ] **Step 4: Build (once, in the worktree)**

Run from `C:\Development\sumoo-clickable-steps`:
```bash
npm run build
```
Expected: `next build` completes successfully (Compiled successfully / route table printed). Do NOT run this in the main dir.

- [ ] **Step 5: Commit**

```bash
git add components/ReportWizard.tsx
git commit -m "feat(report): make wizard stepper steps clickable

Reached steps (0..maxStep) navigate on click; unreached steps are
disabled. Forward-gates remain enforced only via the footer button.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Integration and manual verification (orchestrator)

**Files:** none (git integration).

- [ ] **Step 1: Fast-forward merge into `dev` locally**

From `C:\Development\sumoo` (main dir, on `dev`):
```bash
git merge --ff-only feat/clickable-wizard-steps
```
Expected: fast-forward; `:3000` hot-reloads the change. Do NOT push to `origin/dev` (batch pushes at the very end).

- [ ] **Step 2: Hand off to the user for visual verification**

Ask the user to confirm on `:3000`:
1. Advance a few steps, then click an earlier step in the header — it jumps back.
2. From that earlier step, click a later step that was already reached — it jumps forward.
3. Steps never reached appear faded and do not respond to clicks.
4. Reload / resume a saved report — steps up to the restored step are clickable.

Wait for the user's confirmation before considering the item done. Do NOT delete the `feat/clickable-wizard-steps` branch.

---

## Self-Review

- **Spec coverage:** requirement 1 (click to navigate) → Task 3 button `onClick`; requirement 2 (`0..maxStep`) → Task 2 `maxStep` + Task 3 `reachable`; requirement 3 (disable unreached) → Task 3 `disabled`/`opacity-50`; requirement 4 (gates enforced once, via footer) → no gate code touched, confirmed in Task 3 notes; requirement 5 (tokens, no new strings) → Task 3 className + reused `STEPS`. Resume/autosave/schema unchanged → verified by touching neither. All covered.
- **Placeholder scan:** none — every code step shows full code; every run step shows the command and expected output.
- **Type consistency:** `maxStep` (number), `setMaxStep`, `reachable`/`active` (boolean), `setStep(i)` — consistent across Tasks 2 and 3.
