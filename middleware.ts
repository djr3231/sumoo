import { NextResponse, type NextRequest } from "next/server";

// Pins production to a single origin: the host in NEXTAUTH_URL.
//
// NextAuth v4 computes one origin per request (`detectOrigin` in
// next-auth/utils, consumed by core/init) and derives the Google redirect_uri,
// the callback URL and every error redirect from it. The deployment answers on
// several hosts, and a sign-in that starts on one and finishes on another loses
// its state/PKCE cookies — those are host-only, NextAuth sets no cookie domain —
// so the callback fails its state check and drops the user, signed out, on the
// wrong domain.
//
// Only Vercel-generated hosts are redirected. A custom domain's apex/www pair is
// the platform's business: Vercel (or the registrar) already redirects one to
// the other, and a second opinion from here fights that redirect and loops —
// which is exactly what happened when this file redirected www.chewie.ceo to the
// apex while the apex was being sent back to www.

const canonicalOrigin = (() => {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
})();

// Project aliases (sumoo.vercel.app), deployment URLs (sumoo-<hash>.vercel.app)
// and branch aliases. These are never the canonical host of a custom-domain
// deployment, so redirecting away from them cannot bounce back.
function isVercelHost(host: string) {
  const name = host.split(":")[0];
  return name === "vercel.app" || name.endsWith(".vercel.app");
}

export function middleware(request: NextRequest) {
  if (!canonicalOrigin) return NextResponse.next();

  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction = vercelEnv
    ? vercelEnv === "production"
    : process.env.NODE_ENV === "production";
  if (!isProduction) return NextResponse.next();

  const host = request.headers.get("host")?.toLowerCase();
  const canonicalHost = canonicalOrigin.host.toLowerCase();
  if (!host || host === canonicalHost) return NextResponse.next();
  if (!isVercelHost(host) || isVercelHost(canonicalHost)) {
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
  // on a Vercel host continues to the canonical one with its query intact.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
