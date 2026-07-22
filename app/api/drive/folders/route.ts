import { NextResponse } from "next/server";
import { errorStatus, requireCapability } from "@/lib/accounts";
import { searchDriveFolders } from "@/lib/google";
import { CAPABILITY } from "@/lib/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  if (q.length < 1) {
    return NextResponse.json({ folders: [] });
  }
  try {
    const { token } = await requireCapability(CAPABILITY.DriveBrowse, {
      spreadsheet: false,
    });
    const folders = await searchDriveFolders(token, q);
    return NextResponse.json({ folders });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: errorStatus(e) });
  }
}
