import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { BankTxn } from "./types";

const HEBREW_DATE_KEYS = ["תאריך", "תאריך עסקה", "תאריך חיוב", "תאריך ערך"];
const HEBREW_AMOUNT_KEYS = ["סכום", "חיוב", "סכום בש\"ח", "סכום החיוב", "סך הכל", "סכום בשקלים"];
const HEBREW_DEBIT_KEYS = ["חובה"];
const HEBREW_CREDIT_KEYS = ["זכות"];
const HEBREW_DESC_KEYS = ["תיאור", "פירוט", "שם בית עסק", "שם העסק", "פרטי תנועה"];

function pick(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const found = Object.keys(row).find(
      (kk) => kk.replace(/\s+/g, "") === k.replace(/\s+/g, ""),
    );
    if (found && row[found] !== "" && row[found] !== null && row[found] !== undefined) {
      return String(row[found]);
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

function parseAmount(s: string | null): number | null {
  if (s === null) return null;
  const cleaned = String(s).replace(/[₪,\s]/g, "").replace(/[()]/g, "-");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function rowsToTxns(rows: Record<string, unknown>[], sourceLabel: string): BankTxn[] {
  const out: BankTxn[] = [];
  for (const row of rows) {
    const date = parseHebrewDate(pick(row, HEBREW_DATE_KEYS));
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
    const description = pick(row, HEBREW_DESC_KEYS);
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

export function parseXLSX(buffer: ArrayBuffer | Buffer, sourceLabel: string): BankTxn[] {
  const data: Buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(new Uint8Array(buffer));
  const wb = XLSX.read(data, { type: "buffer" });
  const all: BankTxn[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    });
    all.push(...rowsToTxns(rows, sourceLabel || sheetName));
  }
  return all;
}
