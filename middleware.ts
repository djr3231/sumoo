import { NextResponse, type NextRequest } from "next/server";

// Pins production to a single origin: the host in NEXTAUTH_URL.
//
// The deployment answers on both chewie.ceo and sumoo.vercel.app, and NextAuth
// v4 derives the whole OAuth round trip — the Google redirect_uri, the callback
// URL, and every error redirect — from one origin computed per request
// (`detectOrigin` in next-auth/utils, consumed by core/init.ts). On Vercel that
// origin is the incoming host only when the VERCEL system env var reaches the
// runtime; otherwise it is NEXTAUTH_URL. Either way, a sign-in that starts on
// one host and finishes on the other loses its state/PKCE cookies — those are
// host-only, NextAuth sets no cookie domain — so the callback fails the state
// check and dumps the user, signed out, on the other domain. One origin, no
// split.
//
// Deliberately gated on NEXTAUTH_URL rather than VERCEL_ENV: a project that
// does not expose Vercel's system env vars has no VERCEL_ENV either, and that
// is exactly the configuration where the redirect matters most. Preview
// deployments are left alone when VERCEL_ENV is available to identify them.

const canonicalOrigin = (() => {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
})();

export function middleware(request: NextRequest) {
  if (!canonicalOrigin) return NextResponse.next();

  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction = vercelEnv
    ? vercelEnv === "production"
    : process.env.NODE_ENV === "production";
  if (!isProduction) return NextResponse.next();

  const host = request.headers.get("host")?.toLowerCase();
  if (!host || host === canonicalOrigin.host.toLowerCase()) {
    return NextResponse.next();
  }

  const target = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    canonicalOrigin.origin,
  );
  // 307, not 308: the canonical host is configuration. A permanent redirect
  // would outlive it in browser caches.
  return NextResponse.redirect(target, 307);
}

export const config = {
  // /api/auth/* stays in scope on purpose: an OAuth callback that still lands
  // on the wrong host continues to the right one with its query intact.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
