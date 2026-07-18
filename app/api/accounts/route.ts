import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACTIVE_ACCOUNT_COOKIE,
  decodeActiveAccount,
  listAvailableAccounts,
  requireSessionIdentity,
} from "@/lib/accounts";

export const runtime = "nodejs";

// Accounts available to the signed-in user (personal + shared) and which one
// is currently active. Called when the header user menu opens — not on the
// per-request data path.
export async function GET() {
  try {
    const { token, email } = await requireSessionIdentity();
    const shared = await listAvailableAccounts(token, email);
    const store = await cookies();
    const active = decodeActiveAccount(store.get(ACTIVE_ACCOUNT_COOKIE)?.value);
    return NextResponse.json({
      email,
      shared,
      active: active
        ? { kind: "shared", spreadsheetId: active.spreadsheetId }
        : { kind: "personal" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
