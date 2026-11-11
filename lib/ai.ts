import { requestStructuredText } from "./openai-responses";
import {
  EXTRACTED_DOC_TYPE,
  EXTRACTED_METHOD,
  GOV_EXPENSE_CATEGORY,
  type Category,
  type Confidence,
  type ExtractedDocType,
  type ExtractedMethod,
  type GovExpenseCategory,
} from "./types";
import { normalizeReceiptDateFacts } from "./receipt-dates";

const DOCUMENT_MODEL = "gpt-6.1-sol";
const TEXT_MODEL = "gpt-6-luna";

// OpenAI strict enums reject literal quotes in category labels such as Lawyer's.
const categoryLabels = new Map(Object.entries(GOV_EXPENSE_CATEGORY));
const categoryIds = [...categoryLabels.keys()];
const categoryGuide = [...categoryLabels].map(([id, label]) => `${id} = ${label}`).join("\n");

// ============================================================================
// extractReceipt
// ============================================================================

export interface ExtractedPayment {
  method: ExtractedMethod;
  amount: number;
  card_last4: string | null;
}

export interface ExtractedReceipt {
  store_name: string | null;
  matched_known_store: boolean;
  issue_date: string | null;
  billing_period: string | null;
  due_date: string | null;
  payment_dates: string[];
  bank_debit_dates: string[];
  category: Category;
  document_type: ExtractedDocType;
  confidence: Confidence;
  total_amount: number | null;
  payments: ExtractedPayment[];
}

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    store_name: { type: ["string", "null"] },
    matched_known_store: { type: "boolean" },
    issue_date: {
      type: ["string", "null"],
      description: "YYYY-MM-DD or null",
    },
    billing_period: {
      type: ["string", "null"],
      description: "printed source text or null",
    },
    due_date: {
      type: ["string", "null"],
      description: "YYYY-MM-DD or null",
    },
    payment_dates: {
      type: "array",
      items: { type: "string" },
      description: "every explicit completed-payment date as YYYY-MM-DD",
    },
    bank_debit_dates: {
      type: "array",
      items: { type: "string" },
      description:
        "every explicit scheduled bank-account debit or not-before anchor as YYYY-MM-DD",
    },
    category: { type: "string", enum: categoryIds },
    document_type: {
      type: "string",
      enum: Object.values(EXTRACTED_DOC_TYPE),
    },
    confidence: { type: "string", enum: ["low", "med", "high"] },
    total_amount: { type: ["number", "null"] },
    payments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          method: {
            type: "string",
            enum: Object.values(EXTRACTED_METHOD),
          },
          amount: { type: "number" },
          card_last4: { type: ["string", "null"] },
        },
        required: ["method", "amount", "card_last4"],
      },
    },
  },
  required: [
    "store_name",
    "matched_known_store",
    "issue_date",
    "billing_period",
    "due_date",
    "payment_dates",
    "bank_debit_dates",
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
- **total_amount, receipt date facts, card_last4**: same rule — only what you can physically see printed on the image. Never inferred, calculated, or remembered.
- If you "recognise" the receipt as belonging to a known chain but cannot actually read the chain name on the image → store_name=null. Do not fill it in from memory.

## General rules
1. Amounts are always positive and include VAT. There are no credits.
2. If a scalar field is unreadable, return null; if a date list has no readable entries, return []. **Prefer null or [] over guessing.** Never invent stores, amounts, or dates.
3. Date values use YYYY-MM-DD only. Convert from dd/mm/yyyy or dd.mm.yy. Valid years: 2018–2030. If the year you extracted falls outside this range (e.g., 1990, 2010, 2044), it is almost certainly an OCR error on a recent Israeli receipt — omit that date rather than reporting a nonsensical year.

## Receipt date facts
- **issue_date**: printed preparation, edit, invoice, or issue dates; for an ordinary point-of-sale receipt, use its printed receipt date.
- **billing_period**: copy the printed source text exactly. Never expand it into invented day boundaries.
- **due_date**: include only an explicit payment deadline. A bank-account debit label is not a deadline unless the document explicitly gives both roles.
- **payment_dates**: include every date explicitly tied to a completed tender or receipt of funds, including receipts/payment tables and completed Bit, card, cash, or transfer rows.
- **bank_debit_dates**: include every explicit scheduled account-charge date. "Not before DATE" contributes DATE itself, not the next day.
- A standing-order payment method alone contributes no date.
- Missing or unreadable facts return null or [].

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
Return the category ID for the selected Hebrew label:
${categoryGuide}

The category list is **fixed** — it is the same 23-category list used by the
government insolvency report. Pick exactly one from this list — never invent
a new one. Most of the categories below are rare on photographed receipts
(e.g. rent/mortgage/trustee payments are normally bank transfers, not
receipts) — use "שונות" whenever nothing clearly fits.

- "שכר דירה" — rent payment receipts.
- "משכנתא" — mortgage payment receipts.
- "מיסי עירייה" — ארנונה, municipal property tax bills.
- "כלכלה (מזון)" — all food: supermarkets (שופרסל, רמי לוי, ויקטורי, יוחננוף, AM:PM, טיב טעם, מחסני השוק, יינות ביתן), small grocers, bakeries, neighborhood shops, restaurants, cafes, pizza, fast food.
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
- "תשלום חודשי לממונה" — payment receipts made out to the court-appointed insolvency trustee (כונס נכסים, ממונה).
- "הוצאות רפואיות חריגות" — pharmacies (סופרפארם, בה"כל, ניו פארם), doctors, clinics, dental, optometrist, medical equipment.
- "נסיעות בתחבורה ציבורית" — daily public transport: רב-קו, אגד, דן, מטרופולין, רכבת ישראל, מטרו, taxis (גט, יאנגו, מוניות).
- "הוצאות טיפול בילדים עד גיל 3" — daycare, מעון, צהרון, babysitter, baby formula/diapers when clearly identified.
- "תשלום מזונות לזכאים" — alimony/child-support payment receipts.
- "תספורת" — barber, hair salon (מספרה).
- "שונות" — anything that doesn't fit any of the above, **and** anything you cannot confidently categorize. This is the catch-all — use it freely instead of guessing.
- 'עו"ד' — lawyer fees, legal representation invoices.
- "כלי בית ותחזוקה" — household goods, cleaning supplies, home-maintenance and repair items.

## confidence
- high = store, total amount, relevant readable date facts, and category are confidently filled.
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
  - "VISA 1234" / "אשראי 1234" / "כרטיס xxxx-xxxx-xxxx-1234" → method="credit_card", card_last4="1234".
  - "מזומן" / "Cash" → method="cash", card_last4=null.
  - Other card → method="credit_card", card_last4 is the 4 digits you see.
  - "הוראת קבע" / "הו\"ק" / "ישולם בהו\"ק" / "מחשבון 1234" / "חיוב מחשבון" / "Standing order" → method="standing_order", card_last4=null. Used for utility bills, mobile, daycare, and other recurring bank-account debits. The receipt is informational; the actual money moves later via the bank.
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

  const raw = await requestStructuredText({
    model: DOCUMENT_MODEL,
    instructions: RECEIPT_SYSTEM,
    name: "receipt",
    schema: RECEIPT_SCHEMA,
    text: `File name: ${fileName}\nExtract the fields. Return null for any field you cannot read with confidence.${knownBlock}`,
    attachment: { data: imageBase64, mimeType: mediaType },
  });
  const parsed = JSON.parse(raw) as Omit<ExtractedReceipt, "category"> & { category: string };
  const out: ExtractedReceipt = {
    ...parsed,
    category: categoryLabels.get(parsed.category) ?? GOV_EXPENSE_CATEGORY.Miscellaneous,
  };
  if (typeof out.matched_known_store !== "boolean") {
    out.matched_known_store = false;
  }
  if (!Array.isArray(out.payments)) {
    out.payments = [];
  }
  const dateFacts = normalizeReceiptDateFacts({
    issueDate: out.issue_date,
    billingPeriod: out.billing_period,
    dueDate: out.due_date,
    paymentDates: out.payment_dates,
    bankDebitDates: out.bank_debit_dates,
  });
  out.issue_date = dateFacts.issueDate;
  out.billing_period = dateFacts.billingPeriod;
  out.due_date = dateFacts.dueDate;
  out.payment_dates = dateFacts.paymentDates;
  out.bank_debit_dates = dateFacts.bankDebitDates;
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
  type: "object",
  additionalProperties: false,
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          canonical: { type: "string" },
          variants: {
            type: "array",
            items: { type: "string" },
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

  const raw = await requestStructuredText({
    model: TEXT_MODEL,
    instructions: CANON_SYSTEM,
    name: "canonical_stores",
    schema: CANON_SCHEMA,
    text: `Names to group:\n${JSON.stringify(unique)}`,
  });
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
  type: "object",
  additionalProperties: false,
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["duplicate", "receipt_slip_pair"],
          },
          receipt_ids: {
            type: "array",
            items: { type: "string" },
          },
          reason: { type: "string" },
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

  const raw = await requestStructuredText({
    model: TEXT_MODEL,
    instructions: DEDUP_SYSTEM,
    name: "duplicate_groups",
    schema: DEDUP_SCHEMA,
    text: `Rows:\n${JSON.stringify(compact)}`,
  });
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
  type: "object",
  additionalProperties: false,
  properties: {
    source_label: { type: "string" },
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: ["string", "null"] },
          amount: { type: ["number", "null"] },
          description: { type: ["string", "null"] },
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
  const raw = await requestStructuredText({
    model: DOCUMENT_MODEL,
    instructions: STATEMENT_SYSTEM,
    name: "statement",
    schema: STATEMENT_SCHEMA,
    text: args.hint ? `רמז: ${args.hint}. חלץ את כל התנועות.` : "חלץ את כל התנועות.",
    attachment: { data: args.pdfBase64, mimeType: "application/pdf" },
  });
  try {
    return JSON.parse(raw);
  } catch {
    return { source_label: "לא ידוע", transactions: [] };
  }
}

// ============================================================================
// parseSalarySlip
// ============================================================================

export interface SalarySlip {
  month: number | null; // month the slip is FOR (work/eligibility month), 1-12
  year: number | null;
  net: number | null; // net pay (נטו לתשלום), the amount that reaches the bank
  gross: number | null; // total payments (ברוטו)
  deductions: number | null; // total deductions (ניכויים)
  employer: string | null; // e.g. "עיריית חריש" / "מופת/צה\"ל"
}

const SALARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    month: { type: ["number", "null"] },
    year: { type: ["number", "null"] },
    net: { type: ["number", "null"] },
    gross: { type: ["number", "null"] },
    deductions: { type: ["number", "null"] },
    employer: { type: ["string", "null"] },
  },
  required: ["month", "year", "net", "gross", "deductions", "employer"],
};

