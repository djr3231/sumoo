"use client";
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { toast } from "sonner";
import { REFRESH_ERROR } from "@/lib/auth-error";
import { setAuthExpiryListener } from "@/lib/api-client";

// Ends the session whenever the Google grant stops being usable. Two
// independent detectors feed one exit path, because neither covers the other:
//
//  - session.error  — the grant was already dead when the page loaded.
//    SessionProvider fetches /api/auth/session on mount (and on window focus,
//    and on the refetchInterval set in Providers). That request runs the jwt
//    callback through the NextAuth route handler, which — unlike
//    getServerSession in a server component — can persist the refreshed
//    cookie, so a hard refresh failure comes back as session.error.
//
//  - a 401 from any /api/* route — the grant was revoked mid-session, so the
//    access token has not expired yet and only a real Google call reveals it.
//    lib/api-client.ts reports those here.
export function SessionGuard() {
  const { data: session } = useSession();
  const router = useRouter();
  // A session object can arrive repeatedly, and a batch scan can produce many
  // 401s; sign out exactly once.
  const firedRef = useRef(false);

  const endSession = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void (async () => {
      toast.error("החיבור ל-Google פג. יש להתחבר מחדש.");
      // redirect: false + client navigation keeps the React tree (and the
      // toast) alive; signOut's own callbackUrl does a full page load, which
      // would discard the message before it is read.
      await signOut({ redirect: false });
      router.replace("/");
      router.refresh();
    })();
  }, [router]);

  useEffect(() => {
    setAuthExpiryListener(endSession);
    return () => setAuthExpiryListener(null);
  }, [endSession]);

  useEffect(() => {
    if (session?.error === REFRESH_ERROR) endSession();
  }, [session?.error, endSession]);

  return null;
}
