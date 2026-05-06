import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, type Category, type Confidence } from "./types";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client() {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey, maxRetries: 6 });
  }
  return _client;
}

export interface ExtractedReceipt {
  store_name: string | null;
  amount: number | null;
  date: string | null;
  category: Category;
  document_type: "receipt" | "credit_note" | "unknown";
  confidence: Confidence;
  raw_text_he: string;
}

const RECEIPT_TOOL = {
  name: "record_receipt",
  description:
    "Record the structured data extracted from a single Israeli receipt or credit note image.",
  input_schema: {
    type: "object" as const,
    properties: {
      store_name: {
        type: ["string", "null"],
        description: "שם בית העסק כפי שמופיע בקבלה. null אם לא קריא בבירור.",
      },
      amount: {
        type: ["number", "null"],
        description:
          "הסכום הסופי שחויב, כולל מע\"מ. שלילי עבור זיכוי. null אם לא קריא.",
      },
      date: {
        type: ["string", "null"],
        description: "תאריך בפורמט YYYY-MM-DD. null אם לא קריא או לא קיים.",
      },
      category: {
        type: "string",
        enum: [...CATEGORIES],
        description:
          "קטגוריה הולמת מתוך הרשימה. אם לא ניתן להחליט בביטחון, החזר 'אחר' או 'לא ידוע'.",
      },
      document_type: {
        type: "string",
        enum: ["receipt", "credit_note", "unknown"],
        description:
          "receipt = קבלה רגילה, credit_note = זיכוי/החזר (סכום שלילי, מילים כמו 'זיכוי', 'החזר', או סוגריים סביב סכום).",
      },
      confidence: {
        type: "string",
        enum: ["low", "med", "high"],
        description:
          "low אם רוב השדות null או מטושטשים, high אם כל השדות ברורים.",
      },
      raw_text_he: {
        type: "string",
        description: "הטקסט הגולמי שזוהה בתמונה (עברית), עד 800 תווים.",
      },
    },
    required: [
      "store_name",
      "amount",
      "date",
      "category",
      "document_type",
      "confidence",
      "raw_text_he",
    ],
  },
};

const SYSTEM_PROMPT = `אתה מומחה לחילוץ נתונים מקבלות וחשבוניות זיכוי ישראליות מתוך תמונות.

המטרה: לקרוא את הקבלה בתמונה ולהחזיר את הנתונים בקריאת הכלי record_receipt.

כללים מחייבים:
1. הסכום הוא הסכום הסופי לחיוב (כולל מע"מ). אל תחזיר סכומי ביניים.
2. אם המסמך הוא זיכוי/החזר/ביטול עסקה — הסכום שלילי, document_type = "credit_note".
   סימני זיהוי לזיכוי: "חשבונית זיכוי", "זיכוי", "החזר כספי", "ביטול עסקה", סכום בסוגריים, או סימן מינוס לפני הסכום.
3. אם שדה כלשהו לא קריא בבטחה — החזר null. עדיף null מאשר ניחוש.
4. תאריך — YYYY-MM-DD בלבד. אם רואים רק dd/mm/yyyy או dd.mm.yy — המרה. אם לא קיים — null.
5. קטגוריה — בחר אחת בלבד מהרשימה הקבועה. השתמש ב-"לא ידוע" רק אם לא ניתן בכלל להעריך מהו בית העסק.
6. confidence:
   - high = כל ארבעת השדות (חנות, סכום, תאריך, קטגוריה) מולאו בבטחה.
   - med  = שדה אחד או שניים null/לא ברורים.
   - low  = רוב השדות null, התמונה מטושטשת או חתוכה.
7. אסור להמציא שמות חנויות, סכומים או תאריכים. אם מסופק — null.

מטה כמה דוגמאות לקטגוריות:
- "סופר" — שופרסל, רמי לוי, ויקטורי, יוחננוף, AM:PM, טיב טעם, מחסני השוק, יינות ביתן.
- "מזון" — חנויות מכולת קטנות, מאפיות, חנויות שכונה.
- "מסעדות" — מסעדות, בתי קפה, פיצריות, פאסט פוד.
- "תחבורה" — רב-קו, אגד, מטרו, סונול תחבורה, חניונים, רכבת.
- "דלק" — פז, סונול, דלק, ten, סדש.
- "בריאות" — סופרפארם, בה־כל, ניו פארם, קליניקה, רופא, בית מרקחת.
- "בית" — איקאה, ACE, הום סנטר, חנויות כלי בית, רהיטים.
- "ביגוד" — H&M, זארה, רנואר, פוקס, הוניגמן, קסטרו.
- "בידור" — סינמה סיטי, יס פלאנט, אטרקציות, קופות חולים.
- "שירותים" — חברת חשמל, פלאפון, סלקום, פרטנר, מים, ארנונה.
- "אחר" — כל דבר אחר ברור.`;

