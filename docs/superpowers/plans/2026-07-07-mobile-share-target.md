# Mobile Share Target (PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Implementation addendum (2026-07-07):** Task 5's `useSharedFiles` shipped as a
> CALLBACK, not a returned `File[]`: `useSharedFiles(onFiles: (files: File[]) => void): void`,
> consumed in `UploadZone` as `useSharedFiles((shared) => setFiles((prev) => [...prev, ...shared]))`
> (commit `20e9c9f`). The original return-`File[]`-then-`useEffect` form (shown in
> Task 5 below) tripped `react-hooks/set-state-in-effect`; the callback form calls
> `onFiles` from inside the hook's own effect via a latest-ref, so there is no
> consumer-side effect and no lint suppression. See the spec's unit-4 for the
> shipped shape.

**Goal:** Let the OS share sheet send image/PDF files into sumoo, landing them in the existing `/upload` scan queue.

**Architecture:** A `share_target` in the manifest points a POST/multipart share to `/share-target`; a minimal, share-only service worker (`public/sw.js`) intercepts that POST, stashes the files in a dedicated Cache Storage bucket, and 303-redirects to `/upload?shared=1`; a `useSharedFiles` hook reads the cache on `/upload` and merges the files into `UploadZone`'s existing `files` queue. No offline caching, no npm deps, no TWA.

