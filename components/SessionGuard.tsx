"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { toast } from "sonner";
import { REFRESH_ERROR } from "@/lib/auth-error";

// Validates the Google grant on every page entry. SessionProvider fetches
// /api/auth/session on mount (and on window focus, and on the refetchInterval
// set in Providers). That request runs the jwt callback through the NextAuth
// route handler — which, unlike getServerSession in a server component, can
// persist the refreshed cookie — so a dead grant comes back as session.error
// and we end the session here.
//
// This covers the token that expired before the page loaded. A grant revoked
// mid-session is caught separately, by routes answering 401.
export function SessionGuard() {
  const { data: session } = useSession();
  const router = useRouter();
  // A session object can arrive more than once; sign out exactly once.
  const firedRef = useRef(false);

  useEffect(() => {
    if (session?.error !== REFRESH_ERROR || firedRef.current) return;
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
  }, [session?.error, router]);

  return null;
}
