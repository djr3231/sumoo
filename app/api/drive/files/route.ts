import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import { searchDriveFiles } from "@/lib/google";
import { CAPABILITY } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  if (q.length < 1) {
    return NextResponse.json({ files: [] });
  }
  try {
    const { token } = await requireCapability(CAPABILITY.DriveBrowse, {
      spreadsheet: false,
    });
    const files = await searchDriveFiles(token, q);
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: errorStatus(e) });
  }
}
