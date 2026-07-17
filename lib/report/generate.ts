// Server generation for wizard step 6: writes two Drive artifacts into the
// period folder — a working spreadsheet of categorized expense rows, and a
// copy of the government report template filled by LABEL-ANCHORED lookup.
//
// ANCHOR RULES (binding — see docs/superpowers/plans/2026-07-09-insolvency-report-step6.md):
// every coordinate written to the report/פירוטים tabs is found by scanning
// trimmed cell text at runtime; NO A1 address is ever hardcoded. Missing an
// anchor throws (naming the missing label) rather than writing a partial
// report. Rows containing personal-detail labels are never written to
// (anonymity hard rule) — see PERSONAL_DETAIL_LABELS below.
import {
  batchWriteCells,
  clearSheetRange,
  copyDriveFileAsSheet,
  createSpreadsheetInFolder,
  ensureNamedTab,
  findDriveFileInFolder,
  getSheetGrid,
  listSheetTabs,
  writeFileChips,
} from "@/lib/google";
import {
  GOV_EXPENSE_CATEGORIES,
  GOV_EXPENSE_CATEGORY,
  GOV_INCOME_CATEGORIES,
  HEBREW_MONTHS,
  formatFoodCategory,
  type ReportPeriod,
  type UserSettings,
} from "@/lib/types";
import type { ReportFolders } from "@/lib/report/period";
import { OTHER_INCOME_LABEL, type ReportRollup } from "@/lib/report/rollup";

export interface GenerateArgs {
  period: ReportPeriod;
  folders: ReportFolders;
  rollup: ReportRollup;
  templateId: string; // already resolved (setting → env → default)
}
export interface GenerateResult {
  working: { id: string; url: string };
  report: { id: string; url: string };
}

export const DEFAULT_REPORT_TEMPLATE_ID = "12gLxQ7ASHXIZnX-Y_MTT_68d3bwL_13B";
export function resolveTemplateId(settings: UserSettings): string {
  return (
    settings.reportTemplate?.id ??
    process.env.SUMOO_REPORT_TEMPLATE_ID ??
    DEFAULT_REPORT_TEMPLATE_ID
  );
}

const WORKING_SHEET_PREFIX = "חישוב תדפיסי בנק";
const REPORT_FILE_PREFIX = "דוח דו-חודשי";
const WORKING_TAB = "חיובים דיירקט";
const DETAILS_TAB = "פירוטים";
const WORKING_HEADERS = ["שם בית עסק", "סכום חיוב", "מטבע חיוב", "פירוט נוסף", "תאריך חיוב", "קטגוריה", "קבלה"];
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

// Anonymity hard rule: template rows carrying any of these labels are never
// written to, even defensively (our anchors never target them, but this is a
// belt-and-suspenders guard — no personal detail may ever reach the sheet).
const PERSONAL_DETAIL_LABELS = [
  "בעניין: היחיד/ה",
  "מס' תיק ממונה",
  "כתובת עדכנית",
  "טלפון היחיד/ה",
  "חתימת היחיד/ה",
] as const;

