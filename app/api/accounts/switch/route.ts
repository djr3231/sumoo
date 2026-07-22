import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACTIVE_ACCOUNT_COOKIE,
  ACTIVE_ACCOUNT_COOKIE_OPTIONS,
  encodeActiveAccount,
  requireSessionIdentity,
  verifyMembership,
} from "@/lib/accounts";
import { getDriveFileOwnerEmail } from "@/lib/google";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, email } = await requireSessionIdentity();
    const body = (await req.json()) as { target?: unknown };
    const target = typeof body.target === "string" ? body.target : "";
    const store = await cookies();

    if (target === "personal" || target === "") {
      store.delete(ACTIVE_ACCOUNT_COOKIE);
      return NextResponse.json({ ok: true, active: { kind: "personal" } });
    }

    const membership = await verifyMembership(token, target, email);
    if (!membership) {
      return NextResponse.json(
        { error: "Not a member of this account" },
        { status: 403 },
      );
    }
    const ownerEmail = await getDriveFileOwnerEmail(token, target).catch(() => "");
    store.set(
      ACTIVE_ACCOUNT_COOKIE,
      encodeActiveAccount({
        spreadsheetId: target,
        ownerEmail,
        role: membership.role,
        uploadFolderId: membership.uploadFolderId,
        verifiedAt: Date.now(),
      }),
      ACTIVE_ACCOUNT_COOKIE_OPTIONS,
    );
    return NextResponse.json({
      ok: true,
      active: {
        kind: "shared",
        spreadsheetId: target,
        ownerEmail,
        role: membership.role,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
