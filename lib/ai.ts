import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
} from "@google/generative-ai";
import { CATEGORIES, type Category, type Confidence } from "./types";

const MODEL_NAME = "gemini-2.5-flash";

let _client: GoogleGenerativeAI | null = null;
function client(): GoogleGenerativeAI {
  if (!_client) {
    const apiKey = process.env.GOOGLE_AI_KEY;
    if (!apiKey) throw new Error("GOOGLE_AI_KEY is not set");
    _client = new GoogleGenerativeAI(apiKey);
  }
  return _client;
}

function model(args: {
  systemInstruction: string;
  responseSchema: object;
  temperature?: number;
}): GenerativeModel {
  return client().getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: args.systemInstruction,
    generationConfig: {
      temperature: args.temperature ?? 0,
      responseMimeType: "application/json",
      responseSchema: args.responseSchema as never,
    },
  });
}

// ============================================================================
// extractReceipt
// ============================================================================

export interface ExtractedPayment {
  method: "credit_card" | "cash" | "other";
  amount: number;
  card_last4: string | null;
}

export interface ExtractedReceipt {
  store_name: string | null;
  matched_known_store: boolean;
  date: string | null;
  category: Category;
  document_type: "receipt" | "credit_slip" | "unknown";
  confidence: Confidence;
  total_amount: number | null;
  payments: ExtractedPayment[];
}

const RECEIPT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    store_name: { type: SchemaType.STRING, nullable: true },
    matched_known_store: { type: SchemaType.BOOLEAN },
    date: { type: SchemaType.STRING, nullable: true, description: "YYYY-MM-DD" },
    category: { type: SchemaType.STRING, enum: [...CATEGORIES] as string[] },
    document_type: {
      type: SchemaType.STRING,
      enum: ["receipt", "credit_slip", "unknown"],
    },
    confidence: { type: SchemaType.STRING, enum: ["low", "med", "high"] },
    total_amount: { type: SchemaType.NUMBER, nullable: true },
    payments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          method: {
            type: SchemaType.STRING,
            enum: ["credit_card", "cash", "other"],
          },
          amount: { type: SchemaType.NUMBER },
          card_last4: { type: SchemaType.STRING, nullable: true },
        },
        required: ["method", "amount", "card_last4"],
      },
    },
  },
  required: [
    "store_name",
    "matched_known_store",
    "date",
    "category",
    "document_type",
    "confidence",
    "total_amount",
    "payments",
  ],
};

