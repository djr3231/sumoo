import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { REFRESH_ERROR, type AuthError } from "./auth-error";

export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];

// REFRESH_ERROR is written onto the JWT when the Google grant is definitively
// dead (revoked, or invalid_grant). It rides through to `session.error`, and
// the client signs the user out on seeing it. Only set for failures that
// retrying cannot fix.

// Refresh this long before the token actually expires.
const REFRESH_MARGIN_MS = 60_000;

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // Fresh sign-in — store the grant and clear any stale error marker.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3600 * 1000;
        delete token.error;
        return token;
      }

      // Still valid — nothing to do.
      if (
        typeof token.expiresAt === "number" &&
        Date.now() < token.expiresAt - REFRESH_MARGIN_MS
      ) {
        return token;
      }

      // Expired (or of unknown age) with no refresh token: the grant is gone
      // for good. Drop the dead access token so no server code can keep using
      // it, and mark the session so the client signs out.
      if (!token.refreshToken) {
        token.accessToken = undefined;
        token.error = REFRESH_ERROR;
        return token;
      }

      try {
        const params = new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          grant_type: "refresh_token",
          refresh_token: String(token.refreshToken),
        });
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const refreshed = (await r.json()) as {
          access_token?: string;
          expires_in?: number;
          refresh_token?: string;
        };

        // HARD failure: Google rejected the refresh token itself (revoked
        // access, invalid_grant, bad client). Retrying will never succeed, so
        // end the session rather than looping against Google on every request.
        if (!r.ok || !refreshed.access_token) {
          console.error("token refresh rejected", r.status, refreshed);
          token.accessToken = undefined;
          token.error = REFRESH_ERROR;
          return token;
        }

        token.accessToken = refreshed.access_token;
        token.expiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
        // Google reissues a refresh token only occasionally — keep the current
        // one when the response omits it.
        if (refreshed.refresh_token) token.refreshToken = refreshed.refresh_token;
        delete token.error;
      } catch (e) {
        // SOFT failure: network or parse error. The grant may well be fine, so
        // leave the token untouched and retry on the next request instead of
        // signing the user out over a transient blip.
        console.error("token refresh failed", e);
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: AuthError;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: AuthError;
  }
}
