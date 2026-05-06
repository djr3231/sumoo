export const CATEGORIES = [
  "מזון",
  "סופר",
  "תחבורה",
  "דלק",
  "מסעדות",
  "בריאות",
  "בית",
  "בידור",
  "ביגוד",
  "שירותים",
  "אחר",
  "לא ידוע",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type DocumentType =
  | "קבלה"
  | "חשבונית מס"
  | "ספח אשראי"
  | "זיכוי"
  | "כפילות"
  | "זיכוי-יתום"
  | "לא ידוע";

export const DOCUMENT_TYPES: DocumentType[] = [
  "קבלה",
  "חשבונית מס",
  "ספח אשראי",
  "זיכוי",
  "כפילות",
  "זיכוי-יתום",
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
