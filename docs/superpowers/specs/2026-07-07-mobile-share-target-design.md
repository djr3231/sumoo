# Design: Mobile Share Target (PWA) — report batch #3

**Date:** 2026-07-07
**Branch (implementation):** `feat/share-target` off `dev`
**Scope:** PWA-only Web Share Target that lands shared files in `/upload`.

## Goal

Let the user share an image/PDF from another app (gallery, WhatsApp, files) via
the OS share sheet straight into sumoo, instead of downloading then re-uploading.
The shared files land in the existing `/upload` flow (drag-and-drop → `/api/ocr`).

## Scope (confirmed with the user)

- **In scope:** `share_target` in the manifest + a minimal service worker (share
  handling only, no offline/caching) + client-side pickup that feeds shared files
  into the existing `UploadZone`. Single share-sheet entry → `/upload`.
- **Out of scope (deferred):** Android TWA, `assetlinks.json`, publishing to Play,
  multiple share-sheet entries (a single PWA supports exactly one `share_target`;
  Drive-style multi-destination needs a native/TWA with multiple share
  activities), offline caching, sharing to the report wizard's document step.

## Verified pattern (context7 / web.dev "receive shared files")

manifest declares a POST/multipart share target; the service worker intercepts
the POST, reads `formData`, stores the file(s) in Cache Storage, and responds
with a 303 redirect to a client URL that picks them up. Confirmed current syntax:

```json
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "files": [{ "name": "files", "accept": ["image/*", "application/pdf"] }] }
}
```

```js
// SW fetch handler shape (from web.dev), adapted for multiple files:
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname === "/share-target" && e.request.method === "POST") {
    e.respondWith((async () => {
      const formData = await e.request.formData();
      const files = formData.getAll("files");
      const cache = await caches.open(SHARE_CACHE);
      // clear stale, then store each file with its name/type in headers
      ...
      return Response.redirect("/upload?shared=1", 303);
    })());
  }
});
```

## Architecture (4 units)

### 1. `public/manifest.json` — declare the share target
Add the `share_target` block above + an explicit `"scope": "/"` (so the action
and SW scope cover it; `start_url` stays `/upload`).

### 2. `public/sw.js` — minimal share-only service worker
- `install` → `self.skipWaiting()`; `activate` → `self.clients.claim()` (so the
  SW takes control promptly after first load — needed for the redirect flow).
- `fetch` → ONLY handles `POST /share-target`. For every other request it does
  nothing (no `respondWith`), so normal navigation/fetch is untouched (no offline
  behavior, cannot break `:3000`/prod browsing).
- On `POST /share-target`: read `formData.getAll("files")`; open a dedicated
  cache `SHARE_CACHE = "sumoo-shared-files"`; delete it first (drop any stale
  share); store each file as `cache.put("/shared/" + i, new Response(file, {
  headers: { "x-filename": encodeURIComponent(file.name), "content-type":
  file.type || "application/octet-stream" } }))`; then
  `Response.redirect("/upload?shared=1", 303)`.
- Constant `SHARE_CACHE` is shared in spirit with the client (both hardcode the
  same string; it is a SW file so it cannot import from `lib/`).

### 3. `components/ServiceWorkerRegister.tsx` — register the SW
Client component (`"use client"`) mounted once in `app/layout.tsx`. On mount, if
`"serviceWorker" in navigator`, `navigator.serviceWorker.register("/sw.js")`
inside a `window` load handler; swallow/log errors. Renders `null`. No UI.

### 4. `lib/use-shared-files.ts` (`useSharedFiles`) + `UploadZone` wiring
- `useSharedFiles(onFiles: (files: File[]) => void): void` — on mount, if
  `new URLSearchParams(location.search)` has `shared`, open `SHARE_CACHE`, read
  every entry (`cache.keys()` → `cache.match` → `blob()` + `x-filename`/
  `content-type` headers → `new File([blob], decodeURIComponent(name), { type })`),
  then `caches.delete(SHARE_CACHE)` and strip the `?shared=1` param via
  `history.replaceState`. Calls `onFiles(files)` exactly once when files are
  picked up (via a latest-`onFiles` ref so a changing inline callback never
  re-runs the one-shot pickup). Guards: SSR / no `caches` support → no-op.
  (Shipped as a callback, not a returned `File[]` — see commit `20e9c9f`; the
  return-value form pushed the `setState` into a consumer `useEffect`, tripping
  `react-hooks/set-state-in-effect`.)
