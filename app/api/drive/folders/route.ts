import { NextResponse } from "next/server";
import { requireAccessToken, searchDriveFolders } from "@/lib/google";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  if (q.length < 1) {
    return NextResponse.json({ folders: [] });
  }
  try {
    const token = await requireAccessToken();
    const folders = await searchDriveFolders(token, q);
    return NextResponse.json({ folders });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
