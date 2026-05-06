import { NextResponse } from "next/server";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { extractReceipt } from "@/lib/claude";
import {
  appendOrIncrementStore,
  downloadDriveFile,
  ensureSpreadsheet,
  getAllStores,
  requireAccessToken,
} from "@/lib/google";
import type { Receipt } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_DIM = 1568;

async function shrinkImage(base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const out = await sharp(buf)
    .rotate()
    .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return out.toString("base64");
}

type Body =
  | { kind: "upload"; fileName: string; mediaType: string; base64: string }
  | { kind: "drive"; driveFileId: string; fileName: string; mediaType: string };

function asMediaType(mt: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  if (mt === "image/png") return "image/png";
  if (mt === "image/webp") return "image/webp";
  if (mt === "image/gif") return "image/gif";
  return "image/jpeg";
}

function toReceipt(args: {
  fileName: string;
  driveFileId: string | null;
  extracted: Awaited<ReturnType<typeof extractReceipt>>;
}): Receipt {
  const { fileName, driveFileId, extracted } = args;
  const docTypeMap: Record<string, Receipt["documentType"]> = {
    receipt: "קבלה",
    tax_invoice: "חשבונית מס",
    credit_slip: "ספח אשראי",
    credit_note: "זיכוי",
    unknown: "לא ידוע",
  };
  return {
    id: uuidv4(),
    fileName,
    driveFileId,
    storeName: extracted.store_name,
    amount: extracted.amount,
    date: extracted.date,
    category: extracted.category,
    documentType: docTypeMap[extracted.document_type] || "לא ידוע",
    confidence: extracted.confidence,
    reviewed: false,
    notes: "",
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    let base64: string;
    let mediaType: string;
    let fileName: string;
    let driveFileId: string | null = null;

    if (body.kind === "upload") {
      base64 = body.base64;
      mediaType = body.mediaType;
      fileName = body.fileName;
    } else {
      const token = await requireAccessToken();
      const dl = await downloadDriveFile(token, body.driveFileId);
      base64 = dl.buffer.toString("base64");
      mediaType = body.mediaType || dl.mimeType;
      fileName = body.fileName;
      driveFileId = body.driveFileId;
    }

    if (!mediaType.startsWith("image/")) {
      return NextResponse.json(
        {
          ok: true,
          receipt: {
            id: uuidv4(),
            fileName,
            driveFileId,
            storeName: null,
            amount: null,
            date: null,
            category: "לא ידוע",
            documentType: "לא ידוע",
            confidence: "low",
            reviewed: false,
          } satisfies Receipt,
          warning: `Skipped non-image media type: ${mediaType}`,
        },
        { status: 200 },
      );
    }

    try {
      base64 = await shrinkImage(base64);
      mediaType = "image/jpeg";
    } catch (e) {
      console.warn("sharp resize failed, sending original", e);
    }

    let token: string | null = null;
    let spreadsheetId: string | null = null;
    let knownStores: string[] = [];
    try {
      token = await requireAccessToken();
      spreadsheetId = await ensureSpreadsheet(token);
      const stores = await getAllStores(token, spreadsheetId);
      knownStores = stores.map((s) => s.canonical);
    } catch (e) {
      console.warn("Could not load known stores", e);
    }

    const extracted = await extractReceipt({
      imageBase64: base64,
      mediaType: asMediaType(mediaType),
      fileName,
      knownStores,
    });
    const receipt = toReceipt({ fileName, driveFileId, extracted });

    if (token && spreadsheetId && receipt.storeName) {
      try {
        const variant = extracted.matched_known_store ? undefined : receipt.storeName;
        await appendOrIncrementStore(token, spreadsheetId, receipt.storeName, variant);
      } catch (e) {
        console.warn("appendOrIncrementStore failed", e);
      }
    }

    return NextResponse.json({ ok: true, receipt });
  } catch (err) {
    const e = err as { status?: number; message?: string; name?: string };
    const msg = e?.message ?? "OCR failed";
    const status =
      e?.status === 429 || /rate.?limit/i.test(msg)
        ? 429
        : e?.status === 529 || /overloaded/i.test(msg)
          ? 503
          : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
