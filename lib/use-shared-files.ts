"use client";

import { useEffect, useRef } from "react";

// Must match SHARE_CACHE in public/sw.js.
const SHARE_CACHE = "sumoo-shared-files";

// On /upload?shared=1, read the files the service worker stashed in Cache
// Storage and hand them to `onFiles` exactly once, then clear the cache and
// strip the query param so a refresh does not re-ingest. No-op when there is
// nothing to pick up or the platform lacks Cache Storage.
export function useSharedFiles(onFiles: (files: File[]) => void): void {
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });

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
        if (!cancelled && files.length > 0) onFilesRef.current(files);
      } catch {
        // ignore — feature is best-effort
      } finally {
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
}