**Tech Stack:** Web App Manifest, Service Worker + Cache Storage (web-platform standard), Next.js 16 App Router, React client hook. Verified against web.dev "receive shared files" (context7).

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-share-target-design.md`

## Global Constraints

- Work in an isolated worktree `C:/Development/sumoo-share-target` on branch `feat/share-target` off `dev`. Do NOT touch the main dir's `:3000` dev server or its `.next`.
- Real `npm install` in the worktree (NOT a junction/symlink) so `npm run build` works with Turbopack.
- No test runner exists. Verification = `npm run typecheck` (PASS) + `npm run lint` (zero NEW errors; the ONLY accepted pre-existing lint error is `components/UploadZone.tsx:135` react-hooks/set-state-in-effect) + `npm run build` (worktree only). Real behavior is verified by the USER on the deployed HTTPS PWA — do NOT run `next dev`/screenshots; SW/share-target need HTTPS, not `:3000` over LAN.
- No new npm dependency. No PWA framework (next-pwa/serwist).
- The service worker MUST be share-only: it handles ONLY `POST /share-target` and calls `respondWith` for nothing else, so it cannot intercept/caching-break normal navigation.
- `SHARE_CACHE` cache name is the string `"sumoo-shared-files"`, hardcoded identically in `public/sw.js` and `lib/use-shared-files.ts` (the SW file cannot import from `lib/`).
- Shared files merge into `UploadZone`'s `files` state (the drop/scan queue), NOT `pendingFiles` (the retry queue).
- No new Hebrew UI strings. Accepted share types: `image/*` and `application/pdf` (matches the dropzone `accept`).
- TypeScript strict, no `any`. Conventional Commits; end each message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git reset`/force-push.

## File Structure

- **Modify:** `public/manifest.json` — add `share_target` + `scope`.
- **Create:** `public/sw.js` — minimal share-only service worker (plain JS, not TypeScript; served statically at `/sw.js`).
- **Create:** `components/ServiceWorkerRegister.tsx` — client component that registers `/sw.js`; renders `null`.
- **Modify:** `app/layout.tsx` — mount `<ServiceWorkerRegister />`.
- **Create:** `lib/use-shared-files.ts` — `useSharedFiles(): File[]` hook.
- **Modify:** `components/UploadZone.tsx` — consume the hook, merge into `files`.
- **Include (already written, commit on this branch):** the spec + this plan under `docs/superpowers/`.

---

### Task 1: Create the isolated worktree

**Files:** none modified (environment setup).

- [ ] **Step 1: Create worktree + branch off dev**

Run from `C:\Development\sumoo`:
```bash
git worktree add C:/Development/sumoo-share-target -b feat/share-target dev
```
Expected: `Preparing worktree ... HEAD is now at <dev tip> ...`.

- [ ] **Step 2: Real npm install in the worktree**

Run from `C:\Development\sumoo-share-target`:
```bash
npm install
```
Expected: completes with no errors; a real `node_modules` (NOT a junction).

- [ ] **Step 3: Baseline typecheck**

Run from `C:\Development\sumoo-share-target`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

---

### Task 2: Declare the share target in the manifest

**Files:**
- Modify: `public/manifest.json`

**Interfaces:**
- Produces: a `share_target` posting multipart files (field name `files`) to `/share-target`; consumed by the service worker in Task 3.

- [ ] **Step 1: Add `scope` and `share_target`**

In `C:/Development/sumoo-share-target/public/manifest.json`, add a top-level
`"scope": "/",` (e.g. right after the `"start_url": "/upload",` line) and a
`share_target` block. The file currently ends after the `icons` array; insert the
`share_target` as a new top-level key. Final relevant shape:

```json
{
  "name": "סומו · סורק קבלות",
  "short_name": "סומו",
  "description": "סריקת קבלות אישית והשוואה לבנק/אשראי",
  "start_url": "/upload",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "lang": "he",
  "dir": "rtl",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "share_target": {
    "action": "/share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "files": [
        { "name": "files", "accept": ["image/*", "application/pdf"] }
      ]
    }
  }
}
```

Keep the existing icon entries as they are (the compact form above is illustrative
— do not reformat the icons if that would churn the diff; only ADD `scope` and
`share_target`).

- [ ] **Step 2: Validate JSON**

Run from `C:\Development\sumoo-share-target`:
```bash
node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8')); console.log('manifest OK')"
```
Expected: `manifest OK` (no parse error).

- [ ] **Step 3: Commit**

```bash
git add public/manifest.json docs/superpowers/specs/2026-07-07-mobile-share-target-design.md docs/superpowers/plans/2026-07-07-mobile-share-target.md
git commit -m "feat(pwa): declare web share target in manifest

Add share_target (POST multipart, image/* + application/pdf) and explicit
scope so shared files post to /share-target.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Minimal share-only service worker

**Files:**
- Create: `public/sw.js`

**Interfaces:**
- Consumes: `POST /share-target` with multipart field `files` (Task 2).
- Produces: files stored in Cache Storage bucket `"sumoo-shared-files"`, each at
  key `/shared/<i>` as a `Response` whose headers carry `x-filename`
  (URI-encoded) and `content-type`; then a `303` redirect to `/upload?shared=1`.
  Consumed by `useSharedFiles` in Task 5.

- [ ] **Step 1: Write the service worker**

Create `C:/Development/sumoo-share-target/public/sw.js` with exactly:

```js
// Minimal, SHARE-ONLY service worker for sumoo.
// Handles ONLY `POST /share-target` (the Web Share Target). It does NOT cache
// app assets or intercept any other request, so it cannot affect normal
// browsing. Files are stashed in Cache Storage and picked up by the /upload
// page (see lib/use-shared-files.ts). Keep SHARE_CACHE in sync with that file.
const SHARE_CACHE = "sumoo-shared-files";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const files = formData.getAll("files").filter((f) => f instanceof File);
          const cache = await caches.open(SHARE_CACHE);
          // Drop any previous share so we never re-ingest stale files.
          const oldKeys = await cache.keys();
          await Promise.all(oldKeys.map((k) => cache.delete(k)));
          await Promise.all(
            files.map((file, i) =>
              cache.put(
                `/shared/${i}`,
                new Response(file, {
                  headers: {
                    "x-filename": encodeURIComponent(file.name || `shared-${i}`),
                    "content-type": file.type || "application/octet-stream",
                  },
                }),
              ),
            ),
          );
        } catch {
          // Best-effort: fall through to the redirect regardless.
        }
        return Response.redirect("/upload?shared=1", 303);
      })(),
    );
  }
  // All other requests: do nothing (no respondWith) — default network handling.
});
```

- [ ] **Step 2: Typecheck (whole project still compiles)**

Run from `C:\Development\sumoo-share-target`:
```bash
npm run typecheck
```
Expected: PASS (exit 0). (`public/sw.js` is plain JS in `public/`, not part of the TS program, so this just confirms nothing else broke.)

- [ ] **Step 3: Lint**

Run from `C:\Development\sumoo-share-target`:
```bash
npm run lint
```
Expected: zero NEW errors (only `components/UploadZone.tsx:135` accepted). If ESLint flags `public/sw.js` (service-worker globals like `self`), do NOT weaken rules globally — the file is in `public/` which Next/ESLint typically ignores; if it is linted and errors on `self`/`caches`, add a scoped `/* eslint-env serviceworker */` comment at the top of `sw.js` (report if you had to). Do not add project-wide config changes.

- [ ] **Step 4: Commit**

```bash
git add public/sw.js
git commit -m "feat(pwa): add share-only service worker