export async function extractReceipt(args: {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  fileName: string;
}): Promise<ExtractedReceipt> {
  const { imageBase64, mediaType, fileName } = args;

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [RECEIPT_TOOL],
    tool_choice: { type: "tool", name: "record_receipt" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: `שם הקובץ: ${fileName}\nחלץ את הנתונים. אם משהו לא קריא, החזר null עבור אותו שדה.`,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block");
  }
  const out = toolUse.input as ExtractedReceipt;

  if (!CATEGORIES.includes(out.category)) {
    out.category = "לא ידוע";
  }
  return out;
}

export interface DedupGroup {
  kind: "duplicate" | "credit_match" | "orphan_credit";
  receipt_ids: string[];
  reason: string;
}

const DEDUP_TOOL = {
  name: "report_groups",
  description: "Report groups of receipts that are duplicates, credit notes matching original receipts, or orphan credit notes.",
  input_schema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["duplicate", "credit_match", "orphan_credit"] },
            receipt_ids: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
          },
          required: ["kind", "receipt_ids", "reason"],
        },
      },
    },
    required: ["groups"],
  },
};

export async function detectDuplicatesAndCredits(
  rows: Array<Pick<import("./types").Receipt, "id" | "storeName" | "amount" | "date" | "documentType">>,
): Promise<DedupGroup[]> {
  if (rows.length === 0) return [];

  const compact = rows.map((r) => ({
    id: r.id,
    s: r.storeName,
    a: r.amount,
    d: r.date,
    t: r.documentType,
  }));

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: `אתה עוזר למיין שורות של קבלות וזיכויים. תקבל רשימת JSON של שורות (id, חנות, סכום, תאריך, סוג).
זהה:
1. כפילויות — אותה חנות, אותו תאריך (±יום), סכום קרוב (±0.5%). דגום duplicate.
2. זיכוי תואם — שורת זיכוי (סכום שלילי) שתואמת בקירוב לקבלה חיובית מאותה חנות בסכום מוחלט קרוב. דגום credit_match.
3. זיכוי יתום — זיכוי שאין לו קבלה תואמת בקלט. דגום orphan_credit.
החזר תמיד דרך הכלי report_groups. אם אין קבוצות — groups=[].`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [DEDUP_TOOL],
    tool_choice: { type: "tool", name: "report_groups" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `נתונים:\n${JSON.stringify(compact)}`,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];
  const input = toolUse.input as { groups: DedupGroup[] };
  return input.groups || [];
}

const STATEMENT_TOOL = {
  name: "record_transactions",
  description: "Return structured rows extracted from a bank or credit-card statement.",
  input_schema: {
    type: "object" as const,
    properties: {
      transactions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            amount: {
              type: ["number", "null"],
              description: "סכום החיוב. חיובים שליליים (כסף שיצא) — מספר שלילי. החזרים — חיובי.",
            },
            description: { type: ["string", "null"] },
          },
          required: ["date", "amount", "description"],
        },
      },
      source_label: {
        type: "string",
        description: "תווית המקור: 'בנק לאומי', 'אשראי ויזה 1234' וכו׳.",
      },
    },
    required: ["transactions", "source_label"],
  },
};

export async function parseStatementPDF(args: {
  pdfBase64: string;
  hint?: string;
}): Promise<{ source_label: string; transactions: Array<{ date: string | null; amount: number | null; description: string | null }> }> {
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: `אתה מחלץ תנועות חיוב מתדפיסי בנק וחשבונות אשראי ישראליים (PDF).
חשוב:
- כל חיוב חייב להיות שלילי (כסף שיצא). זיכוי/החזר חיובי.
- לא להמציא תנועות. אם שורה לא ברורה — דלג.
- date חייב להיות YYYY-MM-DD.
- description בעברית, מקוצץ עד ~120 תווים.
החזר תמיד דרך הכלי record_transactions.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [STATEMENT_TOOL],
    tool_choice: { type: "tool", name: "record_transactions" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: args.pdfBase64,
            },
          },
          {
            type: "text",
            text: args.hint ? `רמז: ${args.hint}. חלץ את כל התנועות.` : "חלץ את כל התנועות.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { source_label: "לא ידוע", transactions: [] };
  }
  return toolUse.input as {
    source_label: string;
    transactions: Array<{ date: string | null; amount: number | null; description: string | null }>;
  };
}
