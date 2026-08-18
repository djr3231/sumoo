import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import {
  appendOrIncrementStore,
  appendReceipts,
  uploadReceiptImage,
} from "@/lib/google";
import { CAPABILITY, type Receipt } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The deferred half of a /check scan.
//
// /api/ocr runs that scan with `dryRun`, so it touches neither Drive nor the
// stores tab: a receipt the user turns out to already have must leave nothing
// behind. Once the user confirms it is genuinely new, this route performs the
// writes that were skipped — in the same order /api/ocr + /api/sheets would
// have done them — and returns the rows as persisted.
type Body = {
  receipts: Receipt[];
  fileName: string;
  mediaType: string;
  base64: string;
  folderId?: string;
  // Echoed back from the dry-run response so the store registry stays in step.
  storeName?: string | null;
  matchedKnownStore?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const receipts = body.receipts || [];
    if (receipts.length === 0) {
      return NextResponse.json({ error: "no receipts to save" }, { status: 400 });
    }

    const ctx = await requireCapability(CAPABILITY.AppendReceipts);

    const driveFileId = await uploadReceiptImage(ctx.token, {
      folderId: body.folderId,
      isSharedAccount: ctx.ownerEmail !== null,
      ownerUploadFolderId: ctx.uploadFolderId,
      fileName: body.fileName,
      buffer: Buffer.from(body.base64, "base64"),
      mimeType: body.mediaType || "image/jpeg",
    });

    // One image, one id — a mixed payment produces several linked rows that all
    // point at the same file, exactly as /api/ocr stamps them.
    const saved = receipts.map((r) => ({ ...r, driveFileId }));

    // Best-effort, as in /api/ocr: the registry only improves canonicalization
    // on later scans, so a failure here must not fail the save.
    if (body.storeName) {
      try {
        await appendOrIncrementStore(
          ctx.token,
          ctx.spreadsheetId,
          body.storeName,
          body.matchedKnownStore ? undefined : body.storeName,
        );
      } catch (e) {
        console.warn("appendOrIncrementStore failed", e);
      }
    }

    await appendReceipts(ctx.token, ctx.spreadsheetId, saved);

    return NextResponse.json({ ok: true, receipts: saved });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
}