Intercept POST /share-target, stash shared files in Cache Storage, and
redirect to /upload?shared=1. No offline caching; other requests untouched.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Register the service worker

**Files:**
- Create: `components/ServiceWorkerRegister.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Produces: registration of `/sw.js` at root scope on the client. No props, renders `null`.

- [ ] **Step 1: Create the register component**

Create `C:/Development/sumoo-share-target/components/ServiceWorkerRegister.tsx`:

```tsx
"use client";

import { useEffect } from "react";

// Registers the share-only service worker (public/sw.js) so the Web Share
// Target works on the installed PWA. Renders nothing.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("SW registration failed", err);
      });
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
```

- [ ] **Step 2: Mount it in the layout**

In `C:/Development/sumoo-share-target/app/layout.tsx`, add the import and render
the component as the first child of `<body>`. Add near the other imports:

```tsx
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
```

and change the `<body>` open so it renders the component first:

```tsx
      <body className="min-h-screen flex flex-col">
        <ServiceWorkerRegister />
        <Providers>
```

Leave everything else in `layout.tsx` unchanged.

- [ ] **Step 3: Typecheck**

Run from `C:\Development\sumoo-share-target`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add components/ServiceWorkerRegister.tsx app/layout.tsx
git commit -m "feat(pwa): register share-only service worker in layout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `useSharedFiles` hook + UploadZone wiring

**Files:**
- Create: `lib/use-shared-files.ts`
- Modify: `components/UploadZone.tsx`

**Interfaces:**
- Consumes: the `"sumoo-shared-files"` cache populated by Task 3, and the
  `?shared=1` query param set by the SW redirect.
- Produces: `useSharedFiles(): File[]` — returns the shared files ONCE after
  pickup, `[]` otherwise. Consumed by `UploadZone`, merged into `files`.

- [ ] **Step 1: Write the hook**

Create `C:/Development/sumoo-share-target/lib/use-shared-files.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

// Must match SHARE_CACHE in public/sw.js.
const SHARE_CACHE = "sumoo-shared-files";

