import type { Receipt } from "@/lib/types";

export interface ReceiptDateFacts {
  issueDate: string | null;
  billingPeriod: string | null;
  dueDate: string | null;
  paymentDates: string[];
  bankDebitDates: string[];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXTRACTION_MIN_YEAR = 2018;
const EXTRACTION_MAX_YEAR = 2030;

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

function validExtractedIsoDate(value: unknown): string | null {
  const date = validIsoDate(value);
  if (date === null) {
    return null;
  }

  const year = Number(date.slice(0, 4));
  return year >= EXTRACTION_MIN_YEAR && year <= EXTRACTION_MAX_YEAR ? date : null;
}

function normalizeExtractedDateList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueSortedDates(value.map(validExtractedIsoDate));
}

function uniqueSortedDates(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort();
}

export function normalizeReceiptDateFacts(input: {
  issueDate: unknown;
  billingPeriod: unknown;
  dueDate: unknown;
  paymentDates: unknown;
  bankDebitDates: unknown;
}): ReceiptDateFacts {
  const billingPeriod = typeof input.billingPeriod === "string"
    ? input.billingPeriod.trim()
    : "";

  return {
    issueDate: validExtractedIsoDate(input.issueDate),
    billingPeriod: billingPeriod || null,
    dueDate: validExtractedIsoDate(input.dueDate),
    paymentDates: normalizeExtractedDateList(input.paymentDates),
    bankDebitDates: normalizeExtractedDateList(input.bankDebitDates),
  };
}

export function deriveMatchingDate(facts: ReceiptDateFacts): string | null {
  return (
    facts.paymentDates[0] ??
    facts.bankDebitDates[0] ??
    facts.dueDate ??
    facts.issueDate ??
    null
  );
}

export function receiptCandidateDates(
  receipt: Pick<Receipt, "date" | "paymentDates" | "bankDebitDates">,
): string[] {
  return uniqueSortedDates([
    validIsoDate(receipt.date),
    ...normalizeExtractedDateList(receipt.paymentDates),
    ...normalizeExtractedDateList(receipt.bankDebitDates),
  ]);
}

export function receiptTransactionAnchors(
  receipt: Pick<Receipt, "paymentDates" | "bankDebitDates">,
): string[] {
  return uniqueSortedDates([
    ...normalizeExtractedDateList(receipt.paymentDates),
    ...normalizeExtractedDateList(receipt.bankDebitDates),
  ]);
}
