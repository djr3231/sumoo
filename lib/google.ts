import { getServerSession } from "next-auth";
import { google, type sheets_v4, type drive_v3 } from "googleapis";
import { authOptions } from "./auth";
import {
  RECEIPT_HEADERS,
  SHEET_TAB_RECEIPTS,
  SHEET_TAB_TXNS,
  TXN_HEADERS,
  type Receipt,
  type BankTxn,
} from "./types";

export async function requireAccessToken(): Promise<string> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken as string | undefined;
  if (!token) throw new Error("Not authenticated with Google");
  return token;
}

function authClient(accessToken: string) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return oauth2;
}

export function sheetsClient(accessToken: string): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: authClient(accessToken) });
}

export function driveClient(accessToken: string): drive_v3.Drive {
  return google.drive({ version: "v3", auth: authClient(accessToken) });
}

const SHEET_NAME = "Receipts – sumoo";

export async function ensureSpreadsheet(accessToken: string): Promise<string> {
  const pinned = process.env.SUMOO_SPREADSHEET_ID;
  if (pinned) {
    await ensureTabs(accessToken, pinned);
    return pinned;
  }

  const drive = driveClient(accessToken);
  const found = await drive.files.list({
    q: `name = '${SHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (found.data.files && found.data.files.length > 0) {
    const id = found.data.files[0].id!;
    await ensureTabs(accessToken, id);
    return id;
  }

  const sheets = sheetsClient(accessToken);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SHEET_NAME, locale: "he_IL" },
      sheets: [
        { properties: { title: SHEET_TAB_RECEIPTS, rightToLeft: true } },
        { properties: { title: SHEET_TAB_TXNS, rightToLeft: true } },
      ],
    },
  });
  const id = created.data.spreadsheetId!;
  await writeHeaders(accessToken, id);
  return id;
}

async function ensureTabs(accessToken: string, spreadsheetId: string) {
  const sheets = sheetsClient(accessToken);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(
    (meta.data.sheets || []).map((s) => s.properties?.title),
  );
  const requests: sheets_v4.Schema$Request[] = [];
  if (!existing.has(SHEET_TAB_RECEIPTS)) {
    requests.push({
      addSheet: {
        properties: { title: SHEET_TAB_RECEIPTS, rightToLeft: true },
      },
    });
  }
  if (!existing.has(SHEET_TAB_TXNS)) {
    requests.push({
      addSheet: {
        properties: { title: SHEET_TAB_TXNS, rightToLeft: true },
      },
    });
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }
  await writeHeaders(accessToken, spreadsheetId);
}

async function writeHeaders(accessToken: string, spreadsheetId: string) {
  const sheets = sheetsClient(accessToken);
  const get = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [`${SHEET_TAB_RECEIPTS}!A1:Z1`, `${SHEET_TAB_TXNS}!A1:Z1`],
  });
  const data: sheets_v4.Schema$ValueRange[] = [];
  if (!get.data.valueRanges?.[0]?.values?.length) {
    data.push({
      range: `${SHEET_TAB_RECEIPTS}!A1`,
      values: [[...RECEIPT_HEADERS]],
    });
  }
  if (!get.data.valueRanges?.[1]?.values?.length) {
    data.push({
      range: `${SHEET_TAB_TXNS}!A1`,
      values: [[...TXN_HEADERS]],
    });
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }
}

function receiptToRow(r: Receipt): (string | number | boolean | null)[] {
  return [
    r.id,
    r.fileName,
    r.storeName ?? "לא ידוע",
    r.amount ?? "",
    r.date ?? "",
    r.category,
    r.documentType,
    r.linkedTo ?? "",
    r.confidence,
    r.driveFileId ?? "",
    r.reviewed ? "TRUE" : "FALSE",
    r.notes ?? "",
  ];
}

function rowToReceipt(row: any[]): Receipt {
  return {
    id: String(row[0] ?? ""),
    fileName: String(row[1] ?? ""),
    storeName: row[2] ? String(row[2]) : null,
    amount:
      row[3] === "" || row[3] === null || row[3] === undefined
        ? null
        : Number(row[3]),
    date: row[4] ? String(row[4]) : null,
    category: (row[5] as any) || "לא ידוע",
    documentType: (row[6] as any) || "קבלה",
    linkedTo: row[7] ? String(row[7]) : null,
    confidence: (row[8] as any) || "med",
    driveFileId: row[9] ? String(row[9]) : null,
    reviewed: String(row[10]).toUpperCase() === "TRUE",
    notes: row[11] ? String(row[11]) : "",
  };
}

export async function appendReceipts(
  accessToken: string,
  spreadsheetId: string,
  receipts: Receipt[],
) {
  if (receipts.length === 0) return;
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_TAB_RECEIPTS}!A:L`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: receipts.map(receiptToRow) },
  });
}

export async function getAllReceipts(
  accessToken: string,
  spreadsheetId: string,
): Promise<Receipt[]> {
  const sheets = sheetsClient(accessToken);
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB_RECEIPTS}!A2:L`,
  });
  return (r.data.values || []).map(rowToReceipt);
}

export async function updateReceiptById(
  accessToken: string,
  spreadsheetId: string,
  patch: Partial<Receipt> & { id: string },
) {
  const sheets = sheetsClient(accessToken);
  const all = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB_RECEIPTS}!A:L`,
  });
  const rows = all.data.values || [];
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === patch.id);
  if (idx <= 0) throw new Error(`Row not found for id ${patch.id}`);
  const existing = rowToReceipt(rows[idx]);
  const merged: Receipt = { ...existing, ...patch };
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TAB_RECEIPTS}!A${idx + 1}:L${idx + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [receiptToRow(merged)] },
  });
}

export async function appendTxns(
  accessToken: string,
  spreadsheetId: string,
  txns: BankTxn[],
) {
  if (txns.length === 0) return;
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_TAB_TXNS}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: txns.map((t) => [
        t.source,
        t.date ?? "",
        t.amount ?? "",
        t.description ?? "",
        t.receiptId ?? "",
        t.status ?? "",
      ]),
    },
  });
}

export async function listDriveFolderImages(
  accessToken: string,
  folderId: string,
  pageSize = 1000,
): Promise<Array<{ id: string; name: string; mimeType: string; size: number }>> {
  const drive = driveClient(accessToken);
  const out: Array<{ id: string; name: string; mimeType: string; size: number }> = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType = 'application/pdf')`,
      fields: "nextPageToken, files(id,name,mimeType,size)",
      pageSize,
      pageToken,
    });
    for (const f of res.data.files || []) {
      out.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        size: Number(f.size || 0),
      });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

export async function downloadDriveFile(
  accessToken: string,
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = driveClient(accessToken);
  const meta = await drive.files.get({ fileId, fields: "mimeType" });
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType || "application/octet-stream",
  };
}
