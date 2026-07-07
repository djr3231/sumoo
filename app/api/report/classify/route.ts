import { NextResponse } from "next/server";
import { classifyExpenses } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

// Classifies a batch of expense lines into the fixed government categories.
// Body: { items: [{ description, amount }] } -> { categories: string[] }.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const raw = Array.isArray(body?.items)
      ? (body.items as Array<Record<string, unknown>>)
      : null;
    if (!raw) {
      return NextResponse.json({ error: "items[] is required" }, { status: 400 });
    }
    const items = raw.map((it) => ({
      description: String(it?.description ?? ""),
      amount: Number(it?.amount ?? 0),
    }));
    const categories = await classifyExpenses(items);
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
