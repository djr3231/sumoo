import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];

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
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3600 * 1000;
      }

      if (
        typeof token.expiresAt === "number" &&
        Date.now() > token.expiresAt - 60_000 &&
        token.refreshToken
      ) {
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
          };
          if (refreshed.access_token) {
            token.accessToken = refreshed.access_token;
            token.expiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
          }
        } catch (e) {
          console.error("token refresh failed", e);
        }
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}
