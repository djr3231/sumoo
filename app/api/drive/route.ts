import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import { listDriveFolderImages } from "@/lib/google";
import { CAPABILITY } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { token } = await requireCapability(CAPABILITY.DriveBrowse, {
      spreadsheet: false,
    });
    const url = new URL(req.url);
    const folderId = url.searchParams.get("folderId");
    if (!folderId) {
      return NextResponse.json({ error: "folderId is required" }, { status: 400 });
    }
    const files = await listDriveFolderImages(token, folderId);
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: errorStatus(err) },
    );
  }
}
