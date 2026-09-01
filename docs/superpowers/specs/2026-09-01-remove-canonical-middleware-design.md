# Remove Canonical-Domain Middleware Design

**Date:** 2026-09-01
**Branch:** `feat/remove-canonical-middleware`
**Base commit:** `795f6d0`

## Context

Production is intentionally served from `https://www.chewie.ceo`. Vercel owns the
`chewie.ceo` to `www.chewie.ceo` 307 redirect, while the generated
`sumoo.vercel.app` domain remains attached to the Production environment.

The Google sign-in incident was recovered by correcting deployment configuration
and redeploying a revision that predates `middleware.ts`:

- Production `NEXTAUTH_URL` is `https://www.chewie.ceo` and is not exposed to
  Preview environments.
- Google Console registers
  `https://www.chewie.ceo/api/auth/callback/google`.
- Vercel system environment variables are exposed to the application.
- `/api/auth/providers` advertises `www.chewie.ceo` sign-in and callback URLs.
- A live Google sign-in through `www.chewie.ceo` succeeds without the expired-token
  error.

This evidence makes canonical-host middleware unnecessary for the incident. The
middleware also duplicates Vercel domain routing and previously created a redirect
loop when its configured canonical host disagreed with Vercel's apex-to-www
redirect.

## Decision

Delete `middleware.ts` and keep domain ownership at the platform boundary:

- Vercel owns the apex-to-www redirect.
- NextAuth owns OAuth action and callback URL construction through the Production
  `NEXTAUTH_URL` value.
- Google Console owns the list of authorized callback URLs.
- The application does not redirect hosts.

The generated `sumoo.vercel.app` address remains a separate production alias. It is
not treated as the public entry point and is not guaranteed to redirect to the
custom domain. If canonicalization is required later, it should be configured as a
Vercel domain redirect rather than reintroduced as application middleware.

## Scope

- Delete `middleware.ts`.
- Update `.env.local.example`, `README.md`, and `ARCHITECTURE.md` so they describe
  the deployed configuration and no longer claim that application middleware owns
  canonical redirects.
- Keep `https://www.chewie.ceo` as the exact Production origin in documentation.

## Out of Scope

- Changes to NextAuth session, cookie, refresh-token, or error-toast logic.
- Changes to Google OAuth scopes or credentials.
- Changes to Vercel project settings from the repository.
- Preview-deployment OAuth support.
- New packages or automated test files.

## Verification

Static verification:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- A repository search confirms there are no stale claims that `middleware.ts`
  performs canonical redirects and no Production example uses the apex domain as
  `NEXTAUTH_URL`.

Runtime verification is performed by the user after deployment:

1. `https://chewie.ceo` redirects once to `https://www.chewie.ceo`.
2. `https://www.chewie.ceo/api/auth/providers` advertises only `www.chewie.ceo`
   sign-in and callback URLs.
3. Google sign-in starts and finishes on `www.chewie.ceo` without an expired-token
   error.
4. A Preview deployment does not redirect to Production.
