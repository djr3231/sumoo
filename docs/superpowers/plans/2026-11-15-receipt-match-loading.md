# Receipt Matching Pool Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this focused plan. Steps use checkbox syntax for tracking.

**Goal:** Make receipts available for manual matching/splitting before running automatic matching, including after report resume.

**Architecture:** Keep receipt reads separate from matching. The wizard loads live receipts on matching-step entry and rebuilds its transient pool using current attachment decisions. The explicit match action retains its existing matcher and persistence behavior.

**Tech Stack:** Existing React 19.2.6, TypeScript, Next.js API client; no new packages.

**Spec:** `docs/superpowers/specs/2026-11-15-receipt-match-loading-design.md`

**Branch:** `feat/receipt-match-loading`

**Base:** `198079346d0803bffff97ba67cb6426321e93570` (`dev` at branch creation)

## Global Constraints

- Preserve existing API, progress schema, matching algorithm, theme, and manual decisions.
- Only existing Hebrew copy: `טוען…`, matching labels, and existing error text.
- No new automated tests: repository policy requires user runtime verification.
- Do not start the app or run browser verification. Commit and remote publication require the user's approval.

## Review Focus

- Resume restores attachments before pool reads finish; detaching must wait for usable data.
- A late response after a step/period change must not replace the current pool.
- Re-entering the step must retain a split receipt deliberately left available.
- Edits while reading must be compared against current attachment decisions.
- An initial load failure must display an error and permit a later explicit retry.

## Task 1: Separate pool loading from automatic matching

**Files:** Modify `components/ReportWizard.tsx` only, plus these design/plan records.

**Interfaces:** Consume the existing `/api/report/receipts` response, `Receipt`,
`ReceiptAttachment`, and existing wizard state. Do not change public interfaces.

- [x] Trace resume, pool loading, visibility gates, and detach; confirm only the matcher populates the pool at baseline.
- [x] Obtain user approval for the focused behavior and preserve explicit automatic matching.
- [x] Record baseline typecheck/lint results: typecheck passed; lint reports only the accepted pre-existing `UploadZone.tsx:93` set-state-in-effect error.
- [x] Add a read-only, cancelable matching-step entry load and period-aware pool readiness. Rebuild availability from latest decisions; do not invoke the matcher or set `matchRan`.
- [x] Display receipt sections once the pool is ready, independently of `matchRan`. Disable detach until ready and distinguish loading from matching using existing labels.
- [x] Keep the explicit Match action and let it supersede an entry read; preserve existing split/dismiss/attachment behavior.
- [x] Review the diff independently against the five Review Focus cases; fix the four material findings below in one pass.
- [x] Run static verification. Typecheck exit 0; lint has only the baseline error. Default build rejects the existing external node_modules junction; `npm run build -- --webpack` exit 0. `git diff --check` clean.
- [x] Show the diff and hand runtime verification to the user using the spec's scenarios. Static checks do not establish runtime success.
- [x] Receive user authorization to commit and publish to `dev` after the local verification handoff.
- [ ] Commit this one logical correction as `fix(report): load receipts before automatic matching` and publish to `dev` as explicitly requested.

## Ledger

- Design and scope approved in chat; native implementation of this single surgical task.
- Existing linked worktree reused; branch created from local `dev`, which equals the base commit.
- Baseline: `npm run typecheck` exit 0; `npm run lint` exit 1 with only the accepted `UploadZone.tsx:93` error.
- User approval covers the stated focused behavior and proceeding with implementation; no additional design round is needed.
- Final review: independent read-only review by `receipt_loading_review`; no app or runtime verification performed.
- Final: fixed filename collisions by using saved receipt IDs for pool membership and detach, with filename fallback for legacy progress only.
- Final: fixed cross-period availability leakage by clearing transient receipt/selection state when loading a saved period.
- Final: fixed first-run split availability loss by retaining deliberately available attached receipts outside the automatic matcher's input.
- Final: fixed stale explicit matching reads by cancellation on step/period lifetime changes and by reading latest decisions when merging.
- Final verification: installed React 19.2.6 and Next.js 16.3.1 confirmed; typecheck passed; lint unchanged from baseline; production Webpack build passed. Default Turbopack remains incompatible with the pre-existing node_modules junction; project configuration was not changed.
- Ruling: Repository instructions prohibit new automated tests and agent-run runtime/UI verification, so static checks and the user's manual scenarios replace the skill's default TDD/runtime gates. Behavioral verification remains unconfirmed until the user checks it.
- Local environment setup: copied the existing ignored `.env.local` from the primary checkout and set its local origin; no secrets are tracked.
- User explicitly authorized commit/publication to `dev` after the local verification handoff. No agent-run runtime verification is claimed.
- Pre-publication verification: typecheck passed; lint remains at the single accepted baseline error; Webpack production build is rerun before committing.