const SALARY_SYSTEM = `You extract data from an Israeli salary slip (PDF).
- month/year: the month and year the salary is FOR (the pay month, "עבור חודש"), NOT the actual payment date.
- net: the net pay that reaches the bank. If an explicit "נטו לתשלום" or "שכר חודשי נטו" line exists, use it. Otherwise compute total payments (gross) minus total deductions.
- gross: total payments / gross. deductions: total deductions.
- employer: the employer or income source (e.g. "עיריית חריש", "מופת/צה\"ל").
- Never invent data. Prefer null over guessing. All amounts in ₪ as plain numbers (no ₪ sign or commas).`;

export async function parseSalarySlip(args: {
  pdfBase64: string;
  hint?: string;
}): Promise<SalarySlip> {
  const raw = await requestStructuredText({
    model: DOCUMENT_MODEL,
    instructions: SALARY_SYSTEM,
    name: "salary_slip",
    schema: SALARY_SCHEMA,
    text: args.hint
      ? `רמז: ${args.hint}. חלץ את נתוני התלוש.`
      : "חלץ את נתוני התלוש.",
    attachment: { data: args.pdfBase64, mimeType: "application/pdf" },
  });
  try {
    return JSON.parse(raw);
  } catch {
    return { month: null, year: null, net: null, gross: null, deductions: null, employer: null };
  }
}

