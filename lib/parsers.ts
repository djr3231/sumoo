import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { BankTxn } from "./types";

const HEBREW_DATE_KEYS = ["תאריך", "תאריך עסקה", "תאריך חיוב", "תאריך ערך"];
const HEBREW_AMOUNT_KEYS = [
  "סכום",
  "חיוב",
  'סכום בש"ח',
  "סכום החיוב",
  "סך הכל",
  "סכום בשקלים",
];
const HEBREW_DEBIT_KEYS = ["חובה"];
const HEBREW_CREDIT_KEYS = ["זכות"];
const HEBREW_DESC_KEYS = [
  "תיאור",
  "תיאור פעולה",
  "תיאור הפעולה",
  "פירוט",
  "שם בית עסק",
  "שם העסק",
  "פרטי תנועה",
];

// Tokens that identify a transactions header row (used to skip metadata rows
// and non-transaction sheets in bank exports).
const HEADER_TOKENS = ["תאריך", "תיאור", "חובה", "זכות", "סכום", "אסמכתא"];

// Description patterns of summary/total rows that must never be treated as a
// transaction (e.g. card statements' "סה"כ חיוב לתאריך" subtotal lines).
const SUMMARY_RE = /סה["'׳]?כ|סיכום/;

// Normalize a header/key for matching: drop whitespace, parenthetical units
// like "(₪)", and currency/quote symbols, so "חובה(₪)" matches "חובה".
function normalizeKey(s: string): string {
  const norKey = s
    .replace(/\s+/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[₪"׳'’]/g, "");

  return norKey;
}

// Strip bidi control characters that bank exports embed in text cells.
function cleanText(s: string | null): string | null {
  if (s == null) return null;
  const out = s.replace(/[‎‏‪-‮]/g, "").trim();
  return out || null;
}

function findKey(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const nk = normalizeKey(key);
  const keys = Object.keys(row);
  return (
    keys.find((kk) => normalizeKey(kk) === nk) ??
    keys.find((kk) => normalizeKey(kk).includes(nk))
  );
}

function pick(row: Record<string, unknown>, keys: string[]): string | null {
  const v = pickRaw(row, keys);
  return v == null ? null : String(v);
}

function pickRaw(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const found = findKey(row, k);
    if (
      found &&
      row[found] !== "" &&
      row[found] !== null &&
      row[found] !== undefined
    ) {
      return row[found];
    }
  }
  return null;
}

function parseHebrewDate(s: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(trimmed);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    let y = dmy[3];
    if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
    return `${y}-${m}-${d}`;
  }
  return null;
}

function dateToISO(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Excel stores dates as serial numbers (days since 1899-12-30).
function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return dateToISO(new Date(ms));
}

// Normalize any date cell (string / JS Date / Excel serial) to YYYY-MM-DD.
function toISODate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return dateToISO(v);
  if (typeof v === "number") return excelSerialToISO(v);
  return parseHebrewDate(String(v));
}

function parseAmount(s: string | null): number | null {
  if (s === null) return null;
  const cleaned = String(s)
    .replace(/[₪,\s]/g, "")
    .replace(/[()]/g, "-");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function rowsToTxns(
  rows: Record<string, unknown>[],
  sourceLabel: string,
): BankTxn[] {
  const out: BankTxn[] = [];
  for (const row of rows) {
    const date = toISODate(pickRaw(row, HEBREW_DATE_KEYS));
    const debit = parseAmount(pick(row, HEBREW_DEBIT_KEYS));
    const credit = parseAmount(pick(row, HEBREW_CREDIT_KEYS));
    let amount: number | null;
    if (debit !== null && debit !== 0) {
      amount = -Math.abs(debit);
    } else if (credit !== null && credit !== 0) {
      amount = Math.abs(credit);
    } else {
      amount = parseAmount(pick(row, HEBREW_AMOUNT_KEYS));
    }
    const description = cleanText(pick(row, HEBREW_DESC_KEYS));
    if (description && SUMMARY_RE.test(description)) continue; // drop summary rows
    if (date === null && amount === null && !description) continue;
    out.push({
      source: sourceLabel,
      date,
      amount,
      description,
      status: null,
    });
  }
  return out;
}

export function parseCSV(text: string, sourceLabel: string): BankTxn[] {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return rowsToTxns(parsed.data, sourceLabel);
}

// Find the row that holds the column headers (≥2 known tokens), skipping the
// metadata rows bank exports put on top. Returns -1 if the sheet has none.
function findHeaderRow(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 40);
  for (let i = 0; i < limit; i++) {
    const cells = (matrix[i] ?? []).map((c) => normalizeKey(String(c ?? "")));
    const hits = HEADER_TOKENS.filter((t) =>
      cells.some((c) => c.length > 0 && c.includes(normalizeKey(t))),
    ).length;
    if (hits >= 2) return i;
  }
  return -1;
}

export function parseXLSX(
  buffer: ArrayBuffer | Buffer,
  sourceLabel: string,
): BankTxn[] {
  const data: Buffer = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(new Uint8Array(buffer));
  const wb = XLSX.read(data, { type: "buffer", cellDates: true });
  const all: BankTxn[] = [];
  for (const sheetName of wb.SheetNames) {
    // Skip the bank's "תנועות זמניות בהמתנה" sheet — pending/unapproved
    // transactions that must not enter the report.
    if (/בהמתנה|זמני|ממתין/.test(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    const headerRow = findHeaderRow(matrix);
    if (headerRow === -1) continue; // skip non-transaction sheets

    const headers = (matrix[headerRow] ?? []).map((c) => String(c ?? ""));
    const objRows: Record<string, unknown>[] = [];
    for (let i = headerRow + 1; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx] ?? "";
      });
      objRows.push(obj);
    }
    all.push(...rowsToTxns(objRows, sourceLabel || sheetName));
  }
  return all;
}

