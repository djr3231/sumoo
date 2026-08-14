// Shared between the NextAuth server config (lib/auth.ts) and the client-side
// session guard (components/SessionGuard.tsx). It lives in its own module so
// the client bundle never has to import lib/auth.ts, which pulls in the Google
// provider and the rest of the server-only NextAuth config.
export const REFRESH_ERROR = "RefreshAccessTokenError";
export type AuthError = typeof REFRESH_ERROR;
