import { NextResponse } from "next/server";
import { parseSalarySlip } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

// Parses a single uploaded salary slip (PDF) into { month, net, ... }.
// Bank/credit statements continue to use /api/statements.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const hint = (form.get("hint") as string) || undefined;
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json(
        { error: "salary slip must be a PDF" },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const slip = await parseSalarySlip({
      pdfBase64: buffer.toString("base64"),
      hint,
    });
    return NextResponse.json({ ok: true, slip });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