// ============================================================================
// Direct/Isracard card statement (XLSX) — richer than a bank statement: each
// charge carries its bank settlement date and currency.
// ============================================================================

export interface CardCharge {
  transactionDate: string | null; // תאריך עסקה
  settlementDate: string | null; // חיוב בחשבון הבנק (when it posted to the bank)
  merchant: string | null; // שם בית עסק
  amount: number | null; // סכום חיוב (₪); positive = spent, negative = refund
  currency: string | null; // מטבע (₪ / USD / EUR …)
  voucher: string | null; // מס' שובר — unique per charge; used to de-dup across sheets
}

const CARD_SETTLEMENT_KEYS = ["חיוב בחשבון הבנק"];
const CARD_ILS_KEYS = ["סכום חיוב"];
const CARD_CURRENCY_KEYS = ["מטבע חיוב"];
const CARD_TXN_DATE_KEYS = ["תאריך עסקה", "תאריך רכישה"];
const CARD_MERCHANT_KEYS = ["שם בית עסק", "שם בית העסק", "שם העסק"];
const CARD_VOUCHER_KEYS = ["מס' שובר", "מספר שובר", "שובר"];

// Section titles for charges the bank hasn't posted yet — must never be counted.
const CARD_PENDING_SECTION_RE = /שטרם\s*נקלט|בהמתנה|זמני|ממתין/;

function colIndexByKeys(headers: string[], keys: string[]): number {
  for (const k of keys) {
    const nk = normalizeKey(k);
    const exact = headers.findIndex((h) => normalizeKey(h) === nk);
    if (exact >= 0) return exact;
    const inc = headers.findIndex((h) => normalizeKey(h).includes(nk));
    if (inc >= 0) return inc;
  }
  return -1;
}

// A card charge table's header row carries a "סכום חיוב" column plus a merchant
// and a purchase-date column. The settlement-date column ("חיוב בחשבון הבנק") is
// present only in some tables (e.g. "עסקאות בחיוב מחוץ למועד") — not in the regular
// "עסקאות למועד חיוב" table — so it is NOT required to recognise a header.
function isCardHeaderRow(cells: string[]): boolean {
  const norm = cells.map((c) => normalizeKey(c));
  const hasIls = norm.some((c) => c.includes("סכוםחיוב"));
  const hasMerchant = norm.some(
    (c) => c.includes("שםביתעסק") || c.includes("שםהעסק"),
  );
  const hasDate = norm.some(
    (c) => c.includes("תאריךעסקה") || c.includes("תאריךרכישה"),
  );
  return hasIls && hasMerchant && hasDate;
}

interface CardCols {
  settle: number;
  ils: number;
  txn: number;
  merchant: number;
  currency: number;
  voucher: number;
}

// A card XLSX groups charges into several titled tables ("עסקאות למועד חיוב",
// "עסקאות בחיוב מחוץ למועד", "עסקאות שטרם נקלטו"), each with its own header row and
// column layout. Walk every sheet: track the latest section title, and when a
// header row appears, parse the rows beneath it with THAT table's columns — unless
// the section is one the bank hasn't posted yet.
export function parseCardXLSX(buffer: ArrayBuffer | Buffer): CardCharge[] {
  const data: Buffer = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(new Uint8Array(buffer));
  const wb = XLSX.read(data, { type: "buffer", cellDates: true });
  const out: CardCharge[] = [];
  for (const sheetName of wb.SheetNames) {
    if (CARD_PENDING_SECTION_RE.test(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });

    let cols: CardCols | null = null;
    let skipSection = false;
    let currentTitle = "";

    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const cells = row.map((c) => String(c ?? ""));

      if (isCardHeaderRow(cells)) {
        cols = {
          settle: colIndexByKeys(cells, CARD_SETTLEMENT_KEYS),
          ils: colIndexByKeys(cells, CARD_ILS_KEYS),
          txn: colIndexByKeys(cells, CARD_TXN_DATE_KEYS),
          merchant: colIndexByKeys(cells, CARD_MERCHANT_KEYS),
          currency: colIndexByKeys(cells, CARD_CURRENCY_KEYS),
          voucher: colIndexByKeys(cells, CARD_VOUCHER_KEYS),
        };
        skipSection = CARD_PENDING_SECTION_RE.test(currentTitle);
        continue;
      }

      // A section title (e.g. "עסקאות למועד חיוב") ends the previous table; the
      // next header row decides whether the new section is parsed or skipped.
      if (cells.join("").includes("עסקאות")) {
        currentTitle = cells.join(" ").trim();
        cols = null;
        continue;
      }

      if (!cols || skipSection || cols.ils === -1 || cols.merchant === -1) {
        continue;
      }

      const merchant = cleanText(String(row[cols.merchant] ?? ""));
      const amount = parseAmount(String(row[cols.ils] ?? ""));
      if (!merchant || amount === null) continue;
      if (SUMMARY_RE.test(merchant)) continue; // skip totals / section dividers
      out.push({
        transactionDate: cols.txn >= 0 ? toISODate(row[cols.txn]) : null,
        settlementDate: cols.settle >= 0 ? toISODate(row[cols.settle]) : null,
        merchant,
        amount,
        currency:
          cols.currency >= 0 ? cleanText(String(row[cols.currency] ?? "")) : null,
        voucher: cols.voucher >= 0 ? cleanText(String(row[cols.voucher] ?? "")) : null,
      });
    }
  }
  return out;
}