function colA1(col: number): string {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const rangeFor = (tab: string, row: number, col: number) => `'${tab}'!${colA1(col)}${row + 1}`;

function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export async function generateReportArtifacts(
  accessToken: string,
  args: GenerateArgs,
): Promise<GenerateResult> {
  const working = await generateWorkingSheet(accessToken, args.period, args.folders, args.rollup);
  const report = await generateGovReport(accessToken, args.period, args.folders, args.rollup, args.templateId);
  return { working, report };
}

// ---------------------------------------------------------------------------
// Working spreadsheet (spec step 2)
// ---------------------------------------------------------------------------
async function generateWorkingSheet(
  token: string,
  period: ReportPeriod,
  folders: ReportFolders,
  rollup: ReportRollup,
): Promise<{ id: string; url: string }> {
  const name = `${WORKING_SHEET_PREFIX} ${period.folderName}`;
  const id = await createSpreadsheetInFolder(token, name, folders.periodId);
  await ensureNamedTab(token, id, WORKING_TAB);
  await clearSheetRange(token, id, `'${WORKING_TAB}'`);
  const values: (string | number)[][] = [
    WORKING_HEADERS,
    ...rollup.workingRows.map((r) => [r.merchant, r.amount, r.currency, r.note, r.date, r.categoryLabel, r.receipt]),
  ];
  await batchWriteCells(token, id, [{ range: `'${WORKING_TAB}'!A1`, values }]);

  // Receipt cells (col G, zero-based 6; data starts at row index 1) that carry
  // a Drive URL become smart chips — same look as the user's hand-made sheet.
  // On any chip-write failure, degrade to a plain HYPERLINK formula: cosmetic
  // difference only, never fail the generation for it.
  const chipCells = rollup.workingRows
    .map((r, i) => ({ row: i + 1, col: 6, uri: r.receiptUrl, name: r.receipt }))
    .filter((c): c is { row: number; col: number; uri: string; name: string } =>
      Boolean(c.uri),
    );
  if (chipCells.length > 0) {
    const tabs = await listSheetTabs(token, id);
    const tab = tabs.find((t) => t.title === WORKING_TAB);
    if (tab) {
      try {
        await writeFileChips(token, id, tab.sheetId, chipCells);
      } catch {
        await batchWriteCells(
          token,
          id,
          chipCells.map((c) => ({
            range: rangeFor(WORKING_TAB, c.row, c.col),
            values: [
              [`=HYPERLINK("${c.uri}","${c.name.replace(/"/g, '""')}")`],
            ],
          })),
          "USER_ENTERED",
        );
      }
    }
  }

  return { id, url: sheetUrl(id) };
}

// ---------------------------------------------------------------------------
// Government report (spec steps 3-5)
// ---------------------------------------------------------------------------
export function pickReportTab(tabs: Array<{ sheetId: number; title: string }>): string {
  const byTitle = tabs.filter((t) => t.title.includes('דו"ח'));
  if (byTitle.length === 1) return byTitle[0].title;
  const nonDetails = tabs.filter((t) => t.title !== DETAILS_TAB);
  if (nonDetails.length === 1) return nonDetails[0].title;
  throw new Error(`Cannot determine report tab among: ${tabs.map((t) => t.title).join(", ")}`);
}

interface CellWrite {
  row: number;
  col: number;
  value: string | number;
}
interface TotalsAnchors {
  incomeRow: number;
  incomeCols: [number, number];
  expenseRow: number;
  expenseCols: [number, number];
}

// Find the row (within [from, to)) containing a cell whose trimmed text
// includes `needle`. Returns -1 if not found.
function findRow(grid: string[][], needle: string, from = 0, to = grid.length): number {
  for (let r = from; r < to; r++) {
    if (grid[r].some((c) => c.trim().includes(needle))) return r;
  }
  return -1;
}

// Find the first cell (row, col) anywhere in the grid whose trimmed text
// includes `needle`. Returns null if not found.
function findCell(grid: string[][], needle: string): [number, number] | null {
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r].findIndex((cell) => cell.trim().includes(needle));
    if (c !== -1) return [r, c];
  }
  return null;
}

// Columns in `row` whose trimmed text includes `needle` (+ optional offset —
// used to jump from a label cell to its adjacent value cell).
function colsWhere(row: string[], needle: string, offset = 0): number[] {
  const out: number[] = [];
  row.forEach((c, ci) => { if (c.trim().includes(needle)) out.push(ci + offset); });
  return out;
}

// Read `grid` back and return the batchWriteCells payload for any target
// cell whose actual value doesn't match the expected computed total (>0.01
// off) — preserves live SUM formulas, fixes stale/static cells.
function mismatchFixes(
  grid: string[][],
  tab: string,
  targets: Array<{ row: number; col: number; expected: number }>,
): Array<{ range: string; values: (string | number)[][] }> {
  const fix: Array<{ range: string; values: (string | number)[][] }> = [];
  for (const t of targets) {
    const actual = Number(grid[t.row]?.[t.col] ?? "");
    if (!Number.isFinite(actual) || Math.abs(actual - t.expected) > 0.01) {
      fix.push({ range: rangeFor(tab, t.row, t.col), values: [[t.expected]] });
    }
  }
  return fix;
}

// Anchors for one income/expense block's header row: the 4 "חודש"/"חודש "
// cells (left-m1, left-m2, right-m1, right-m2, in column order) and the
// continuation-column marker ("הכנסות המשך" / "הוצאות המשך").
function scanBlockHeader(
  grid: string[][],
  headerRow: number,
  continuationNeedle: string,
): { leftCols: [number, number]; rightCols: [number, number]; continuationCol: number } {
  const row = grid[headerRow];
  const monthCols: number[] = [];
  for (let c = 0; c < row.length; c++) {
    const t = row[c].trim();
    if (t === "חודש" || t.startsWith("חודש ")) monthCols.push(c);
  }
  if (monthCols.length !== 4) {
    throw new Error(`Missing anchor: expected 4 "חודש" header cells at row ${headerRow + 1}, found ${monthCols.length}`);
  }
  const continuationCol = row.findIndex((c) => c.trim().includes(continuationNeedle));
  if (continuationCol === -1) throw new Error(`Missing anchor: "${continuationNeedle}"`);
  return { leftCols: [monthCols[0], monthCols[1]], rightCols: [monthCols[2], monthCols[3]], continuationCol };
}

