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
// ForeignCard = a credit card whose last-4 is not in the user's myCardsLast4
// list — kept for documentation but not usable as proof of purchase.
export const PAYMENT_METHOD = {
  Credit: "אשראי",
  ForeignCard: "אשראי (כרטיס אחר)",
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
// Government insolvency report — fixed income/expense categories
// ----------------------------------------------------------------------------
// The official bi-monthly report ("דו"ח על הכנסות והוצאות") has a legally fixed
// set of rows. These are the canonical target enum for the report feature:
// every parsed transaction/income is mapped INTO one of these. Verbatim Hebrew
// strings mirror the government template; do not edit without legal reason.
// (See INSOLVENCY-REPORT-PLAN.md §3.) NOTE: distinct from CATEGORIES above,
// which is the receipt-scanner's own taxonomy.
// ============================================================================

// 6 fixed income rows (template §3.1)
export const GOV_INCOME_CATEGORY = {
  Salary: "הכנסה ממשכורת (נטו)",
  Business: "הכנסה מעסק",
  Pension: "פנסיה",
  RentAssistance: "הכנסה משכר דירה / סיוע בשכר דירה",
  NationalInsurance: "קצבאות מהמוסד לביטוח לאומי",
  Alimony: "הכנסות מתשלום מזונות",
} as const;
export type GovIncomeCategory = (typeof GOV_INCOME_CATEGORY)[keyof typeof GOV_INCOME_CATEGORY];
export const GOV_INCOME_CATEGORIES: GovIncomeCategory[] = Object.values(GOV_INCOME_CATEGORY);

// 23 named expense rows (the clean gov template lists these; a trailing blank
// spare row is not a category). The Food label carries a dynamic "מס' נפשות __"
// (household size) suffix on the actual report — stored here as the clean stem
// and filled with the count at generate-time.
export const GOV_EXPENSE_CATEGORY = {
  Rent: "שכר דירה",
  Mortgage: "משכנתא",
  MunicipalTax: "מיסי עירייה",
  Food: "כלכלה (מזון)",
  HomeComms: "תקשורת ביתית (טלפון, טלוויזיה, אינטרנט)",
  MobilePhone: "טלפון נייד",
  Gas: "גז",
  BuildingCommittee: "וועד בית",
  Water: "מים",
  Electricity: "חשמל",
  Clothing: "הלבשה",
  CarMaintenance: "אחזקת רכב",
  Education: "חינוך ותרבות",
  Travel: "נסיעות",
  TrusteePayment: "תשלום חודשי לממונה",
  ExceptionalMedical: "הוצאות רפואיות חריגות",
  PublicTransport: "נסיעות בתחבורה ציבורית",
  ChildcareUnder3: "הוצאות טיפול בילדים עד גיל 3",
  AlimonyPaid: "תשלום מזונות לזכאים",
  Haircut: "תספורת",
  Miscellaneous: "שונות",
  Lawyer: "עו\"ד",
  HouseholdGoods: "כלי בית ותחזוקה",
} as const;
export type GovExpenseCategory = (typeof GOV_EXPENSE_CATEGORY)[keyof typeof GOV_EXPENSE_CATEGORY];
export const GOV_EXPENSE_CATEGORIES: GovExpenseCategory[] = Object.values(GOV_EXPENSE_CATEGORY);

// ----------------------------------------------------------------------------
// Retail-pharmacy default: drugstore chains whose spend defaults to
// food/household ("כלכלה (מזון)"), NOT medical — toiletries/cosmetics dominate.
// Health-fund pharmacies (מכבי פארם, בית מרקחת כללית) are deliberately excluded
// (matched on FULL chain names, not the bare word "פארם"), so they stay
// "הוצאות רפואיות חריגות". Tokens are pre-normalized (see normalizeStoreName).
// ----------------------------------------------------------------------------
export const PHARMACY_CHAINS = [
  "סופרפארם",
  "ניופארם",
  "גודפארם",
  "superpharm",
  "newpharm",
  "goodpharm",
] as const;

// Normalize a store name for tolerant matching: lowercase, strip spaces and
// hyphens (ASCII "-" and Hebrew maqaf "־").
export function normalizeStoreName(s: string): string {
  return s.toLowerCase().replace(/[\s\-־]/g, "");
}

// True when the description names one of PHARMACY_CHAINS (normalized substring),
// e.g. `סופר-פארם ר"ג`, `SUPER-PHARM #123`, `ניו פארם`.
export function isPharmacyStore(description: string): boolean {
  const n = normalizeStoreName(description);
  return PHARMACY_CHAINS.some((chain) => n.includes(chain));
}

// ============================================================================
// Report period + individual (one report per individual; shared household data)
// ============================================================================

// One insolvency case-holder. The pipeline is identical per individual; only
// these identity fields differ (figures are the shared household roll-up).
export interface Individual {
  name: string;
  caseNumber: string; // תיק number
  address: string;
  phone: string;
}

// A bi-monthly reporting period, e.g. months 5+6 of 2026 → folder "5-6_2026".
export interface ReportPeriod {
  year: number;
  month1: number; // 1-12
  month2: number; // 1-12
  folderName: string; // "<month1>-<month2>_<year>"
}

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
