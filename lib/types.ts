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

export type DocumentType =
  | "קבלה"
  | "חשבונית מס"
  | "ספח אשראי"
  | "כפילות"
  | "לא ידוע";

export const DOCUMENT_TYPES: DocumentType[] = [
  "קבלה",
  "חשבונית מס",
  "ספח אשראי",
  "כפילות",
  "לא ידוע",
];

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

export const SHEET_TAB_RECEIPTS = "קבלות";
export const SHEET_TAB_TXNS = "תנועות";
export const SHEET_TAB_STORES = "חנויות";

export type PaymentMethod = "אשראי" | "מזומן" | "מעורב" | "אחר" | "לא ידוע";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "אשראי",
  "מזומן",
  "מעורב",
  "אחר",
  "לא ידוע",
];

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
