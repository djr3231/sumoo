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
