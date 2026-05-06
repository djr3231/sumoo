import { NextResponse } from "next/server";
import { parseStatementPDF } from "@/lib/claude";
import { parseCSV, parseXLSX } from "@/lib/parsers";
import type { BankTxn } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const sourceLabel = (form.get("sourceLabel") as string) || "תדפיס";
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let txns: BankTxn[] = [];
    let detectedSource = sourceLabel;

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const r = await parseStatementPDF({
        pdfBase64: buffer.toString("base64"),
        hint: sourceLabel,
      });
      detectedSource = r.source_label || sourceLabel;
      txns = r.transactions.map((t) => ({
        source: detectedSource,
        date: t.date,
        amount: t.amount,
        description: t.description,
        status: null,
      }));
    } else if (
      file.type === "text/csv" ||
      file.name.toLowerCase().endsWith(".csv")
    ) {
      const text = buffer.toString("utf-8");
      txns = parseCSV(text, sourceLabel);
    } else if (
      file.name.toLowerCase().endsWith(".xlsx") ||
      file.name.toLowerCase().endsWith(".xls") ||
      file.type.includes("spreadsheet") ||
      file.type.includes("excel")
    ) {
      txns = parseXLSX(buffer, sourceLabel);
    } else {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type || file.name}` },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, source: detectedSource, txns });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