- `UploadZone` consumes it in one line —
  `useSharedFiles((shared) => setFiles((prev) => [...prev, ...shared]))` — merging
  into the existing `files` queue (the same state `onDrop` populates), so the
  shared files appear in the "התחל סריקה (N קבצים)" queue exactly as if dropped.
  From there the existing per-file `/api/ocr` flow runs unchanged. (NOTE: `files`
  is the drop/scan queue; `pendingFiles` is the separate server-busy retry queue —
  shared files go to `files`.)

## Data flow

OS share sheet → `POST /share-target` (multipart) → SW intercepts → stores files
in `sumoo-shared-files` cache → `303` redirect → `/upload?shared=1` → `UploadZone`
mounts → `useSharedFiles` reads cache → `onFiles(File[])` → merged into `files` →
existing OCR pipeline.

## Error handling

- No/empty/unsupported files: SW still redirects; `useSharedFiles` finds nothing
  → `onFiles` is never called → no-op.
- SW unsupported / not installed / not HTTPS: feature is simply absent
  (progressive enhancement) — `/upload` works normally.
- Cache is deleted immediately after the client reads it, so a page refresh does
  not re-ingest the same files. The `?shared=1` param is stripped after pickup.
- Registration failure is caught and logged; the app is unaffected.
- `/upload` is auth-gated (redirects to `/` without a session). If a share
  arrives while logged out, the redirect lands on `/`, the hook never runs, and
  the stashed files stay in the cache until the next share overwrites them
  (clear-then-store). Acceptable for an installed PWA where the user is normally
  signed in; not handled specially.

## Constraints & compliance

- **No new Hebrew UI strings:** shared files surface through the existing pending
  list; no toast/label added. (If a confirmation message is wanted later, it's a
  separate ask.)
- No new npm dependency — Web Share Target + service worker are web-platform
  standard. No PWA framework (next-pwa/serwist) is introduced.
- No new Google/LLM calls beyond the per-file `/api/ocr` the user already
  triggers by uploading.
- The SW does not cache app assets or intercept non-share requests — it cannot
  affect normal browsing or the running `:3000` dev server.
- TypeScript strict, no `any`. Design-system tokens only (no visible UI change of
  note; `ServiceWorkerRegister` renders `null`).

## Environment / testing notes

- Service workers + share targets require **HTTPS** (or `localhost`). Real
  testing is on the deployed HTTPS instance with the PWA installed on the phone
  (Add to Home Screen), NOT `:3000` over LAN.
- `public/sw.js` is served at `/sw.js` with root scope by Next's static handling.

## Verification

- `npm run typecheck` — PASS. `npm run lint` — zero new errors (pre-existing
  `UploadZone.tsx:135` allowed). `npm run build` — succeeds (worktree).
- Manual (user, on the deployed HTTPS PWA): install to home screen; from the
  gallery/WhatsApp, Share → sumoo; confirm the app opens on `/upload` with the
  shared image/PDF present in the pending list and scanning via `/api/ocr`.
- Sanity: normal `/upload` drag-and-drop still works; a plain refresh of
  `/upload` (no share) does nothing new.

## Open implementation detail (resolved)

Pickup logic lives in a dedicated hook `useSharedFiles` (not inline in
`UploadZone`) to keep `UploadZone` focused and isolate the cache/URL handling.
The hook takes an `onFiles` callback (rather than returning `File[]`) so the
`setFiles` happens inside the hook's own effect via a latest-ref, avoiding a
consumer-side `useEffect` and the `react-hooks/set-state-in-effect` rule.
