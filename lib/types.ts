export const CATEGORIES = [
  "מיסי עירייה",
  "כלכלה (מזון) - מס' נפשות 3",
  "תקשורת ביתית (טלפון, טלוויזיה, אינטרנט)",
  "טלפון נייד",
  "גז",
  "וועד בית",
  "מים",
  "חשמל",
  "הלבשה",
  "אחזקת רכב",
  "חינוך ותרבות",
  "נסיעות",
  "הוצאות רפואיות חריגות",
  "נסיעות בתחבורה ציבורית",
  "הוצאות טיפול בילדים עד גיל 3",
  "תספורת",
  "שונות",
  "עו\"ד מייצג בהליך",
] as const;

export type Category = (typeof CATEGORIES)[number];

// ============================================================================
// Payment & document type enums (single source of truth — never inline literals)
// ============================================================================

// Internal values returned by Gemini in OCR extraction
export const EXTRACTED_METHOD = {
  CreditCard: "credit_card",
  Cash: "cash",
  StandingOrder: "standing_order",
  Other: "other",
} as const;
export type ExtractedMethod = (typeof EXTRACTED_METHOD)[keyof typeof EXTRACTED_METHOD];

// User-facing payment method labels (Hebrew, displayed in UI + sheet)
export const PAYMENT_METHOD = {
  Credit: "אשראי",
  Cash: "מזומן",
  StandingOrder: "הוראת קבע",
  Mixed: "מעורב",
  Other: "אחר",
  Unknown: "לא ידוע",
} as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];
export const PAYMENT_METHODS: PaymentMethod[] = Object.values(PAYMENT_METHOD);

// Internal values returned by Gemini for document_type
export const EXTRACTED_DOC_TYPE = {
  Receipt: "receipt",
  CreditSlip: "credit_slip",
  Unknown: "unknown",
} as const;
export type ExtractedDocType = (typeof EXTRACTED_DOC_TYPE)[keyof typeof EXTRACTED_DOC_TYPE];

// User-facing document type labels (Hebrew)
export const DOCUMENT_TYPE = {
  Receipt: "קבלה",
  TaxInvoice: "חשבונית מס",
  CreditSlip: "ספח אשראי",
  Duplicate: "כפילות",
  Unknown: "לא ידוע",
} as const;
export type DocumentType = (typeof DOCUMENT_TYPE)[keyof typeof DOCUMENT_TYPE];
export const DOCUMENT_TYPES: DocumentType[] = Object.values(DOCUMENT_TYPE);

// Default fallbacks (kept as named constants so call sites never hardcode)
export const DEFAULT_STORE_NAME = "לא ידוע";
export const DEFAULT_CATEGORY: Category = "שונות";

// ============================================================================
// Settings (stored in הגדרות sheet tab)
// ============================================================================

export const SETTINGS_KEY = {
  MyCardsLast4: "myCardsLast4",
} as const;
export type SettingsKey = (typeof SETTINGS_KEY)[keyof typeof SETTINGS_KEY];

export interface UserSettings {
  myCardsLast4: string[]; // exactly 4-digit strings, validated
}

// ============================================================================
// Receipt + bank txn shapes
// ============================================================================

export type Confidence = "low" | "med" | "high";

export interface Receipt {
  id: string;
  fileName: string;
  driveFileId?: string | null;
  storeName: string | null;
  amount: number | null;
  date: string | null;
  category: Category;
  documentType: DocumentType;
  paymentMethod: PaymentMethod;
  cardLast4?: string | null;
  totalReceiptAmount?: number | null;
  linkedTo?: string | null;
  confidence: Confidence;
  reviewed: boolean;
  notes?: string;
}

export interface BankTxn {
  source: string;
  date: string | null;
  amount: number | null;
  description: string | null;
  receiptId?: string | null;
  status: "תואם" | "חסרה קבלה" | "קבלה ללא תנועה" | null;
}

// ============================================================================
// Sheet tabs
// ============================================================================

export const SHEET_TAB_RECEIPTS = "קבלות";
export const SHEET_TAB_TXNS = "תנועות";
export const SHEET_TAB_STORES = "חנויות";
export const SHEET_TAB_SETTINGS = "הגדרות";

export interface Store {
  canonical: string;
  count: number;
  variants: string[];
}

export const STORE_HEADERS: ReadonlyArray<string> = [
  "שם קנוני",
  "ספירה",
  "וריאציות",
];

export const RECEIPT_HEADERS: ReadonlyArray<string> = [
  "id",
  "שם קובץ",
  "שם חנות",
  "סכום",
  "תאריך",
  "קטגוריה",
  "סוג מסמך",
  "אמצעי תשלום",
  "סכום קבלה כולל",
  "4 ספרות אחרונות",
  "מקושר ל",
  "confidence",
  "drive_file_id",
  "נבדק ידנית",
  "הערות",
];

export const TXN_HEADERS: ReadonlyArray<string> = [
  "מקור",
  "תאריך",
  "סכום",
  "תיאור",
  "קבלה_id",
  "סטטוס",
];

export const SETTINGS_HEADERS: ReadonlyArray<string> = ["key", "value"];
