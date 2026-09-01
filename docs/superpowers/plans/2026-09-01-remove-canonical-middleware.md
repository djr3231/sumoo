# Remove Canonical-Domain Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unnecessary application-level canonical-domain redirect while preserving the verified `www.chewie.ceo` OAuth configuration.

**Architecture:** Vercel remains responsible for the apex-to-www redirect, and NextAuth uses the Production-only `NEXTAUTH_URL` to construct Google OAuth URLs. The application no longer inspects or redirects request hosts.

**Tech Stack:** Next.js 16, NextAuth.js v4, Vercel, Google OAuth

**Spec:** `docs/superpowers/specs/2026-09-01-remove-canonical-middleware-design.md`

## Global Constraints

- Work on `feat/remove-canonical-middleware`, based on `dev` commit `795f6d0`.
- Do not change NextAuth session, cookie, token-refresh, or toast behavior.
- Do not change Vercel or Google Console settings from repository code.
- Do not add packages or automated test files.
- Production `NEXTAUTH_URL` is exactly `https://www.chewie.ceo` and is Production-only.
- The Google callback URL is exactly `https://www.chewie.ceo/api/auth/callback/google`.
- Vercel owns the `chewie.ceo` to `www.chewie.ceo` 307 redirect.
- Runtime verification belongs to the user; do not start the application or perform visual verification.

---

### Task 1: Remove application host canonicalization

**Files:**
- Delete: `middleware.ts`
- Modify: `.env.local.example`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: Vercel Production domain configuration and `NEXTAUTH_URL`.
- Produces: An application with no request-host redirect middleware and documentation matching the deployed configuration.

- [ ] **Step 1: Delete the canonical-domain middleware**

Delete `middleware.ts` in full. Do not replace it with a Next.js proxy or another
host-routing mechanism.

- [ ] **Step 2: Correct the environment example**

Keep the local value unchanged and replace the Production guidance with:

```dotenv
# In Production, set NEXTAUTH_URL to the public custom origin:
# https://www.chewie.ceo
# Register this exact callback in Google Console:
# https://www.chewie.ceo/api/auth/callback/google
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 3: Correct the deployment runbook in README.md**

The runbook must state these exact responsibilities:

```text
Vercel: chewie.ceo redirects to www.chewie.ceo with status 307.
Vercel Production environment: NEXTAUTH_URL=https://www.chewie.ceo.
Google Console callback: https://www.chewie.ceo/api/auth/callback/google.
The generated sumoo.vercel.app address is not the public entry point.
```

Remove the explanation that `middleware.ts` prevents a split-host OAuth flow.

- [ ] **Step 4: Correct the hosting contract in ARCHITECTURE.md**

Replace the application-middleware ownership description with the platform
contract:

```text
The public Production origin is https://www.chewie.ceo. Vercel owns the
chewie.ceo to www.chewie.ceo 307 redirect. NextAuth receives
NEXTAUTH_URL=https://www.chewie.ceo in Production only, and Google Console
registers https://www.chewie.ceo/api/auth/callback/google. The application does
not canonicalize request hosts.
```

- [ ] **Step 5: Verify documentation consistency**

Run:

```powershell
rg -n -i "NEXTAUTH_URL|middleware\.ts|chewie\.ceo|sumoo\.vercel\.app" README.md ARCHITECTURE.md .env.local.example
```

Expected:

- Production examples use `https://www.chewie.ceo`.
- No text claims that `middleware.ts` redirects hosts.
- `sumoo.vercel.app` is described only as a non-public generated alias.

- [ ] **Step 6: Run non-interactive verification**

Run:

```powershell
npm run typecheck
npm run lint
npm run build
```

Expected: all three commands exit successfully. A static pass does not establish
runtime correctness.

- [ ] **Step 7: Review and commit the logical change**

Show the complete diff and verification output to the user. After explicit commit
approval, run:

```powershell
git add -- middleware.ts .env.local.example README.md ARCHITECTURE.md
git commit -m "fix(auth): remove canonical-domain middleware"
```

- [ ] **Step 8: Hand off runtime verification**

The user publishes the branch through the normal PR flow and verifies:

```text
chewie.ceo redirects once to www.chewie.ceo.
/api/auth/providers advertises www.chewie.ceo URLs.
Google sign-in returns to www.chewie.ceo without an expired-token error.
A Preview deployment remains on its Preview host.
```

Do not mark runtime behavior verified until the user confirms these results.
