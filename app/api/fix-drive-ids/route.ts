import { NextResponse } from "next/server";
import { resolveActingContext } from "@/lib/accounts";
import { bulkUpdateReceipts, getAllReceipts, driveClient } from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  try {
    const { token, spreadsheetId } = await resolveActingContext();
    const receipts = await getAllReceipts(token, spreadsheetId);

    if (receipts.length === 0) {
      return NextResponse.json({ ok: true, fixed: 0, notFound: 0 });
    }

    const drive = driveClient(token);
    const patches: Array<{ id: string; driveFileId: string }> = [];
    const notFound: string[] = [];
    let alreadyCorrect = 0;

    for (const r of receipts) {
      if (!r.fileName) continue;

      // Search Drive for this exact filename
      const escaped = r.fileName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const res = await drive.files.list({
        q: `name = '${escaped}' and trashed = false`,
        fields: "files(id, name, modifiedTime)",
        pageSize: 10,
        orderBy: "modifiedTime desc",
      });

      const files = res.data.files || [];
      if (files.length === 0) {
        notFound.push(r.fileName);
        continue;
      }

      // Pick the most recently modified file if multiple exist
      const correctId = files[0].id!;

      if (correctId === r.driveFileId) {
        alreadyCorrect++;
        continue;
      }

      patches.push({ id: r.id, driveFileId: correctId });
    }

    if (patches.length > 0) {
      await bulkUpdateReceipts(token, spreadsheetId, patches);
    }

    return NextResponse.json({
      ok: true,
      fixed: patches.length,
      alreadyCorrect,
      notFound: notFound.length,
      notFoundFiles: notFound,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