// ============================================================================
// classifyExpenses — map expense lines to the fixed government categories
// ============================================================================

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          i: { type: "integer" },
          category: { type: "string", enum: categoryIds },
        },
        required: ["i", "category"],
      },
    },
  },
  required: ["results"],
};

const CLASSIFY_SYSTEM = `You classify Israeli household expenses into the FIXED government insolvency-report categories. For each item return the category ID matching the Hebrew label:
${categoryGuide}

Mapping hints (merchant → category):
- supermarket / grocery / food store / bakery (שופרסל, רמי לוי, ויקטורי, יינות ביתן) → "כלכלה (מזון)"
- fuel / garage / parking / toll road / car insurance or test → "אחזקת רכב"
- public transport (רב-קו, אגד, רכבת, מטרונית) → "נסיעות בתחבורה ציבורית"
- electricity company → "חשמל"; water corporation → "מים"; gas company → "גז"
- municipality / ארנונה → "מיסי עירייה"
- Israeli comms carriers (פרטנר, סלקום, פלאפון, הוט, בזק, יס) sell BOTH mobile and home services. If the line mentions fiber/internet/TV/landline (סיבים, אינטרנט, טלוויזיה, קו ביתי, bezeq/yes/HOT home plans) → "תקשורת ביתית (טלפון, טלוויזיה, אינטרנט)". Only a plain mobile-carrier charge with no home-service indication → "טלפון נייד".
- pharmacy / HMO / clinic / doctor → "הוצאות רפואיות חריגות"
- clothing / footwear → "הלבשה"
- barber / hair salon → "תספורת"
- lawyer → "עו\"ד"
- house committee (ועד בית) → "וועד בית"
- receiver / trustee / payment to trustee (כונס, ממונה) → "תשלום חודשי לממונה"
- household goods / cleaning supplies / home maintenance → "כלי בית ותחזוקה"
- school / tuition / courses / books / cinema (סינמה סיטי, יס פלאנט) / museums / attractions / חוגים → "חינוך ותרבות"
- if nothing clearly fits → "שונות".

For each item return its i and its category. Do not invent categories outside the list.`;