// On /upload?shared=1, read the files the service worker stashed in Cache
// Storage, return them once, then clear the cache and strip the query param so a
// refresh does not re-ingest. Returns [] when there is nothing to pick up or the
// platform lacks Cache Storage.
export function useSharedFiles(): File[] {
  const [shared, setShared] = useState<File[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("shared")) return;
    if (!("caches" in window)) return;

    let cancelled = false;

    (async () => {
      try {
        const cache = await caches.open(SHARE_CACHE);
        const keys = await cache.keys();
        const files: File[] = [];
        for (const key of keys) {
          const res = await cache.match(key);
          if (!res) continue;
          const blob = await res.blob();
          const name = decodeURIComponent(
            res.headers.get("x-filename") || "shared",
          );
          const type = res.headers.get("content-type") || blob.type;
          files.push(new File([blob], name, { type }));
        }
        await caches.delete(SHARE_CACHE);
        if (!cancelled && files.length > 0) setShared(files);
      } catch {
        // ignore — feature is best-effort
      } finally {
        // Strip ?shared=1 so a refresh is a no-op.
        params.delete("shared");
        const qs = params.toString();
        const next =
          window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
        window.history.replaceState(null, "", next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return shared;
}
```

- [ ] **Step 2: Wire it into UploadZone**

In `C:/Development/sumoo-share-target/components/UploadZone.tsx`:

(a) Add the import near the other `@/lib` / hook imports at the top of the file:

```ts
import { useSharedFiles } from "@/lib/use-shared-files";
```

(b) Inside the `UploadZone` component body, right after the existing state
declarations (e.g. after `const [pendingFiles, setPendingFiles] = useState<File[]>([]);`
at line 121), add the hook call and a merge effect:

```tsx
  const sharedFiles = useSharedFiles();
  useEffect(() => {
    if (sharedFiles.length > 0) {
      setFiles((prev) => [...prev, ...sharedFiles]);
    }
  }, [sharedFiles]);
```

`useEffect`/`useState` are already imported in this file. `setFiles` is the
existing setter for the drop/scan queue. Do NOT route shared files through
`pendingFiles`.

- [ ] **Step 3: Typecheck**

Run from `C:\Development\sumoo-share-target`:
```bash
npm run typecheck
```
Expected: PASS (exit 0).

- [ ] **Step 4: Lint**

Run from `C:\Development\sumoo-share-target`:
```bash
npm run lint
```
Expected: zero NEW errors (only `components/UploadZone.tsx:135` accepted). If the
new merge effect triggers a `react-hooks/exhaustive-deps` warning, the deps
(`[sharedFiles]`) are correct (`setFiles` is a stable setter); resolve any warning
by keeping `[sharedFiles]` and, only if lint errors, add the standard
`// eslint-disable-next-line react-hooks/exhaustive-deps` with a one-line reason —
report if you had to.

- [ ] **Step 5: Build (once, in the worktree)**

Run from `C:\Development\sumoo-share-target`:
```bash
npm run build
```
Expected: `next build` completes successfully. Do NOT run in the main dir.

- [ ] **Step 6: Commit**

```bash
git add lib/use-shared-files.ts components/UploadZone.tsx
git commit -m "feat(pwa): ingest shared files into the upload queue

Add useSharedFiles to read the service worker's stashed files on
/upload?shared=1 and merge them into UploadZone's scan queue.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Integration and manual verification (orchestrator)

**Files:** none (git integration).

- [ ] **Step 1: Fast-forward merge into `dev` locally**

From `C:\Development\sumoo` (main dir, on `dev`):
```bash
git merge --ff-only feat/share-target
```
Expected: fast-forward. Do NOT push to `origin/dev` (batch pushes at the very end).

- [ ] **Step 2: Hand off to the user for verification**

Ask the user to verify on the deployed HTTPS PWA (installed to home screen — NOT
`:3000`): from the gallery/WhatsApp, Share → sumoo; confirm the app opens on
`/upload` with the shared image/PDF in the "התחל סריקה" queue and scannable.
Also confirm normal drag-and-drop and a plain `/upload` refresh are unaffected.
Wait for confirmation. Do NOT delete the `feat/share-target` branch.

---

## Self-Review

- **Spec coverage:** manifest `share_target` + `scope` → Task 2; minimal share-only SW with Cache Storage stash + 303 redirect → Task 3; SW registration → Task 4; `useSharedFiles` hook + merge into `files` → Task 5; integration + HTTPS manual test → Task 6. Out-of-scope items (TWA, assetlinks, multi-entry, offline) are not touched. All covered.
- **Placeholder scan:** none — every code step shows full file/edit content; every command shows expected output. The two conditional lint notes have explicit, bounded fallbacks (scoped eslint comment, report if used), not vague TODOs.
- **Type consistency:** `SHARE_CACHE = "sumoo-shared-files"` identical in `public/sw.js` (Task 3) and `lib/use-shared-files.ts` (Task 5); the SW stores `x-filename`/`content-type` headers that the hook reads; `useSharedFiles(): File[]` is consumed with `setFiles((prev) => [...prev, ...sharedFiles])` in Task 5; redirect target `/upload?shared=1` matches the hook's `params.has("shared")` check.