// Build every cell write for the report tab by scanning `grid` for labels.
// Never hardcodes an A1 address — see module header.
function buildReportWrites(
  grid: string[][],
  period: ReportPeriod,
  rollup: ReportRollup,
): { writes: CellWrite[]; totals: TotalsAnchors; dateWrite: CellWrite | null } {
  const writes: CellWrite[] = [];
  const forbiddenRows = new Set<number>();
  for (let r = 0; r < grid.length; r++) {
    if (grid[r].some((c) => PERSONAL_DETAIL_LABELS.some((l) => c.trim().includes(l)))) forbiddenRows.add(r);
  }
  const set = (row: number, col: number, value: string | number) => {
    if (forbiddenRows.has(row)) return; // anonymity guard — unreachable in the clean template
    writes.push({ row, col, value });
  };

  // Months/year header
  const monthsAnchor = findCell(grid, "בהתייחס לחודשים");
  if (!monthsAnchor) throw new Error('Missing anchor: "בהתייחס לחודשים"');
  const [monthsRow, monthsCol] = monthsAnchor;
  const yearCol = grid[monthsRow].findIndex((c) => c.trim().includes("של שנת"));
  if (yearCol === -1) throw new Error('Missing anchor: "של שנת"');
  set(monthsRow, monthsCol + 1, HEBREW_MONTHS[period.month1 - 1]);
  set(monthsRow, monthsCol + 2, HEBREW_MONTHS[period.month2 - 1]);
  set(monthsRow, yearCol + 1, period.year);

  // Date footer — kept OUT of `writes` (the RAW batch) and returned
  // separately: generateGovReport writes it in its own tiny USER_ENTERED
  // batch so it becomes a real date instead of RAW text with a leading
  // apostrophe. Still honors the anonymity forbidden-row guard.
  const dateAnchor = findCell(grid, "תאריך:");
  if (!dateAnchor) throw new Error('Missing anchor: "תאריך:"');
  const [dateRow, dateCol] = dateAnchor;
  const dateWrite: CellWrite | null = forbiddenRows.has(dateRow)
    ? null
    : { row: dateRow, col: dateCol + 1, value: todayDDMMYYYY() };

  // Block boundaries: income header → expense header → date row
  const incomeHeaderRow = findRow(grid, "הכנסות היחיד/ה");
  if (incomeHeaderRow === -1) throw new Error('Missing anchor: "הכנסות היחיד/ה"');
  const expenseHeaderRow = findRow(grid, "הוצאות היחיד/ה", incomeHeaderRow + 1);
  if (expenseHeaderRow === -1) throw new Error('Missing anchor: "הוצאות היחיד/ה"');
  const incomeAnchors = scanBlockHeader(grid, incomeHeaderRow, "הכנסות המשך");
  const expenseAnchors = scanBlockHeader(grid, expenseHeaderRow, "הוצאות המשך");

  const writeMonthHeaders = (headerRow: number, a: { leftCols: [number, number]; rightCols: [number, number] }) => {
    set(headerRow, a.leftCols[0], `חודש ${HEBREW_MONTHS[period.month1 - 1]}`);
    set(headerRow, a.leftCols[1], `חודש ${HEBREW_MONTHS[period.month2 - 1]}`);
    set(headerRow, a.rightCols[0], `חודש ${HEBREW_MONTHS[period.month1 - 1]}`);
    set(headerRow, a.rightCols[1], `חודש ${HEBREW_MONTHS[period.month2 - 1]}`);
  };
  writeMonthHeaders(incomeHeaderRow, incomeAnchors);
  writeMonthHeaders(expenseHeaderRow, expenseAnchors);

  // Income rows (6 fixed categories, label at any col <= leftCols[0])
  for (const cat of GOV_INCOME_CATEGORIES) {
    let row = -1;
    for (let r = incomeHeaderRow + 1; r < expenseHeaderRow && row === -1; r++) {
      if (grid[r].findIndex((c, ci) => ci <= incomeAnchors.leftCols[0] && c.trim() === cat) !== -1) row = r;
    }
    if (row === -1) throw new Error(`Missing anchor: income category "${cat}"`);
    const [m1, m2] = rollup.incomeByCategory[cat];
    set(row, incomeAnchors.leftCols[0], m1 === 0 ? "" : m1);
    set(row, incomeAnchors.leftCols[1], m2 === 0 ? "" : m2);
  }

  // Other income continuation row "7"
  let otherRow = -1;
  for (let r = incomeHeaderRow + 1; r < expenseHeaderRow && otherRow === -1; r++) {
    if ((grid[r][incomeAnchors.continuationCol] ?? "").trim() === "7") otherRow = r;
  }
  if (otherRow === -1) throw new Error('Missing anchor: income continuation row "7"');
  const [oi1, oi2] = rollup.otherIncome;
  if (oi1 === 0 && oi2 === 0) {
    set(otherRow, incomeAnchors.continuationCol + 1, "");
    set(otherRow, incomeAnchors.rightCols[0], "");
    set(otherRow, incomeAnchors.rightCols[1], "");
  } else {
    set(otherRow, incomeAnchors.continuationCol + 1, OTHER_INCOME_LABEL);
    set(otherRow, incomeAnchors.rightCols[0], oi1);
    set(otherRow, incomeAnchors.rightCols[1], oi2);
  }

  // Expense rows (23 fixed categories; Food matched by prefix + relabeled)
  for (const cat of GOV_EXPENSE_CATEGORIES) {
    let row = -1, matchCol = -1;
    for (let r = expenseHeaderRow + 1; r < dateRow && row === -1; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const t = grid[r][c].trim();
        const isMatch = cat === GOV_EXPENSE_CATEGORY.Food ? t.startsWith(GOV_EXPENSE_CATEGORY.Food) : t === cat;
        if (isMatch) { row = r; matchCol = c; break; }
      }
    }
    if (row === -1) throw new Error(`Missing anchor: expense category "${cat}"`);
    const cols = matchCol < expenseAnchors.continuationCol ? expenseAnchors.leftCols : expenseAnchors.rightCols;
    if (cat === GOV_EXPENSE_CATEGORY.Food) set(row, matchCol, formatFoodCategory(rollup.householdSize));
    const [m1, m2] = rollup.expenseByCategory[cat];
    set(row, cols[0], m1 === 0 ? "" : m1);
    set(row, cols[1], m2 === 0 ? "" : m2);
  }

  const incomeTotalsRow = findRow(grid, 'סה"כ הכנסות', incomeHeaderRow + 1, expenseHeaderRow);
  if (incomeTotalsRow === -1) throw new Error('Missing anchor: "סה"כ הכנסות"');
  const expenseTotalsRow = findRow(grid, 'סה"כ הוצאות', expenseHeaderRow + 1, dateRow);
  if (expenseTotalsRow === -1) throw new Error('Missing anchor: "סה"כ הוצאות"');

  return {
    writes,
    totals: {
      incomeRow: incomeTotalsRow,
      incomeCols: incomeAnchors.rightCols,
      expenseRow: expenseTotalsRow,
      expenseCols: expenseAnchors.rightCols,
    },
    dateWrite,
  };
}

