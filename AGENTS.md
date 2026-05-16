# Project Rules for Claude Code

## Source of Truth
ARCHITECTURE.md is the authoritative blueprint for this template.
Before making any structural decision, re-read the relevant section.
If something isn't covered there, ask — don't improvise.

## Git Workflow
- After completing any meaningful step, commit with a clear message.
- Use conventional commit prefixes: feat:, fix:, chore:, docs:, refactor:
- Never run `git reset`, `git push --force`, or rewrite history without asking.
- Auto-commit hooks are configured in .claude/settings.json — do not disable them.

## Package Versions
- Never trust version numbers from memory or from ARCHITECTURE.md.
- Always verify with `npm view <package> version` before adding to package.json.
- Use latest stable unless I explicitly say otherwise. No beta/rc/next tags.
- If a package has known incompatibility with another (e.g. AntD + React 19),
  warn me before adding it.

---

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