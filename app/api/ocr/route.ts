import { NextResponse } from "next/server";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { extractReceipt } from "@/lib/ai";
import {
  appendOrIncrementStore,
  downloadDriveFile,
  ensureSpreadsheet,
  ensureUploadFolder,
  getAllStores,
  requireAccessToken,
  uploadFileToDrive,
} from "@/lib/google";
import type { PaymentMethod, Receipt } from "@/lib/types";

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

function asMediaType(
  mt: string,
):
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf" {
  if (mt === "image/png") return "image/png";
  if (mt === "image/webp") return "image/webp";
  if (mt === "image/gif") return "image/gif";
  if (mt === "application/pdf") return "application/pdf";
  return "image/jpeg";
}

type Body =
  | { kind: "upload"; fileName: string; mediaType: string; base64: string }
  | { kind: "drive"; driveFileId: string; fileName: string; mediaType: string };

function classifyMethod(
  paymentMethod: "credit_card" | "cash" | "other",
  cardLast4: string | null,
  userLast4: string,
): PaymentMethod {
  if (paymentMethod === "cash") return "מזומן";
  if (paymentMethod === "credit_card") {
    if (cardLast4 && cardLast4 === userLast4) return "אשראי";
    return "מזומן"; // user's rule: any other card = "cash" bucket
  }
  return "אחר";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    let base64: string;
    let mediaType: string;
    let fileName: string;
    let driveFileId: string | null = null;
    let originalBuffer: Buffer | null = null;

    if (body.kind === "upload") {
      base64 = body.base64;
      mediaType = body.mediaType;
      fileName = body.fileName;
      originalBuffer = Buffer.from(base64, "base64");
    } else {
      const token = await requireAccessToken();
      const dl = await downloadDriveFile(token, body.driveFileId);
      base64 = dl.buffer.toString("base64");
      mediaType = body.mediaType || dl.mimeType;
      fileName = body.fileName;
      driveFileId = body.driveFileId;
    }

    const isPdf = mediaType === "application/pdf";
    const isImage = mediaType.startsWith("image/");

    if (!isPdf && !isImage) {
      return NextResponse.json(
        {
          ok: true,
          receipts: [
            {
              id: uuidv4(),
              fileName,
              driveFileId,
              storeName: null,
              amount: null,
              date: null,
              category: "שונות",
              documentType: "לא ידוע",
              paymentMethod: "לא ידוע",
              cardLast4: null,
              totalReceiptAmount: null,
              confidence: "low",
              reviewed: false,
            } satisfies Receipt,
          ],
          warning: `Unsupported media type: ${mediaType}`,
        },
        { status: 200 },
      );
    }

    if (isImage) {
      try {
        base64 = await shrinkImage(base64);
        mediaType = "image/jpeg";
      } catch (e) {
        console.warn("sharp resize failed, sending original", e);
      }
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

    // Auto-upload local files to Drive so they get a permanent link
    if (body.kind === "upload" && token && originalBuffer) {
      try {
        const folderId = await ensureUploadFolder(token);
        const uploaded = await uploadFileToDrive(
          token,
          folderId,
          fileName,
          originalBuffer,
          body.mediaType || "image/jpeg",
        );
        driveFileId = uploaded.id;
      } catch (e) {
        console.warn("Drive auto-upload failed", e);
      }
    }

    const userLast4 = process.env.MY_CREDIT_CARD_LAST4 || "6021";
    const docTypeMap: Record<string, Receipt["documentType"]> = {
      receipt: "קבלה",
      credit_slip: "ספח אשראי",
      unknown: "לא ידוע",
    };
    const docType = docTypeMap[extracted.document_type] || "לא ידוע";
    const totalAmount = extracted.total_amount ?? null;

    // Build receipts: split mixed payments into multiple linked rows
    const receipts: Receipt[] = [];
    const payments = extracted.payments.filter((p) => Number.isFinite(p.amount));

    if (payments.length === 0) {
      receipts.push({
        id: uuidv4(),
        fileName,
        driveFileId,
        storeName: extracted.store_name,
        amount: totalAmount,
        date: extracted.date,
        category: extracted.category,
        documentType: docType,
        paymentMethod: "לא ידוע",
        cardLast4: null,
        totalReceiptAmount: totalAmount,
        confidence: extracted.confidence,
        reviewed: false,
        notes: "",
      });
    } else if (payments.length === 1) {
      const p = payments[0];
      receipts.push({
        id: uuidv4(),
        fileName,
        driveFileId,
        storeName: extracted.store_name,
        amount: p.amount,
        date: extracted.date,
        category: extracted.category,
        documentType: docType,
        paymentMethod: classifyMethod(p.method, p.card_last4, userLast4),
        cardLast4: p.card_last4,
        totalReceiptAmount: totalAmount,
        confidence: extracted.confidence,
        reviewed: false,
        notes: "",
      });
    } else {
      // Mixed payment: one row per payment, linked to the first
      const primaryId = uuidv4();
      payments.forEach((p, i) => {
        receipts.push({
          id: i === 0 ? primaryId : uuidv4(),
          fileName,
          driveFileId,
          storeName: extracted.store_name,
          amount: p.amount,
          date: extracted.date,
          category: extracted.category,
          documentType: docType,
          paymentMethod: classifyMethod(p.method, p.card_last4, userLast4),
          cardLast4: p.card_last4,
          totalReceiptAmount: totalAmount,
          linkedTo: i === 0 ? null : primaryId,
          confidence: extracted.confidence,
          reviewed: false,
          notes: i === 0 ? `תשלום מעורב (${payments.length} שורות)` : `שורה ${i + 1}/${payments.length} של תשלום מעורב`,
        });
      });
    }

    // Update stores list (use the storeName as recorded; should equal canonical when matched)
    if (token && spreadsheetId && extracted.store_name) {
      try {
        const variant = extracted.matched_known_store ? undefined : extracted.store_name;
        await appendOrIncrementStore(
          token,
          spreadsheetId,
          extracted.store_name,
          variant,
        );
      } catch (e) {
        console.warn("appendOrIncrementStore failed", e);
      }
    }

    return NextResponse.json({ ok: true, receipts });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const msg = e?.message ?? "OCR failed";
    const status =
      e?.status === 429 || /\b429\b|rate.?limit|Too Many Requests/i.test(msg)
        ? 429
        : e?.status === 503 ||
            e?.status === 529 ||
            /\b503\b|overloaded|Service Unavailable/i.test(msg)
          ? 503
          : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
