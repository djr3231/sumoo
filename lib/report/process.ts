import { findDriveFileInFolder, uploadFileToDrive } from "@/lib/google";
import { parseCardXLSX, parseXLSX, type CardCharge } from "@/lib/parsers";
import {
  classifyExpenses,
  parseDirectStatement,
  parseSalarySlip,
  parseStatementPDF,
  type DirectCharge,
  type SalarySlip,
} from "@/lib/ai";
import {
  reconcile,
  type CashWithdrawal,
  type ExcludedItem,
  type ExpenseItem,
  type IncomeItem,
  type ReviewCredit,
  type SalaryCrossCheck,
  type TransferItem,
} from "@/lib/report/reconcile";
import type { BankTxn, GovExpenseCategory, ReportPeriod } from "@/lib/types";
import { GOV_EXPENSE_CATEGORY, isPharmacyStore } from "@/lib/types";

// A source document handed to the orchestrator (already read into memory).
export interface SourceFile {
  name: string;
  buffer: Buffer;
  mimeType: string;
}

export interface CategorizedExpense extends ExpenseItem {
  category: GovExpenseCategory;
}

export interface ProcessResult {
  stored: Array<{ id: string; name: string; type: string; reused: boolean }>;
  expenses: CategorizedExpense[];
  income: IncomeItem[];
  transfers: TransferItem[];
  reviewCredits: ReviewCredit[];
  excluded: ExcludedItem[];
  pending: ExpenseItem[];
  cashWithdrawals: CashWithdrawal[];
  salaryCrossChecks: SalaryCrossCheck[];
  salarySlips: SalarySlip[];
  checksum: { directDetailSum: number; directAggregateSum: number };
}

function isSpreadsheet(f: SourceFile): boolean {
  const name = f.name.toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    f.mimeType.includes("spreadsheet") ||
    f.mimeType.includes("excel")
  );
}

async function pdfToTxns(f: SourceFile, hint: string): Promise<BankTxn[]> {
  const r = await parseStatementPDF({
    pdfBase64: f.buffer.toString("base64"),
    hint,
  });
  return r.transactions.map((t) => ({
    source: r.source_label || hint,
    date: t.date,
    amount: t.amount,
    description: t.description,
    status: null,
  }));
}

// The PDF card extractor has no settlement-date column, so use the transaction
// date as a proxy for the settlement cut-off (XLSX carries the real one).
function directPdfToCardCharges(charges: DirectCharge[]): CardCharge[] {
  return charges.map((c) => ({
    transactionDate: c.date,
    settlementDate: c.date,
    merchant: c.merchant,
    amount:
      c.amount == null ? null : c.isCredit ? -Math.abs(c.amount) : Math.abs(c.amount),
    currency: null,
    voucher: null,
  }));
}

// Orchestrates a full period run: store each source doc to the period's source
// folder, parse by type, reconcile, then classify the expense lines.
export async function processPeriodDocuments(args: {
  accessToken: string;
  period: ReportPeriod;
  sourceFolderId: string;
  checking: SourceFile[]; // one file per month is allowed
  direct: SourceFile[]; // XLS or PDF; one file per month is allowed
  salaries: SourceFile[];
}): Promise<ProcessResult> {
  const stored: Array<{ id: string; name: string; type: string; reused: boolean }> = [];
  const store = async (f: SourceFile, type: string) => {
    // Skip re-uploading a file that already exists in the folder (by name).
    const existing = await findDriveFileInFolder(
      args.accessToken,
      args.sourceFolderId,
      f.name,
    );
    if (existing) {
      stored.push({ id: existing, name: f.name, type, reused: true });
      return;
    }
    const { id } = await uploadFileToDrive(
      args.accessToken,
      args.sourceFolderId,
      f.name,
      f.buffer,
      f.mimeType,
    );
    stored.push({ id, name: f.name, type, reused: false });
  };

  // עו"ש (checking) — XLS (preferred) or PDF; one file per month allowed.
  const checkingTxns: BankTxn[] = [];
  for (const f of args.checking) {
    await store(f, "checking");
    const txns = isSpreadsheet(f)
      ? parseXLSX(f.buffer, 'עו"ש')
      : await pdfToTxns(f, 'עו"ש');
    checkingTxns.push(...txns);
  }

  // דיירקט (card) — XLS uses the dedicated card parser (settlement date + ₪
  // "סכום חיוב"); PDF falls back to the Gemini extractor.
  const directCharges: CardCharge[] = [];
  for (const f of args.direct) {
    await store(f, "direct");
    const charges = isSpreadsheet(f)
      ? parseCardXLSX(f.buffer)
      : directPdfToCardCharges(
          (await parseDirectStatement({ pdfBase64: f.buffer.toString("base64") })).charges,
        );
    directCharges.push(...charges);
  }

  // Salary slips — N PDFs.
  const salarySlips: SalarySlip[] = [];
  for (const s of args.salaries) {
    await store(s, "salary");
    salarySlips.push(
      await parseSalarySlip({ pdfBase64: s.buffer.toString("base64"), hint: "תלוש שכר" }),
    );
  }

  const recon = reconcile({
    period: args.period,
    checkingTxns,
    directCharges,
    salarySlips,
  });

  const categories = await classifyExpenses(
    recon.expenseItems.map((e) => ({ description: e.description, amount: e.amount })),
  );
  const expenses: CategorizedExpense[] = recon.expenseItems.map((e, i) => ({
    ...e,
    // Retail pharmacies default to food/household, not exceptional-medical.
    // Deterministic override wins over the LLM classification (the LLM sees
    // only the store name, so this is at least as accurate and predictable).
    category: isPharmacyStore(e.description)
      ? GOV_EXPENSE_CATEGORY.Food
      : categories[i],
  }));

  return {
    stored,
    expenses,
    income: recon.income,
    transfers: recon.transfers,
    reviewCredits: recon.reviewCredits,
    excluded: recon.excluded,
    pending: recon.pending,
    cashWithdrawals: recon.cashWithdrawals,
    salaryCrossChecks: recon.salaryCrossChecks,
    salarySlips,
    checksum: recon.checksum,
  };
}