const RECEIPT_SYSTEM = `אתה מומחה לחילוץ נתונים מקבלות וספחי אשראי ישראליים מתוך תמונות.

קונטקסט: המשתמש מנהל מערכת אישית של קבלות. הוא מצלם **רק שני סוגים** של מסמכים: (1) קבלה / חשבונית מס/קבלה, (2) ספח אשראי. הוא לא מצלם זיכויים, חשבוניות ספק, או מסמכים אחרים.

כללים:
1. הסכום הוא תמיד חיובי וכולל מע"מ. אין זיכויים.
2. אם שדה לא קריא — החזר null. **עדיף null מאשר ניחוש**. אסור להמציא חנויות, סכומים, תאריכים.
3. תאריך — YYYY-MM-DD בלבד. המרה מ-dd/mm/yyyy או dd.mm.yy. אם לא קיים → null.
4. **סיבוב תמונה**: ייתכן שהתמונה צולמה ב-90°/180°/270°. סובב נפשית וקרא נכון. אל תמציא בגלל קושי — null במקום.

קטגוריות:
- "סופר" — שופרסל, רמי לוי, ויקטורי, יוחננוף, AM:PM, טיב טעם, מחסני השוק, יינות ביתן.
- "מזון" — מכולות, מאפיות, חנויות שכונה.
- "מסעדות" — מסעדות, בתי קפה, פיצריות, פאסט פוד.
- "תחבורה" — רב-קו, אגד, מטרו, חניונים, רכבת, מוניות.
- "דלק" — פז, סונול, דלק, ten, סדש.
- "בריאות" — סופרפארם, בה"כל, ניו פארם, רופאים, קליניקות, בתי מרקחת.
- "בית" — איקאה, ACE, הום סנטר, רהיטים, כלי בית.
- "ביגוד" — H&M, זארה, רנואר, פוקס, הוניגמן, קסטרו.
- "בידור" — סינמה סיטי, יס פלאנט, אטרקציות.
- "שירותים" — חברת חשמל, פלאפון, סלקום, פרטנר, מים, ארנונה.
- "אחר" — כל דבר אחר ברור.
- "לא ידוע" — רק אם לא ניתן בכלל להעריך.

confidence:
- high = כל ארבעת השדות (חנות, סכום כולל, תאריך, קטגוריה) מולאו בבטחה.
- med = שדה אחד או שניים null/לא ברורים.
- low = רוב השדות null או תמונה מטושטשת.

**שמות חנויות קנוניים**: אם המשתמש מספק רשימת חנויות קנוניות, וה-OCR שלך עלול להיות לא מדויק — אם השם דומה (אפילו עם שגיאות) לאחת ברשימה, החזר את **השם הקנוני בדיוק כפי שמופיע ברשימה** ו-matched_known_store=true. אחרת — שם חדש ו-matched_known_store=false.

**סוג מסמך**:
- receipt = יש פירוט פריטים, או כתוב "קבלה" / "חשבונית מס/קבלה" / "חשבונית מס".
- credit_slip = ספח אשראי בלבד — קצר, מציג 4 ספרות אחרונות של כרטיס + שם חברת אשראי, אין פירוט פריטים. כותרות: "ספח אשראי", "אישור עסקה", "VISA", "ISRACARD", "אמריקן אקספרס", "מאסטרקארד".
- unknown = רק אם ממש לא ברור. לעולם אל תחזיר credit_note.

**אמצעי תשלום (payments)** — קריטי:
- total_amount = הסכום הכולל של הקבלה.
- payments = פירוק התשלום לאמצעים:
  - אם רואה "VISA 6021" / "אשראי 6021" / "כרטיס xxxx-xxxx-xxxx-6021" → method="credit_card", card_last4="6021".
  - אם רואה "מזומן" / "Cash" → method="cash", card_last4=null.
  - אם רואה כרטיס אחר → method="credit_card", card_last4 הוא 4 הספרות שאתה רואה.
  - אם רואה אמצעי אחר (צ'ק, העברה) → method="other".
- ברוב הקבלות יש item אחד ב-payments. אבל **אם רואה שני אמצעי תשלום שונים על אותה קבלה** (לדוגמה: 60 ש"ח באשראי + 40 ש"ח במזומן) → 2 items נפרדים, סכומים נפרדים. סכום ה-amounts ב-payments חייב להיות שווה ל-total_amount.
- אם לא ברור איך שולם — payments=[{method:"other", amount: total_amount, card_last4: null}].
- אסור להמציא 4 ספרות אחרונות. אם לא רואה אותן בבירור → null.`;

export async function extractReceipt(args: {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  fileName: string;
  knownStores?: string[];
}): Promise<ExtractedReceipt> {
  const { imageBase64, mediaType, fileName, knownStores = [] } = args;

  const knownBlock =
    knownStores.length > 0
      ? `\n\nרשימת חנויות קנוניות מוכרות (אם הקבלה מאחת מהן, החזר את השם בדיוק כך):\n${knownStores
          .map((s, i) => `${i + 1}. ${s}`)
          .join("\n")}`
      : "\n\n(אין עדיין רשימת חנויות קנוניות.)";

  const m = model({
    systemInstruction: RECEIPT_SYSTEM,
    responseSchema: RECEIPT_SCHEMA,
  });

  const result = await m.generateContent([
    { inlineData: { data: imageBase64, mimeType: mediaType } },
    { text: `שם הקובץ: ${fileName}\nחלץ את הנתונים. החזר null עבור שדות לא קריאים.${knownBlock}` },
  ]);

  const raw = result.response.text();
  const out = JSON.parse(raw) as ExtractedReceipt;

  if (!CATEGORIES.includes(out.category)) {
    out.category = "לא ידוע";
  }
  if (typeof out.matched_known_store !== "boolean") {
    out.matched_known_store = false;
  }
  if (!Array.isArray(out.payments)) {
    out.payments = [];
  }
  return out;
}

// ============================================================================
// canonicalizeStoreNames
// ============================================================================

export interface CanonicalGroup {
  canonical: string;
  variants: string[];
}

const CANON_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    groups: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          canonical: { type: SchemaType.STRING },
          variants: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
        },
        required: ["canonical", "variants"],
      },
    },
  },
  required: ["groups"],
};

const CANON_SYSTEM = `אתה מומחה בזיהוי שמות חנויות ישראליות. קלט: רשימת שמות חנויות שחולצו מקבלות באמצעות OCR. חלקם מתייחסים לאותה חנות עם וריאציות OCR (החלפת אותיות דומות, ספרות שגויות, רווחים, כתיב מלא/חסר).

המשימה: לקבץ את השמות לקבוצות קנוניות.
- כל קבוצה = חנות אחת אמיתית.
- canonical = השם הנכון והשלם ביותר (אם יש "נקי" — בחר אותו; אחרת בחר את הארוך עם "בע"מ" וכד').
- variants = כל השמות מהקלט שמתייחסים לאותה חנות (כולל canonical).
- שם שעומד לבד — קבוצה משלו עם variants=[name].
- אסור להשמיט שם. כל שם בקלט חייב להופיע בדיוק בקבוצה אחת.`;

