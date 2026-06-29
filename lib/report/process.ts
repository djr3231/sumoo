import { uploadFileToDrive } from "@/lib/google";
import { parseXLSX } from "@/lib/parsers";
import {
  classifyExpenses,
  parseSalarySlip,
  parseStatementPDF,
  type SalarySlip,
} from "@/lib/ai";
import {
  reconcile,
  type CashWithdrawal,
  type ExpenseItem,
  type IncomeItem,
  type ReviewCredit,
  type SalaryCrossCheck,
  type TransferItem,
} from "@/lib/report/reconcile";
import type { BankTxn, GovExpenseCategory, ReportPeriod } from "@/lib/types";

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
  stored: Array<{ id: string; name: string; type: string }>;
  expenses: CategorizedExpense[];
  income: IncomeItem[];
  transfers: TransferItem[];
  reviewCredits: ReviewCredit[];
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

// Orchestrates a full period run: store each source doc to the period's source
// folder, parse by type, reconcile, then classify the expense lines.
export async function processPeriodDocuments(args: {
  accessToken: string;
  period: ReportPeriod;
  sourceFolderId: string;
  checking?: SourceFile;
  direct?: SourceFile;
  salaries: SourceFile[];
}): Promise<ProcessResult> {
  const stored: Array<{ id: string; name: string; type: string }> = [];
  const store = async (f: SourceFile, type: string) => {
    const { id } = await uploadFileToDrive(
      args.accessToken,
      args.sourceFolderId,
      f.name,
      f.buffer,
      f.mimeType,
    );
    stored.push({ id, name: f.name, type });
  };

  // עו"ש (checking) — prefer the XLS shape, fall back to PDF.
  let checkingTxns: BankTxn[] = [];
  if (args.checking) {
    await store(args.checking, "checking");
    checkingTxns = isSpreadsheet(args.checking)
      ? parseXLSX(args.checking.buffer, 'עו"ש')
      : await pdfToTxns(args.checking, 'עו"ש');
  }

  // דיירקט (card) — always a PDF of merchant-level charges.
  let directCharges: BankTxn[] = [];
  if (args.direct) {
    await store(args.direct, "direct");
    directCharges = await pdfToTxns(args.direct, "דיירקט");
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
    category: categories[i],
  }));

  return {
    stored,
    expenses,
    income: recon.income,
    transfers: recon.transfers,
    reviewCredits: recon.reviewCredits,
    cashWithdrawals: recon.cashWithdrawals,
    salaryCrossChecks: recon.salaryCrossChecks,
    salarySlips,
    checksum: recon.checksum,
  };
}
