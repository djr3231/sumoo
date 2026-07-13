import { NextResponse } from "next/server";
import { requireAccessToken, searchDriveFiles } from "@/lib/google";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  if (q.length < 1) {
    return NextResponse.json({ files: [] });
  }
  try {
    const token = await requireAccessToken();
    const files = await searchDriveFiles(token, q);
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