async function generateGovReport(
  token: string,
  period: ReportPeriod,
  folders: ReportFolders,
  rollup: ReportRollup,
  templateId: string,
): Promise<{ id: string; url: string }> {
  const name = `${REPORT_FILE_PREFIX} ${period.folderName}`;
  const existing = await findDriveFileInFolder(token, folders.periodId, name);
  const id = existing ?? (await copyDriveFileAsSheet(token, templateId, name, folders.periodId));

  const tabs = await listSheetTabs(token, id);
  const reportTab = pickReportTab(tabs);

  const grid = await getSheetGrid(token, id, reportTab);
  const fill = buildReportWrites(grid, period, rollup);
  await batchWriteCells(
    token,
    id,
    fill.writes.map((w) => ({ range: rangeFor(reportTab, w.row, w.col), values: [[w.value]] })),
  );

  // Footer generation date, written separately as USER_ENTERED so Sheets
  // parses the DD/MM/YYYY string as a real date (RAW would store it as text
  // with a leading text-marker apostrophe). Everything else stays RAW.
  if (fill.dateWrite) {
    await batchWriteCells(
      token,
      id,
      [{ range: rangeFor(reportTab, fill.dateWrite.row, fill.dateWrite.col), values: [[fill.dateWrite.value]] }],
      "USER_ENTERED",
    );
  }

  // Formula-preserving totals read-back: only overwrite if the template's
  // SUM formula (or lack thereof) didn't already land on the right value.
  const grid2 = await getSheetGrid(token, id, reportTab, true);
  const totalsFix = mismatchFixes(grid2, reportTab, [
    { row: fill.totals.incomeRow, col: fill.totals.incomeCols[0], expected: rollup.incomeTotals[0] },
    { row: fill.totals.incomeRow, col: fill.totals.incomeCols[1], expected: rollup.incomeTotals[1] },
    { row: fill.totals.expenseRow, col: fill.totals.expenseCols[0], expected: rollup.expenseTotals[0] },
    { row: fill.totals.expenseRow, col: fill.totals.expenseCols[1], expected: rollup.expenseTotals[1] },
  ]);
  if (totalsFix.length > 0) await batchWriteCells(token, id, totalsFix);

  await fillDetailsTab(token, id, rollup);
  return { id, url: sheetUrl(id) };
}

