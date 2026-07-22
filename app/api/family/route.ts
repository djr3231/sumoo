import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import {
  ensureFileSharedWithEmail,
  ensureUploadFolder,
  getUserSettings,
  revokeFileAccessByEmail,
  writeUserSettings,
} from "@/lib/google";
import { CAPABILITY, FAMILY_ROLE_VALUES, type FamilyRole } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// Membership management. Owner-only via CAPABILITY.ManageFamily — the one
// capability a `full` member does not hold. Drive side effects are why this
// is a separate route from /api/settings.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ShareTarget = "spreadsheet" | "uploadFolder" | "reportTemplate";
interface ShareResult {
  target: ShareTarget;
  ok: boolean;
}

function parseEmail(body: { email?: unknown }): string {
  return typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
}

export async function POST(req: Request) {
  try {
    const ctx = await requireCapability(CAPABILITY.ManageFamily);
    const body = (await req.json()) as { email?: unknown; role?: unknown };
    const email = parseEmail(body);
    const role = body.role as FamilyRole;

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (!(FAMILY_ROLE_VALUES as string[]).includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (email === ctx.email) {
      return NextResponse.json(
        { error: "The account owner is not a family member" },
        { status: 400 },
      );
    }

    // strict: a transient read failure must abort — writeUserSettings clears
    // the whole range, so writing from an empty read would wipe the registry.
    const settings = await getUserSettings(ctx.token, ctx.spreadsheetId, {
      strict: true,
    });
    const existing = settings.familyMembers.find((m) => m.email === email);
    const members = existing
      ? settings.familyMembers.map((m) => (m.email === email ? { email, role } : m))
      : [...settings.familyMembers, { email, role }];

    // Registry is written BEFORE sharing: an entry without a share is a
    // member who cannot reach the data, while a share without an entry would
    // be a dangling Drive grant. Sharing runs on every POST — it is
    // idempotent, so re-adding a member repairs a previously failed share.
    const uploadFolderId = await ensureUploadFolder(ctx.token);
    await writeUserSettings(ctx.token, ctx.spreadsheetId, {
      ...settings,
      familyMembers: members,
      uploadFolderId,
    });

    const targets: Array<{
      target: ShareTarget;
      fileId: string;
      role: "writer" | "reader";
    }> = [
      { target: "spreadsheet", fileId: ctx.spreadsheetId, role: "writer" },
      { target: "uploadFolder", fileId: uploadFolderId, role: "writer" },
    ];
    if (settings.reportTemplate) {
      // The built-in default template is already publicly readable.
      targets.push({
        target: "reportTemplate",
        fileId: settings.reportTemplate.id,
        role: "reader",
      });
    }

    const sharing: ShareResult[] = [];
    for (const t of targets) {
      try {
        await ensureFileSharedWithEmail(ctx.token, t.fileId, email, t.role);
        sharing.push({ target: t.target, ok: true });
      } catch {
        // Never log the email address (anonymity rule) — target name only.
        console.warn("Drive share failed:", t.target);
        sharing.push({ target: t.target, ok: false });
      }
    }

    return NextResponse.json({ ok: true, members, sharing });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireCapability(CAPABILITY.ManageFamily);
    const body = (await req.json()) as { email?: unknown };
    const email = parseEmail(body);
    if (!email) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const settings = await getUserSettings(ctx.token, ctx.spreadsheetId, {
      strict: true,
    });
    if (!settings.familyMembers.some((m) => m.email === email)) {
      // Already gone — idempotent success.
      return NextResponse.json({
        ok: true,
        members: settings.familyMembers,
        sharing: [],
      });
    }

    // Revoke FIRST, and keep the registry entry if any revoke fails: removing
    // the entry while a Drive grant survives would leave a dangling grant with
    // no way to reach it from the app. The owner retries the removal instead.
    const targets: Array<{ target: ShareTarget; fileId: string }> = [
      { target: "spreadsheet", fileId: ctx.spreadsheetId },
    ];
    if (settings.uploadFolderId) {
      targets.push({ target: "uploadFolder", fileId: settings.uploadFolderId });
    }
    if (settings.reportTemplate) {
      targets.push({ target: "reportTemplate", fileId: settings.reportTemplate.id });
    }

    const sharing: ShareResult[] = [];
    for (const t of targets) {
      try {
        await revokeFileAccessByEmail(ctx.token, t.fileId, email);
        sharing.push({ target: t.target, ok: true });
      } catch {
        console.warn("Drive revoke failed:", t.target);
        sharing.push({ target: t.target, ok: false });
      }
    }

    if (sharing.some((s) => !s.ok)) {
      return NextResponse.json(
        {
          error: "Some Drive permissions could not be revoked",
          members: settings.familyMembers,
          sharing,
        },
        { status: 502 },
      );
    }

    const members = settings.familyMembers.filter((m) => m.email !== email);
    await writeUserSettings(ctx.token, ctx.spreadsheetId, {
      ...settings,
      familyMembers: members,
    });
    return NextResponse.json({ ok: true, members, sharing });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
}
