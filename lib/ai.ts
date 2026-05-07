import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
} from "@google/generative-ai";
import { CATEGORIES, type Category, type Confidence } from "./types";

const OCR_MODEL = "gemini-2.5-pro";
const UTIL_MODEL = "gemini-2.5-flash";

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
  modelName: string;
  systemInstruction: string;
  responseSchema: object;
  temperature?: number;
}): GenerativeModel {
  return client().getGenerativeModel({
    model: args.modelName,
    systemInstruction: args.systemInstruction,
    generationConfig: {
      temperature: args.temperature ?? 0,
      responseMimeType: "application/json",
      responseSchema: args.responseSchema as never,
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message ?? "";
      const retryable =
        /\b503\b|\b429\b|Service Unavailable|Too Many Requests|overloaded/i.test(
          msg,
        );
      if (!retryable || i === attempts - 1) throw err;
      console.warn(
        `Gemini transient (attempt ${i + 1}/${attempts}), retry in 3s`,
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("unreachable");
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

const RECEIPT_SYSTEM = `You extract data from Israeli receipts and credit-card slips. Input is an image (JPG/PNG) or a scanned PDF. The user keeps a personal expense ledger and only ever photographs/scans **two document types**: (1) receipts / tax invoices, (2) credit-card slips ("ספח אשראי"). They never photograph credit notes, vendor invoices, or anything else.

## CRITICAL: Only read from the image. Never use training knowledge.
Every field you return MUST come from text you can visually read in the image.

- **store_name**: Read it from the image. If you cannot see and read the store name printed on the document → return null.
  - Do NOT substitute a brand name you recognise from training data.
  - Do NOT infer the store name from the receipt format, card-terminal model, paper colour, or category you guessed.
  - Do NOT use geographic / location knowledge ("this looks like a fuel station near a junction I know").
  - If the image clearly shows "מאפית הצבי" → return "מאפית הצבי", even if your category guess is "fuel".
  - A verbatim OCR reading that looks slightly garbled is correct. A plausible-sounding invented name is WRONG.
- **total_amount, date, card_last4**: same rule — only what you can physically see printed on the image. Never inferred, calculated, or remembered.
- If you "recognise" the receipt as belonging to a known chain but cannot actually read the chain name on the image → store_name=null. Do not fill it in from memory.

## General rules
1. Amounts are always positive and include VAT. There are no credits.
2. If a field is unreadable, return null. **Prefer null over guessing.** Never invent stores, amounts, or dates.
3. Date format: YYYY-MM-DD only. Convert from dd/mm/yyyy or dd.mm.yy. If absent → null.

## Image orientation — important
Images may be rotated 90° (CW or CCW) or 180°. Always mentally rotate the image until the Hebrew text reads correctly (right-to-left as expected) before extracting any data. If you cannot orient the image, return null fields rather than guessing.

## total_amount — the field the user is most sensitive to
- First look for the literal label **"לתשלום"**, **"סה"כ לתשלום"**, **"סך הכל לתשלום"**, **"סכום לתשלום"**, or **"TOTAL"**. This is almost always bold/larger and near the bottom. **That number is the total_amount.**
- Do NOT confuse it with:
  - "מזומן" / "התקבל" / "שולם" — cash tendered by the customer; can be larger than the total.
  - "עודף" / "החזר" — change returned to the customer.
  - "סה"כ ביניים" / "subtotal" — pre-VAT or pre-discount.
- Example: a line "מזומן 100.00 / לתשלום 87.50 / עודף 12.50" → total_amount=87.50.
- Only if no explicit "לתשלום"/"סה"כ" label exists, fall back to context (last/largest amount).

## Store name placement
- The store name is almost always on the **first line** (large font / logo).
- If the receipt is upside-down, it will be on the last line before you rotate it.
- Secondary cues: "ח.פ." / "ע.מ." / a registered address — the store name typically sits just above them.
- **Never** return footer text (website URL, phone number, "תודה רבה") as the store name.

## Categories
The category list is **fixed**. Pick exactly one from this list — never invent a new one.

- "מיסי עירייה" — ארנונה, municipal property tax bills.
- "כלכלה (מזון) - מס' נפשות 3" — all food: supermarkets (שופרסל, רמי לוי, ויקטורי, יוחננוף, AM:PM, טיב טעם, מחסני השוק, יינות ביתן), small grocers, bakeries, neighborhood shops, restaurants, cafes, pizza, fast food.
- "תקשורת ביתית (טלפון, טלוויזיה, אינטרנט)" — landline, internet, TV/cable bills (בזק, HOT, יס, סלקום TV, פרטנר TV).
- "טלפון נייד" — mobile-phone bills only (פלאפון, סלקום, פרטנר, גולן טלקום, רמי לוי תקשורת, 019 mobile).
- "גז" — cooking-gas suppliers (פזגז, סופרגז, אמישראגז, דור גז).
- "וועד בית" — building maintenance / homeowners-association payments.
- "מים" — water utility bills (תאגיד מים, מי אביבים, הגיחון, מקורות).
- "חשמל" — electricity bills (חברת החשמל, electricity suppliers).
- "הלבשה" — clothing and footwear (H&M, זארה, רנואר, פוקס, הוניגמן, קסטרו, shoes).
- "אחזקת רכב" — car-related: fuel (פז, סונול, דלק, ten, סדש), parking, garage, car wash, repairs, registration.
- "חינוך ותרבות" — schools, courses, books, movies (סינמה סיטי, יס פלאנט), museums, attractions, theatre, lessons, חוגים.
- "נסיעות" — travel and vacations (hotels, flights, trips, tour operators) — NOT daily public transport.
- "הוצאות רפואיות חריגות" — pharmacies (סופרפארם, בה"כל, ניו פארם), doctors, clinics, dental, optometrist, medical equipment.
- "נסיעות בתחבורה ציבורית" — daily public transport: רב-קו, אגד, דן, מטרופולין, רכבת ישראל, מטרו, taxis (גט, יאנגו, מוניות).
- "הוצאות טיפול בילדים עד גיל 3" — daycare, מעון, צהרון, babysitter, baby formula/diapers when clearly identified.
- "תספורת" — barber, hair salon (מספרה).
- 'עו"ד מייצג בהליך' — lawyer fees, legal representation invoices.
- "שונות" — anything that doesn't fit any of the above, **and** anything you cannot confidently categorize. This is the catch-all — use it freely instead of guessing.

## confidence
- high = all four fields (store, total amount, date, category) are confidently filled.
- med = one or two fields are null/uncertain.
- low = most fields null or image is too blurred.

## Canonical store names
If a list of canonical store names is supplied and your OCR reading is close (even with errors) to one of them, return **the canonical name exactly as listed** and matched_known_store=true. Otherwise it's a new name and matched_known_store=false.

## Document type — only two real types
- receipt = receipt / tax invoice / "חשבונית מס/קבלה". Has line-item breakdown, or explicitly labeled "קבלה" / "חשבונית מס".
- credit_slip = credit-card slip only — a separate paper from the credit-card terminal. Short, shows last-4 of card + card brand, no line items. Headers: "ספח אשראי", "אישור עסקה", "VISA", "ISRACARD", "אמריקן אקספרס", "מאסטרקארד".
- unknown = only if genuinely unclear.

**Never** return credit_note / זיכוי / refund — the user never photographs credits. If something looks like a credit, it is far more likely to actually be a credit_slip or a normal receipt.

## payments — critical
- total_amount = the receipt's grand total.
- payments = breakdown by tender method:
  - "VISA 6021" / "אשראי 6021" / "כרטיס xxxx-xxxx-xxxx-6021" → method="credit_card", card_last4="6021".
  - "מזומן" / "Cash" → method="cash", card_last4=null.
  - Other card → method="credit_card", card_last4 is the 4 digits you see.
  - Check / transfer → method="other".
- Most receipts have a single payment item. **If two distinct tender methods are clearly shown on the same receipt** (e.g. 60₪ on credit + 40₪ in cash), emit 2 separate items whose amounts sum to total_amount.
- If the tender method is unclear → payments=[{method:"other", amount: total_amount, card_last4: null}].
- Never invent the last-4 digits. If you do not see them clearly → null.`;

export async function extractReceipt(args: {
  imageBase64: string;
  mediaType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif"
    | "application/pdf";
  fileName: string;
  knownStores?: string[];
}): Promise<ExtractedReceipt> {
  const { imageBase64, mediaType, fileName, knownStores = [] } = args;

  const knownBlock =
    knownStores.length > 0
      ? `\n\nKnown canonical store names (if the receipt is from one of these, return the name exactly as listed):\n${knownStores
          .map((s, i) => `${i + 1}. ${s}`)
          .join("\n")}`
      : "\n\n(No canonical store list yet.)";

  const m = model({
    modelName: OCR_MODEL,
    systemInstruction: RECEIPT_SYSTEM,
    responseSchema: RECEIPT_SCHEMA,
  });

  const result = await withRetry(() =>
    m.generateContent([
      { inlineData: { data: imageBase64, mimeType: mediaType } },
      { text: `File name: ${fileName}\nExtract the fields. Return null for any field you cannot read with confidence.${knownBlock}` },
    ]),
  );

  const raw = result.response.text();
  const out = JSON.parse(raw) as ExtractedReceipt;

  if (!CATEGORIES.includes(out.category)) {
    out.category = "שונות";
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

const CANON_SYSTEM = `You group Israeli store names extracted from receipts via OCR. Several inputs may refer to the same physical store with OCR errors. Your job: cluster them into canonical groups.

## Structural fingerprinting — most important rule
Israeli business names often follow the pattern:
  [proprietor prefix]  [brand]  [district code]  [legal suffix]
Example: "ג.מ. מעיין אלפיים (07) בע"מ"  → prefix="ג.מ.", brand="מעיין אלפיים", code="07", suffix="בע"מ"

Two names that share **any two** of these structural elements are almost certainly the same store with OCR errors:
- Same district code: (07), (09), (03), (04), etc.
- Same proprietor / partnership prefix: ג.מ., א.מ., ד.נ., ש.ל., etc.
- Same legal suffix pattern: בע"מ, ע"מ, שות׳
- Same rare brand word: a distinctive Hebrew proper noun (מעיין, כרמל, ירושלים, צבי, אלון, etc.)

Concrete example — these three are the SAME store:
- "ג.מ. מעיין אלפיים (07) בע"מ"
- "ג.מ. סעייד אפיפים (07) בע"מ"
- "מעיין אלונים נעים"
(Shared: ג.מ. prefix, (07) code, distinctive root "מעיין" / "אפיפים" with OCR slippage between letters.)

## Personal-ledger prior
You are looking at receipts from ONE person's personal expense history. The probability that this person visited two genuinely different stores that share a district code AND a distinctive brand word is essentially zero. **Merge aggressively.**

## Common OCR confusions in Hebrew
א/ו/ן, מ/ם, פ/ף/ב, י/ו/ן, ס/ב, ל/כ, ר/ד, ה/ח, missing or extra dots in abbreviations (ג.מ. vs גמ), space drift, truncated letters, ׳/״ variants. Digits: 0/6/9, 1/ל.

## Merge threshold
When in doubt → merge. A wrongly merged pair is easy for the user to separate manually. A wrongly split pair creates phantom duplicate stores that drift further apart over time.

## Output rules
- Every input name MUST appear in exactly one group (no omissions, no duplicates across groups).
- canonical = the cleanest, most human-readable spelling among the variants. Prefer:
  - A name without abbreviation dots over one with them.
  - A name without legal suffix ("בע"מ") over one with it, IF the cleaner version exists in the input.
  - Otherwise, the longest most-complete variant.
- variants = all input names that map to this group (including the canonical).
- A name with no plausible match in the input → its own group with variants=[name].`;

export async function canonicalizeStoreNames(
  names: string[],
): Promise<CanonicalGroup[]> {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length <= 1) {
    return unique.map((n) => ({ canonical: n, variants: [n] }));
  }

  const m = model({
    modelName: UTIL_MODEL,
    systemInstruction: CANON_SYSTEM,
    responseSchema: CANON_SCHEMA,
  });

  const result = await withRetry(() =>
    m.generateContent([
      { text: `Names to group:\n${JSON.stringify(unique)}` },
    ]),
  );

  const raw = result.response.text();
  try {
    const parsed = JSON.parse(raw) as { groups: CanonicalGroup[] };
    return parsed.groups || [];
  } catch {
    return unique.map((n) => ({ canonical: n, variants: [n] }));
  }
}

// ============================================================================
// detectDuplicatesAndPairs
// ============================================================================

export interface DedupGroup {
  kind: "duplicate" | "receipt_slip_pair";
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
            enum: ["duplicate", "receipt_slip_pair"],
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

const DEDUP_SYSTEM = `You group rows of receipts and credit-card slips. You receive JSON rows: id, store, amount, date, type.

The user can have uploaded:
- A receipt only.
- A credit-card slip only (the receipt was lost; only the slip remains).
- Both a receipt and a slip for the same purchase.

Identify two kinds of groups:

1. **duplicate** — the same document scanned twice. Same store, same date (±1 day), amount within ±0.5%, same document type. The first row in the group is the primary.

2. **receipt_slip_pair** — a receipt (type "קבלה" or "חשבונית מס") AND a credit_slip (type "ספח אשראי") for the same purchase: same store, date ±1 day, amount within ±0.5%. The primary MUST be the receipt (not the slip); list the receipt's id first.

**Never** emit credit_match or orphan_credit — there are no credit notes in the input.
If nothing groups → groups=[].`;

export async function detectDuplicatesAndPairs(
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
    modelName: UTIL_MODEL,
    systemInstruction: DEDUP_SYSTEM,
    responseSchema: DEDUP_SCHEMA,
  });

  const result = await withRetry(() =>
    m.generateContent([{ text: `Rows:\n${JSON.stringify(compact)}` }]),
  );

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
    modelName: UTIL_MODEL,
    systemInstruction: STATEMENT_SYSTEM,
    responseSchema: STATEMENT_SCHEMA,
  });

  const result = await withRetry(() =>
    m.generateContent([
      { inlineData: { data: args.pdfBase64, mimeType: "application/pdf" } },
      { text: args.hint ? `רמז: ${args.hint}. חלץ את כל התנועות.` : "חלץ את כל התנועות." },
    ]),
  );

  const raw = result.response.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { source_label: "לא ידוע", transactions: [] };
  }
}