// ---------------------------------------------------------------------------
// פירוטים tab (spec step 5): two per-month food tables side by side — month 1
// in columns B/C, month 2 in columns E/F. Rows 1-4 hold, per month, a merged
// "חודש <name>" label directly above a "סה"כ כלכלה" summary row; row 5 is the
// תאריך/סכום header (2 occurrences — one per month block); data starts on the
// row right below it. All rows/cols are derived by scanning — never
// hardcoded — and the clear-before-write starts at the scanned data row so
// rows 1-5 (labels, summary, header) are preserved.
// ---------------------------------------------------------------------------
async function fillDetailsTab(token: string, id: string, rollup: ReportRollup): Promise<void> {
  const grid = await getSheetGrid(token, id, DETAILS_TAB);
  const headerRow = grid.findIndex((row) => row.filter((c) => c.trim().includes("תאריך")).length >= 2);
  if (headerRow === -1) throw new Error(`Missing anchor: "תאריך" column headers in ${DETAILS_TAB}`);
  const dateCols = colsWhere(grid[headerRow], "תאריך");
  if (dateCols.length < 2) throw new Error(`Missing anchor: "תאריך" column headers in ${DETAILS_TAB} (found ${dateCols.length})`);
  const [month1Col, month2Col] = dateCols;
  const dataStartSheetRow = headerRow + 2; // 1-indexed sheet row right below the header row

  const sumRow = grid.findIndex((row) => row.filter((c) => c.trim().includes('סה"כ כלכלה')).length >= 2);
  if (sumRow === -1) throw new Error(`Missing anchor: "סה"כ כלכלה" in ${DETAILS_TAB}`);
  const sumCols = colsWhere(grid[sumRow], 'סה"כ כלכלה', 1);
  if (sumCols.length < 2) throw new Error(`Missing anchor: "סה"כ כלכלה" sum cells in ${DETAILS_TAB}`);

  // Month-name label row: directly above the summary row (0-indexed grid row
  // sumRow - 1, which rangeFor turns into 1-indexed sheet row sumRow — one
  // row above the summary's own sheet row of sumRow + 1).
  const [month1, month2] = rollup.months;
  const labelRow = sumRow - 1;
  await batchWriteCells(token, id, [
    { range: rangeFor(DETAILS_TAB, labelRow, month1Col), values: [[`חודש ${HEBREW_MONTHS[month1 - 1]}`]] },
    { range: rangeFor(DETAILS_TAB, labelRow, month2Col), values: [[`חודש ${HEBREW_MONTHS[month2 - 1]}`]] },
  ]);

  await clearSheetRange(token, id, `'${DETAILS_TAB}'!A${dataStartSheetRow}:F`);

  const [m1Lines, m2Lines] = rollup.foodBreakdown;
  const data: Array<{ range: string; values: (string | number)[][] }> = [];
  if (m1Lines.length > 0) {
    data.push({ range: `'${DETAILS_TAB}'!${colA1(month1Col)}${dataStartSheetRow}`, values: m1Lines.map((l) => [l.date, l.amount]) });
  }
  if (m2Lines.length > 0) {
    data.push({ range: `'${DETAILS_TAB}'!${colA1(month2Col)}${dataStartSheetRow}`, values: m2Lines.map((l) => [l.date, l.amount]) });
  }
  // USER_ENTERED so the DD/MM/YYYY date column becomes a real date (RAW
  // would store it as text with a leading text-marker apostrophe); amounts
  // are JS numbers and land as numbers either way, template ₪ format applies.
  if (data.length > 0) await batchWriteCells(token, id, data, "USER_ENTERED");

  const grid2 = await getSheetGrid(token, id, DETAILS_TAB, true);
  const expected1 = r2(m1Lines.reduce((s, l) => s + l.amount, 0));
  const expected2 = r2(m2Lines.reduce((s, l) => s + l.amount, 0));
  const sumFix = mismatchFixes(grid2, DETAILS_TAB, [
    { row: sumRow, col: sumCols[0], expected: expected1 },
    { row: sumRow, col: sumCols[1], expected: expected2 },
  ]);
  if (sumFix.length > 0) await batchWriteCells(token, id, sumFix);
}