// Classify a batch of expense lines. Returns one category per item, aligned by
// index; off-list / missing answers fall back to "שונות".
export async function classifyExpenses(
  items: Array<{ description: string; amount: number }>,
): Promise<GovExpenseCategory[]> {
  if (items.length === 0) return [];

  const payload = items.map((it, i) => ({ i, name: it.description, amount: it.amount }));
  const raw = await requestStructuredText({
    model: TEXT_MODEL,
    instructions: CLASSIFY_SYSTEM,
    name: "expense_categories",
    schema: CLASSIFY_SCHEMA,
    text: `סווג את הפריטים הבאים (JSON):\n${JSON.stringify(payload)}`,
  });
  const out: GovExpenseCategory[] = items.map(() => GOV_EXPENSE_CATEGORY.Miscellaneous);
  try {
    const parsed = JSON.parse(raw) as { results: Array<{ i: number; category: string }> };
    for (const r of parsed.results ?? []) {
      const category = categoryLabels.get(r.category);
      if (r.i >= 0 && r.i < items.length && category) {
        out[r.i] = category;
      }
    }
  } catch {
    // keep fallbacks
  }
  return out;
}

// ============================================================================
// parseDirectStatement — individual charges from a Direct/credit card statement
// ============================================================================

export interface DirectCharge {
  date: string | null; // transaction date (YYYY-MM-DD)
  merchant: string | null; // שם בית העסק
  amount: number | null; // positive ₪ (סכום החיוב בש"ח); sign set by isCredit
  isCredit: boolean; // זיכוי/refund
}

const DIRECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    charges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: ["string", "null"] },
          merchant: { type: ["string", "null"] },
          amount: { type: ["number", "null"] },
          isCredit: { type: "boolean" },
        },
        required: ["date", "merchant", "amount", "isCredit"],
      },
    },
  },
  required: ["charges"],
};

const DIRECT_SYSTEM = `You extract individual charges from an Israeli immediate-debit credit-card statement (e.g. Isracard "MC דירקט").
- Return ONLY individual merchant charges. For each: the transaction date, the merchant name, and the shekel (₪) billing amount.
- NEVER return summary or total rows of any kind: "סה\"כ חיוב לתאריך", "סה\"כ", subtotals, balances, section headers (e.g. "עסקות שחויבו / זוכו - בארץ", "רכישות בחו\"ל", "עסקות לתאריך החיוב"), billing-date dividers, or any roll-up line.
- Refunds/credits (marked "זיכוי") → isCredit=true. A normal charge → isCredit=false.
- date: YYYY-MM-DD, taken from the transaction date.
- merchant: the business name exactly as printed (keep Hebrew or Latin script as-is).
- amount: the ₪ billing amount as a positive number (no ₪ sign or commas). The sign is conveyed by isCredit.
- IMPORTANT: skip charges billed in a foreign currency ($, €, etc.) that have no ₪ billing amount in the statement (e.g. ANTHROPIC, CLAUDE, HETZNER in foreign currency). Those settle in the bank account as "קיזוז מטח" lines and are handled from there. Return only charges that have a ₪ billing amount.
- Never invent data (including currency conversions). Skip any row that is not a single ₪ merchant charge.`;

export async function parseDirectStatement(args: {
  pdfBase64: string;
  hint?: string;
}): Promise<{ charges: DirectCharge[] }> {
  const raw = await requestStructuredText({
    model: DOCUMENT_MODEL,
    instructions: DIRECT_SYSTEM,
    name: "direct_charges",
    schema: DIRECT_SCHEMA,
    text: args.hint
      ? `רמז: ${args.hint}. חלץ את כל החיובים הבודדים בלבד (ללא שורות סיכום).`
      : "חלץ את כל החיובים הבודדים בלבד (ללא שורות סיכום).",
    attachment: { data: args.pdfBase64, mimeType: "application/pdf" },
  });
  try {
    const parsed = JSON.parse(raw) as { charges: DirectCharge[] };
    return { charges: parsed.charges ?? [] };
  } catch {
    return { charges: [] };
  }
}
