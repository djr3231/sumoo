# Design: Clickable wizard steps (report-wizard batch #4)

**Date:** 2026-07-06
**Branch (implementation):** `feat/clickable-wizard-steps` off `dev`
**Component:** `components/ReportWizard.tsx`

## Goal

Let the user jump between report-wizard steps by clicking the stepper header,
instead of scrolling to the footer חזור/המשך buttons. Jumping is allowed to any
step already reached; steps not yet reached stay disabled.

## Confirmed requirements

1. Clicking a step header navigates to that step.
2. Navigation is allowed for any step `0 .. maxStep` (the furthest step reached).
3. Steps `> maxStep` are visually disabled and non-interactive.
4. The forward-gates (`cardGapBlocking` at step 2, `cashGapBlocking` at step 4)
   are enforced **only on first forward advance** via the footer "המשך" button.
   Once a step has been reached, clicking the stepper to return to it is allowed
   even if its gate would currently block — i.e. a gate is passed once.
5. Design-system tokens only. No new Hebrew UI strings (labels come from `STEPS`).

## Current code (for reference)

- Step state: `const [step, setStep] = useState(0)` — `ReportWizard.tsx:268`.
- Stepper header: `<ol className="flex flex-wrap gap-2">` at `:953-977`; each
  `STEPS[i]` renders as a non-interactive `<li>` with two visual states
  (active `border-primary` vs. inactive `border-border text-muted-foreground`),
  height `px-3 py-2 text-xs`.
- Resume path: `setStep(hydrated.step)` at `:398-399`.
- Save-on-transition effect keyed on `[step, result, matchRan, matchGeneration]`
  at `:811` — a stepper jump autosaves for free (no new save logic needed).
- Footer forward-gate: `disabled={(step === 2 && cardGapBlocking) || (step === 4 && cashGapBlocking)}`
  at `:1987`.

## Design

### State: `maxStep` (derived, not persisted)

Add (shipped form — React's "adjust state while rendering" pattern, not an effect):

```ts
const [maxStep, setMaxStep] = useState(0);
if (step > maxStep) {
  setMaxStep(step);
}
```

- `maxStep` only ever increases; jumping backward does not lower it, so all
  previously-reached steps stay reachable (requirement 2/4).
- **Not added to `WizardProgressState`.** On resume, `setStep(hydrated.step)`
  already fires, and the render-time adjustment above lifts `maxStep` to the
  hydrated step on the next render. This keeps the persistence schema
  (`lib/report/progress.ts`) and the Sheets write payload unchanged — no extra
  Google-quota cost.
- **Start-fresh reset also clears it:** `discardProgress` calls `setMaxStep(0)`
  alongside `setStep(0)`, so a restart re-disables previously-reached steps.
- Alternative considered and rejected: persist `maxStep` in progress. Rejected
  as redundant (derivable from `step`) and as needless schema/quota surface.

> **Note (implementation):** the plan originally specified a `useEffect`-based
> derivation. During implementation it was replaced with the render-time
> adjustment shown above (commit `8dd74e6`) because the effect form tripped the
> `react-hooks/set-state-in-effect` lint rule; the render-time form is React's
> canonical pattern for this case and avoids a one-frame stale-disabled window.

### Stepper header: three visual states

Replace the two-state `<li>` map with three states. Each item is `min-h-10`
(≥40px touch target) for a uniform, tappable row.

| State | Condition | Rendering |
|-------|-----------|-----------|
| Active | `i === step` | Current styling (`border-primary text-foreground`, badge `bg-primary text-primary-foreground`). Add `aria-current="step"`. |
| Reached (clickable) | `i <= maxStep && i !== step` | `<button onClick={() => setStep(i)}>` with hover affordance (`hover:border-primary hover:text-foreground`), `cursor-pointer`. Keyboard-accessible natively. |
| Unreached (disabled) | `i > maxStep` | `disabled` attribute, `opacity-50 cursor-not-allowed`, non-interactive. |

Structure: keep the `<ol>`/`<li>` wrapper; the interactive element becomes a
`<button type="button">` inside each `<li>` (or the `<li>` content rendered as a
button). Active and unreached items render as a non-interactive element (or a
`disabled` button) so only reached, non-active steps respond to clicks.

### Behavior notes

- No change to footer buttons or the gate logic — gates keep enforcing forward
  progress on first advance (requirement 4).
- No change to resume, autosave, or the progress schema.

## Out of scope

- Persisting `maxStep`.
- Any change to gate enforcement semantics.
- New Hebrew strings, new colors/radii/shadows.

## Verification

- `npm run typecheck` — PASS.
- `npm run lint` — zero new errors (pre-existing `UploadZone.tsx:135` allowed).
- Manual (user, on :3000): reach step N, jump back to an earlier step by
  clicking, confirm forward steps `<= maxStep` remain clickable and steps
  `> maxStep` are disabled; confirm resume restores clickability up to the
  restored step.