export async function canonicalizeStoreNames(
  names: string[],
): Promise<CanonicalGroup[]> {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length <= 1) {
    return unique.map((n) => ({ canonical: n, variants: [n] }));
  }

  const m = model({
    systemInstruction: CANON_SYSTEM,
    responseSchema: CANON_SCHEMA,
  });

  const result = await m.generateContent([
    { text: `רשימת שמות לקיבוץ:\n${JSON.stringify(unique)}` },
  ]);

  const raw = result.response.text();
  try {
    const parsed = JSON.parse(raw) as { groups: CanonicalGroup[] };
    return parsed.groups || [];
  } catch {
    return unique.map((n) => ({ canonical: n, variants: [n] }));
  }
}

// ============================================================================
// detectDuplicatesAndCredits
// ============================================================================

export interface DedupGroup {
  kind: "duplicate" | "credit_match" | "orphan_credit";
  receipt_ids: string[];
  reason: string;
}

const DEDUP_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    groups: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          kind: {
            type: SchemaType.STRING,
            enum: ["duplicate", "credit_match", "orphan_credit"],
          },
          receipt_ids: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
          reason: { type: SchemaType.STRING },
        },
        required: ["kind", "receipt_ids", "reason"],
      },
    },
  },
  required: ["groups"],
};

const DEDUP_SYSTEM = `אתה עוזר למיין שורות של קבלות וזיכויים. תקבל רשימת JSON של שורות (id, חנות, סכום, תאריך, סוג).
זהה:
1. כפילויות — אותה חנות, אותו תאריך (±יום), סכום קרוב (±0.5%). kind="duplicate".
2. זיכוי תואם — שורת זיכוי שתואמת בקירוב לקבלה חיובית מאותה חנות בסכום מוחלט קרוב. kind="credit_match".
3. זיכוי יתום — זיכוי שאין לו קבלה תואמת בקלט. kind="orphan_credit".
אם אין קבוצות — groups=[].`;

export async function detectDuplicatesAndCredits(
  rows: Array<{ id: string; storeName: string | null; amount: number | null; date: string | null; documentType: string }>,
): Promise<DedupGroup[]> {
  if (rows.length === 0) return [];

  const compact = rows.map((r) => ({
    id: r.id,
    s: r.storeName,
    a: r.amount,
    d: r.date,
    t: r.documentType,
  }));

  const m = model({
    systemInstruction: DEDUP_SYSTEM,
    responseSchema: DEDUP_SCHEMA,
  });

  const result = await m.generateContent([
    { text: `נתונים:\n${JSON.stringify(compact)}` },
  ]);

  const raw = result.response.text();
  try {
    const parsed = JSON.parse(raw) as { groups: DedupGroup[] };
    return parsed.groups || [];
  } catch {
    return [];
  }
}

// ============================================================================
// parseStatementPDF
// ============================================================================

const STATEMENT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    source_label: { type: SchemaType.STRING },
    transactions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          date: { type: SchemaType.STRING, nullable: true },
          amount: { type: SchemaType.NUMBER, nullable: true },
          description: { type: SchemaType.STRING, nullable: true },
        },
        required: ["date", "amount", "description"],
      },
    },
  },
  required: ["source_label", "transactions"],
};

const STATEMENT_SYSTEM = `אתה מחלץ תנועות חיוב מתדפיסי בנק וחשבונות אשראי ישראליים (PDF).
- כל חיוב חייב להיות שלילי (כסף שיצא). זיכוי/החזר חיובי.
- אסור להמציא תנועות. אם שורה לא ברורה — דלג.
- date חייב להיות YYYY-MM-DD.
- description בעברית, מקוצץ עד ~120 תווים.`;

export async function parseStatementPDF(args: {
  pdfBase64: string;
  hint?: string;
}): Promise<{
  source_label: string;
  transactions: Array<{ date: string | null; amount: number | null; description: string | null }>;
}> {
  const m = model({
    systemInstruction: STATEMENT_SYSTEM,
    responseSchema: STATEMENT_SCHEMA,
  });

  const result = await m.generateContent([
    { inlineData: { data: args.pdfBase64, mimeType: "application/pdf" } },
    { text: args.hint ? `רמז: ${args.hint}. חלץ את כל התנועות.` : "חלץ את כל התנועות." },
  ]);

  const raw = result.response.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { source_label: "לא ידוע", transactions: [] };
  }
}
