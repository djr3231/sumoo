# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck   # tsc --noEmit — run before every commit
npm run lint        # eslint . — one accepted pre-existing warning: UploadZone.tsx:138
npm run build       # next build — gate at the end of a task batch
npm run dev         # dev server — do NOT run it yourself (see Visual and Runtime Verification below)
```

There is no test suite. Verification = typecheck + lint + build; visual/runtime E2E is always handed to the user.

## Architecture Snapshot

Full details live in ARCHITECTURE.md — this is the orientation summary. **Caveat:** ARCHITECTURE.md's file map and API list predate the report wizard; `lib/report/`, `app/report/`, `components/report/`, `components/ReportWizard.tsx`, `/api/report`, and `/api/scan-context` exist in code but not in that document. Trust the code for those.

- **Stack:** Next.js (App Router) + React 19, TypeScript strict, Tailwind v4 + shadcn (locked preset, RTL, radius 0), NextAuth Google OAuth, Gemini for OCR/dedup. RTL Hebrew PWA deployed on Vercel; prod deploys from `main`.
- **No database.** Each user's Google Sheets file is the datastore (tabs: קבלות, תנועות, חנויות, הגדרות). The app holds no state between requests; every mutation writes to Sheets/Drive in the same request. Google API usage must stay frugal (test-account quota: 60 Sheets requests/min).
- **Three layers, one direction:**
  1. `lib/types.ts` — every enum, Hebrew domain string, sheet tab name, and column header is declared here once. No I/O, no imports from other lib modules.
  2. `lib/*.ts` services — one module per integration: `google.ts` is the **only** file that imports `googleapis`; `ai.ts` owns all Gemini prompts/schemas; `parsers.ts`, `match.ts`, `places.ts`, `auth.ts`, `utils.ts`. `lib/report/*` is the bi-monthly insolvency-report pipeline (rollup → reconcile → generate → pdf, plus progress tracking).
  3. `app/api/*/route.ts` — thin HTTP orchestration: `runtime = "nodejs"`, auth via `requireAccessToken()` (never `getServerSession` directly), try/catch with `{ error }` JSON envelopes. Client components (`components/`) fetch `/api/*` only — Google credentials never reach the browser.
- **Load-bearing invariants:** no inline Hebrew domain literals outside `lib/types.ts` (exception: `lib/ai.ts` prompts and pure-presentation UI labels); exhaustive `switch` with no `default` over const enums; column A (UUID) always filled (`values.append` is gap-sensitive); `valueInputOption: "RAW"` for settings writes; Gemini response schemas built from `Object.values(ENUM)`; report output is anonymous — personal details only in the user-initiated PDF, never in code/Sheets/logs.
- **Adding things:** ARCHITECTURE.md §11 has file-by-file recipes (new column, new setting, new tab, new API route, new payment method).

## Source of Truth
ARCHITECTURE.md is the authoritative blueprint for this template.
Before making any structural decision, re-read the relevant section.
If something isn't covered there, ask — don't improvise.

For design / UI work, **DESIGN-SYSTEM.md** is the locked source of truth for
theme tokens, allowed shadcn primitives, and forbidden patterns. Never introduce
a new color, font, radius, or custom CSS without checking DESIGN-SYSTEM.md first.

For the ongoing redesign, **REDESIGN-PLAN.md** defines the execution order and
per-page acceptance criteria. Follow its STOP-and-ASK protocol exactly.

The bi-monthly insolvency report wizard (**הכנת דוח דו-חודשי**, six steps ending in
הפק דוח + נפק PDF) is **COMPLETE and in production** (2026-07-13). **INSOLVENCY-REPORT-PLAN.md**
is retained as the historical feature spec; the step-6 and PDF-export execution
specs/plans live under **docs/superpowers/plans/** and **docs/superpowers/specs/**.
Hard rules that OUTLIVE the feature: report anonymity (personal details only in the
user-initiated PDF output file, never in code/Sheets/progress/logs), the approved-
Hebrew-strings discipline, and the temp-copy-deleted-in-`finally` pattern in
`lib/report/pdf.ts`.

## Planning & Execution Workflow (how big features get built here)

Large features are built as a **chain of handoff plans**, not one mega-plan:

1. **Plan with the strongest model** (Fable): brainstorm → design/spec
   (`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`) → implementation plan
   (`docs/superpowers/plans/YYYY-MM-DD-<topic>.md`), both committed. Plan-authoring is
   never delegated to agents.
2. **Execute with cheap subagents**: the orchestrating session (Opus) runs
   `superpowers:subagent-driven-development` — one **Sonnet** implementer per task,
   implementers do **NOT commit**; the orchestrator reviews the report AND the diff,
   runs `npm run typecheck` itself, then commits. Small surgical fixes may be done
   directly by the orchestrator (diff always shown).
3. **Follow-up work found during E2E** (bugs, calibration, polish) becomes the next
   spec+plan in the chain, on the same feature branch when it belongs to the feature.
4. **Cross-session continuity**: the SDD progress ledger
   (`.superpowers/sdd/progress.md`, git-ignored) is the recovery map — tasks marked
   complete there are DONE; resume from the first incomplete task. Plans embed the
   base commit and branch so a fresh session can pick up mid-chain.
5. **STOP-and-ASK** on any ambiguity, template surprise, or Hebrew string not in the
   plan's approved list. Verification gate per task: typecheck + lint (accepted
   pre-existing: UploadZone.tsx:138) + build at batch end; visual/runtime E2E is
   always handed to the user.

## Shadcn Configuration (locked)
The project's shadcn theme was generated with:

```
npx shadcn@latest init --preset b1tzID8AS --template next --rtl --pointer
```

- Preset: **`b1tzID8AS`** (registered theme on https://ui.shadcn.com/create)
- `--radius: 0` (sharp corners — never add `rounded-*`)
- RTL enabled
- Full theme token list: see DESIGN-SYSTEM.md §2

Never change theme tokens, the preset, or the font without explicit user approval.

## Git Workflow
- After completing any meaningful step, commit with a clear message.
- Use conventional commit prefixes: feat:, fix:, chore:, docs:, refactor:
- Never run `git reset`, `git push --force`, or rewrite history without asking.
- Auto-commit hooks are configured in .claude/settings.json — do not disable them.

## Package Versions
- **Always use latest stable versions.** Before starting any major feature or redesign, run `npm outdated` to identify stale packages.
- Never trust version numbers from memory or from ARCHITECTURE.md.
- Always verify with `npm view <package> version` before adding to package.json.
- Use latest stable unless I explicitly say otherwise. No beta/rc/next tags.
- When upgrading, check compatibility between packages (e.g. React 19 + ecosystem, Next.js major upgrades). Warn before any breaking change.
- If a package has known incompatibility with another (e.g. AntD + React 19), warn me before adding it.

## Tool usage rules
- Before implementing anything with an external library/API
  (shadcn, Next.js, Tailwind, Anthropic SDK, etc.), call the
  `context7` MCP first to fetch the latest docs. Don't rely on memory.
- Before any GitHub action, use `mcp__github__*` tools — never `gh` CLI.
- Before non-trivial code search, prefer the `Explore` subagent over ad-hoc grep.

## Working Style

### 1. Small Steps
Work incrementally. Every change must be small, focused, and independently testable.
Never combine multiple concepts or features in a single step. Leave room for errors —
assume something will go wrong, and make it easy to recover.

### 2. Branch Protection — CRITICAL
**NEVER work on `main`/`master' or `dev`.** Every feature gets its own dedicated branch.

- If asked to do any work while on `main` or `dev`, **refuse**.
- Instead, ask the user for a short feature name and create a new branch before doing anything.
- Branch naming convention: `feat/<short-description>` (e.g. `feat/login-screen`)

### 3. Git Discipline
Every completed step must be committed so it can be independently undone without breaking the rest of the code.
- One logical change = one commit. Never bundle unrelated changes.
- Always verify the code builds/runs before committing.
- Use **Conventional Commits** format for all commit messages:
  - `feat:` — new feature or functionality
  - `fix:` — bug fix
  - `chore:` — setup, config, tooling (no production code change)
  - `docs:` — documentation only
  - `refactor:` — restructuring without behavior change

### 4. Teach First, Code Second
Before using any new library, tool, pattern, or concept:
1. Explain **what it is** in plain language
2. Explain **why we're using it** for this project
3. Mention **what the main alternatives are** and why we're not using them
4. Then, and only then, write the code

### 5. No Silent Dependencies
Never add a library, package, or external dependency without:
- Explaining what it does
- Getting explicit confirmation from the user

### 6. Test Before Commit
Always verify the app builds and runs (or that tests pass) before committing a step.
If a step can't be tested yet, say so explicitly — don't silently skip verification.

---

## Git Workflow Summary

```
main          ← stable, never commit directly here
  └── dev     ← integration branch, never commit directly here
        └── feat/your-feature  ← always work here
```

---

## Commit Message Examples:

```
chore: add project rules and conventions
feat: add main activity layout
fix: correct button click handler
refactor: extract network call to repository class
```

## Visual and Runtime Verification
- Do NOT run `npm run dev`, start the app, take screenshots, or attempt
  to visually verify UI changes. These actions consume excessive tokens
  and slow the workflow.
- For verification of changes that produce visible output, hand off to me:
  state clearly what should be checked, what the expected result is, and
  wait for my confirmation before proceeding.
- You MAY run non-interactive checks: `npm run typecheck`, `npm run lint`,
  `npm run build`. These are fast and produce text output suitable for
  your context.
- If a build/typecheck/lint passes but visual behavior is uncertain, hand
  off to me — don't try to "verify by running".

## Code Standards
- TypeScript strict mode. No `any` without a comment explaining why.

## Language
Respond to me in Hebrew when I write in Hebrew, English when I write in English.
Code, comments, commit messages, and file contents: English only.