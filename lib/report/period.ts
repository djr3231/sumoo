import { ensureDriveFolder } from "@/lib/google";
import type { ReportPeriod } from "@/lib/types";

// Parent folder under which every period's folder is created (spec §4.1).
const REPORTS_ROOT_FOLDER = "דוחות חודשיים";
// Subfolders created inside each period folder (user-confirmed names).
const SOURCE_SUBFOLDER = "קבלות חיובים בחשבון"; // uploaded עו"ש / דיירקט / salary slips
const CASH_SUBFOLDER = "קבלות מזומן"; // cash-receipt photos

// Pure: turn two months + a year into a canonical period with a folder name
// like "5-6_2026". No I/O.
export function buildReportPeriod(
  year: number,
  month1: number,
  month2: number,
): ReportPeriod {
  return {
    year,
    month1,
    month2,
    folderName: `${month1}-${month2}_${year}`,
  };
}

export interface ReportFolders {
  rootId: string; // דוחות חודשיים
  periodId: string; // <folderName>
  sourceId: string; // קבלות חיובים בחשבון
  cashId: string; // קבלות מזומן
}

// Idempotently create (or find) the full folder structure for a period:
//   דוחות חודשיים / <folderName> / { קבלות חיובים בחשבון, קבלות מזומן }
// Returns the four folder ids for callers to drop files into.
export async function ensureReportFolder(
  accessToken: string,
  period: ReportPeriod,
): Promise<ReportFolders> {
  const rootId = await ensureDriveFolder(accessToken, REPORTS_ROOT_FOLDER);
  const periodId = await ensureDriveFolder(accessToken, period.folderName, rootId);
  const sourceId = await ensureDriveFolder(accessToken, SOURCE_SUBFOLDER, periodId);
  const cashId = await ensureDriveFolder(accessToken, CASH_SUBFOLDER, periodId);
  return { rootId, periodId, sourceId, cashId };
}
