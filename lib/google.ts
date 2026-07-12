import { getServerSession } from "next-auth";
import { google, type sheets_v4, type drive_v3 } from "googleapis";
import { authOptions } from "./auth";
import {
  DEFAULT_CATEGORY,
  DEFAULT_STORE_NAME,
  DOCUMENT_TYPE,
  PAYMENT_METHOD,
  RECEIPT_HEADERS,
  SETTINGS_HEADERS,
  SETTINGS_KEY,
  SHEET_TAB_RECEIPTS,
  SHEET_TAB_SETTINGS,
  SHEET_TAB_STORES,
  SHEET_TAB_TXNS,
  STORE_HEADERS,
  TXN_HEADERS,
  type BankTxn,
  type Receipt,
  type Store,
  type UserSettings,
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

async function applyTabFormatting(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: Array<{ sheetId: number; columnCount: number }>,
) {
  if (tabs.length === 0) return;

  // Pass 1: freeze header row + bold styling (never fails)
  const formatRequests: sheets_v4.Schema$Request[] = [];
  for (const { sheetId, columnCount } of tabs) {
    formatRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: "gridProperties.frozenRowCount",
      },
    });
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.93, green: 0.94, blue: 0.96 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    });
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: formatRequests },
  });

  // Pass 2: apply basic filter — fails silently if the sheet contains a Table
  // (Google Sheets does not allow BasicFilter to overlap a Table range)
  for (const { sheetId, columnCount } of tabs) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            { clearBasicFilter: { sheetId } },
            {
              setBasicFilter: {
                filter: {
                  range: {
                    sheetId,
                    startRowIndex: 0,
                    startColumnIndex: 0,
                    endColumnIndex: columnCount,
                  },
                },
              },
            },
          ],
        },
      });
    } catch (e) {
      console.warn(`setBasicFilter skipped for sheetId=${sheetId} (Table conflict?):`, (e as Error).message);
    }
  }
}

function tabsFromMeta(
  meta: sheets_v4.Schema$Spreadsheet,
  onlyMissing = false,
): Array<{ sheetId: number; columnCount: number }> {
  const out: Array<{ sheetId: number; columnCount: number }> = [];
  for (const s of meta.sheets || []) {
    const id = s.properties?.sheetId;
    const title = s.properties?.title;
    if (id == null) continue;
    if (onlyMissing) {
      const hasFilter = Boolean(s.basicFilter);
      const frozen = s.properties?.gridProperties?.frozenRowCount ?? 0;
      if (hasFilter && frozen >= 1) continue;
    }
    if (title === SHEET_TAB_RECEIPTS) {
      out.push({ sheetId: id, columnCount: RECEIPT_HEADERS.length });
    } else if (title === SHEET_TAB_TXNS) {
      out.push({ sheetId: id, columnCount: TXN_HEADERS.length });
    } else if (title === SHEET_TAB_STORES) {
      out.push({ sheetId: id, columnCount: STORE_HEADERS.length });
    } else if (title === SHEET_TAB_SETTINGS) {
      out.push({ sheetId: id, columnCount: SETTINGS_HEADERS.length });
    }
  }
  return out;
}

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
      properties: { title: SHEET_NAME },
      sheets: [
        { properties: { title: SHEET_TAB_RECEIPTS, rightToLeft: true } },
        { properties: { title: SHEET_TAB_TXNS, rightToLeft: true } },
        { properties: { title: SHEET_TAB_STORES, rightToLeft: true } },
        { properties: { title: SHEET_TAB_SETTINGS, rightToLeft: true } },
      ],
    },
  });
  const id = created.data.spreadsheetId!;
  await writeHeaders(accessToken, id);
  await applyTabFormatting(sheets, id, tabsFromMeta(created.data));
  return id;
}

// Lean spreadsheet-id lookup that skips ensureTabs entirely (no
// spreadsheets.get + values.batchGet + spreadsheets.get for the 4 main report
// tabs). Used by callers — like the progress autosave route — that only need
// the id to reach their OWN tab (e.g. a progress_<period> tab, ensured
// separately by writeJsonDoc) and have no business validating/creating the
// main Receipts/Txns/Stores/Settings tabs on every call.
export async function resolveSpreadsheetId(accessToken: string): Promise<string> {
  const pinned = process.env.SUMOO_SPREADSHEET_ID;
  if (pinned) return pinned;

  const drive = driveClient(accessToken);
  const found = await drive.files.list({
    q: `name = '${SHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (found.data.files && found.data.files.length > 0) {
    return found.data.files[0].id!;
  }

  // Not found yet (first run) — fall back to the full create-and-validate
  // path so the spreadsheet and its main tabs get created correctly.
  return ensureSpreadsheet(accessToken);
}

// Generic find-or-create for a single named tab (a title not among the 4
// known report tabs). Generalizes the `ensureTabs` skeleton below without
// touching it — used by callers (e.g. the progress store) that manage their
// own ad-hoc tabs, one per key, rather than a fixed set of named tabs.
// Best-effort per-process cache of tabs already confirmed to exist, keyed by
// `${spreadsheetId}::${title}`. Safe for the progress feature's tabs because
// they're only ever value-cleared (clearJsonDoc), never deleted — once a tab
// is known to exist it stays existing, so a stale cache entry can't cause a
// write to a nonexistent tab. Not used by readJsonDoc/clearJsonDoc, whose own
// existence checks guard a "no doc yet" no-op rather than a create.
const knownTabs = new Set<string>();

export async function ensureNamedTab(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<void> {
  const cacheKey = `${spreadsheetId}::${title}`;
  if (knownTabs.has(cacheKey)) return;
  const sheets = sheetsClient(accessToken);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === title);
  if (exists) {
    knownTabs.add(cacheKey);
    return;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title, rightToLeft: true } } }],
    },
  });
  knownTabs.add(cacheKey);
}

// Max characters per cell we write a JSON chunk into. Sheets' hard limit is
// 50,000 chars/cell; stay comfortably under it.
const JSON_DOC_CHUNK_SIZE = 45_000;

// Read a JSON document previously written by `writeJsonDoc`: column A of the
// named tab holds the JSON string split across rows (one chunk per row).
// Returns null if the tab doesn't exist or holds no rows (never throws for
// a missing/empty doc — callers treat that as "no progress yet").
export async function readJsonDoc(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<string | null> {
  const sheets = sheetsClient(accessToken);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === title);
  if (!exists) return null;
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A:A`,
  });
  const rows = r.data.values || [];
  if (rows.length === 0) return null;
  const joined = rows.map((row) => String(row[0] ?? "")).join("");
  return joined === "" ? null : joined;
}

// Write a JSON document to the named tab (created if missing): clears the
// tab, then writes `json` split into <= JSON_DOC_CHUNK_SIZE-char chunks, one
// chunk per row in column A. Callers are expected to pass an already
// pretty-printed, stable-key-order JSON string (see progress-store.ts) so the
// cells stay human-inspectable.
export async function writeJsonDoc(
  accessToken: string,
  spreadsheetId: string,
  title: string,
  json: string,
): Promise<void> {
  await ensureNamedTab(accessToken, spreadsheetId, title);
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${title}!A:A`,
  });
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += JSON_DOC_CHUNK_SIZE) {
    chunks.push(json.slice(i, i + JSON_DOC_CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push("");
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: chunks.map((c) => [c]) },
  });
}

// Clear a JSON document written by `writeJsonDoc`: wipes column A of the
// named tab so a subsequent `readJsonDoc` returns null. No-op if the tab
// doesn't exist (never creates it — clearing a doc that was never saved is
// a normal, non-error case).
export async function clearJsonDoc(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === title);
  if (!exists) return;
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${title}!A:A`,
  });
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
  if (!existing.has(SHEET_TAB_STORES)) {
    requests.push({
      addSheet: {
        properties: { title: SHEET_TAB_STORES, rightToLeft: true },
      },
    });
  }
  if (!existing.has(SHEET_TAB_SETTINGS)) {
    requests.push({
      addSheet: {
        properties: { title: SHEET_TAB_SETTINGS, rightToLeft: true },
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

  const refreshed = await sheets.spreadsheets.get({ spreadsheetId });
  await applyTabFormatting(sheets, spreadsheetId, tabsFromMeta(refreshed.data, true));
}

async function writeHeaders(accessToken: string, spreadsheetId: string) {
  const sheets = sheetsClient(accessToken);
  const get = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [
      `${SHEET_TAB_RECEIPTS}!A1:Z1`,
      `${SHEET_TAB_TXNS}!A1:Z1`,
      `${SHEET_TAB_STORES}!A1:Z1`,
      `${SHEET_TAB_SETTINGS}!A1:Z1`,
    ],
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
  if (!get.data.valueRanges?.[2]?.values?.length) {
    data.push({
      range: `${SHEET_TAB_STORES}!A1`,
      values: [[...STORE_HEADERS]],
    });
  }
  if (!get.data.valueRanges?.[3]?.values?.length) {
    data.push({
      range: `${SHEET_TAB_SETTINGS}!A1`,
      values: [[...SETTINGS_HEADERS]],
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
    r.storeName ?? DEFAULT_STORE_NAME,
    r.amount ?? "",
    r.date ?? "",
    r.category,
    r.documentType,
    r.paymentMethod ?? PAYMENT_METHOD.Unknown,
    r.totalReceiptAmount ?? "",
    r.cardLast4 ?? "",
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
    category: ((row[5] as any) || DEFAULT_CATEGORY) as Receipt["category"],
    documentType: ((row[6] as any) || DOCUMENT_TYPE.Receipt) as Receipt["documentType"],
    paymentMethod: ((row[7] as any) || PAYMENT_METHOD.Unknown) as Receipt["paymentMethod"],
    totalReceiptAmount:
      row[8] === "" || row[8] === null || row[8] === undefined
        ? null
        : Number(row[8]),
    cardLast4: row[9] ? String(row[9]) : null,
    linkedTo: row[10] ? String(row[10]) : null,
    confidence: ((row[11] as any) || "med") as Receipt["confidence"],
    driveFileId: row[12] ? String(row[12]) : null,
    reviewed: String(row[13]).toUpperCase() === "TRUE",
    notes: row[14] ? String(row[14]) : "",
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
    range: `${SHEET_TAB_RECEIPTS}!A:O`,
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
    range: `${SHEET_TAB_RECEIPTS}!A2:O`,
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
    range: `${SHEET_TAB_RECEIPTS}!A:O`,
  });
  const rows = all.data.values || [];
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === patch.id);
  if (idx <= 0) throw new Error(`Row not found for id ${patch.id}`);
  const existing = rowToReceipt(rows[idx]);
  const merged: Receipt = { ...existing, ...patch };
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TAB_RECEIPTS}!A${idx + 1}:O${idx + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [receiptToRow(merged)] },
  });
}

export async function bulkUpdateReceipts(
  accessToken: string,
  spreadsheetId: string,
  patches: Array<Partial<Receipt> & { id: string }>,
) {
  if (patches.length === 0) return;
  const sheets = sheetsClient(accessToken);
  const all = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB_RECEIPTS}!A:O`,
  });
  const rows = all.data.values || [];
  const indexById = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i]?.[0];
    if (id) indexById.set(String(id), i);
  }
  const data: sheets_v4.Schema$ValueRange[] = [];
  for (const patch of patches) {
    const idx = indexById.get(patch.id);
    if (idx === undefined) continue;
    const existing = rowToReceipt(rows[idx]);
    const merged: Receipt = { ...existing, ...patch };
    data.push({
      range: `${SHEET_TAB_RECEIPTS}!A${idx + 1}:O${idx + 1}`,
      values: [receiptToRow(merged)],
    });
  }
  if (data.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

function storeToRow(s: Store): (string | number)[] {
  return [s.canonical, s.count, s.variants.join(" | ")];
}

function rowToStore(row: any[]): Store {
  return {
    canonical: String(row[0] ?? ""),
    count: Number(row[1] ?? 0) || 0,
    variants: String(row[2] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export async function getAllStores(
  accessToken: string,
  spreadsheetId: string,
): Promise<Store[]> {
  const sheets = sheetsClient(accessToken);
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TAB_STORES}!A2:C`,
    });
    return (r.data.values || []).map(rowToStore).filter((s) => s.canonical);
  } catch {
    return [];
  }
}

export async function writeAllStores(
  accessToken: string,
  spreadsheetId: string,
  stores: Store[],
) {
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_TAB_STORES}!A2:C`,
  });
  if (stores.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TAB_STORES}!A2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: stores.map(storeToRow) },
  });
}

export async function appendOrIncrementStore(
  accessToken: string,
  spreadsheetId: string,
  canonical: string,
  variant?: string,
) {
  const stores = await getAllStores(accessToken, spreadsheetId);
  const idx = stores.findIndex((s) => s.canonical === canonical);
  if (idx >= 0) {
    stores[idx].count += 1;
    if (variant && variant !== canonical && !stores[idx].variants.includes(variant)) {
      stores[idx].variants.push(variant);
    }
  } else {
    stores.push({
      canonical,
      count: 1,
      variants: variant && variant !== canonical ? [variant] : [],
    });
  }
  await writeAllStores(accessToken, spreadsheetId, stores);
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

export async function searchDriveFolders(
  accessToken: string,
  query: string,
): Promise<Array<{ id: string; name: string }>> {
  const drive = driveClient(accessToken);
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name contains '${query.replace(/'/g, "\\'")}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 20,
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
}

// Name-contains search over spreadsheet-like files (native Sheets + xlsx),
// used by the report-template picker. Max 20, excludes trashed.
export async function searchDriveFiles(
  accessToken: string,
  query: string,
): Promise<Array<{ id: string; name: string }>> {
  const drive = driveClient(accessToken);
  const res = await drive.files.list({
    q: `(mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and name contains '${query.replace(/'/g, "\\'")}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 20,
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
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

const UPLOAD_FOLDER_NAME = "סומו - העלאות";

export async function ensureUploadFolder(accessToken: string): Promise<string> {
  const drive = driveClient(accessToken);
  const found = await drive.files.list({
    q: `name = '${UPLOAD_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (found.data.files && found.data.files.length > 0) {
    return found.data.files[0].id!;
  }
  const created = await drive.files.create({
    requestBody: {
      name: UPLOAD_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  return created.data.id!;
}

// Generic find-or-create for a Drive folder, optionally nested under a parent.
// Idempotent: returns the existing folder's id when one with the same name
// already lives under the given parent, else creates it. Generalizes
// ensureUploadFolder for the report feature's nested folder structure.
export async function ensureDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const drive = driveClient(accessToken);
  const safeName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const found = await drive.files.list({
    q: `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (found.data.files && found.data.files.length > 0) {
    return found.data.files[0].id!;
  }
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  return created.data.id!;
}

// Returns the id of a non-trashed file with the given name in the folder, or
// null. Used to avoid re-uploading the same source document across runs.
export async function findDriveFileInFolder(
  accessToken: string,
  folderId: string,
  name: string,
): Promise<string | null> {
  const drive = driveClient(accessToken);
  const res = await drive.files.list({
    q: `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

// ============================================================================
// Generic Drive/Sheets helpers (report generator — Task 5 builds on these)
// ============================================================================

// Copy a Drive file into a folder, converting it to a native Google Sheet
// (required: the report template is an .xlsx, which Sheets API cannot edit).
export async function copyDriveFileAsSheet(
  accessToken: string,
  fileId: string,
  name: string,
  parentId: string,
): Promise<string> {
  const drive = driveClient(accessToken);
  const res = await drive.files.copy({
    fileId,
    requestBody: {
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    fields: "id",
  });
  return res.data.id!;
}

// Find-or-create a blank native spreadsheet by name inside a folder.
// (ensureSpreadsheet creates only the main app sheet at Drive root.)
export async function createSpreadsheetInFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string> {
  const existing = await findDriveFileInFolder(accessToken, parentId, name);
  if (existing) return existing;
  const drive = driveClient(accessToken);
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [parentId],
    },
    fields: "id",
  });
  return res.data.id!;
}

export async function listSheetTabs(
  accessToken: string,
  spreadsheetId: string,
): Promise<Array<{ sheetId: number; title: string }>> {
  const sheets = sheetsClient(accessToken);
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  return (res.data.sheets ?? []).map((s) => ({
    sheetId: s.properties!.sheetId!,
    title: s.properties!.title!,
  }));
}

// Whole-tab read as a 2D string grid. `unformatted` returns raw numbers
// (needed when comparing totals to computed values); default returns the
// display strings (needed for label anchoring).
export async function getSheetGrid(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  unformatted = false,
): Promise<string[][]> {
  const sheets = sheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle.replace(/'/g, "''")}'`,
    valueRenderOption: unformatted ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
  });
  return (res.data.values ?? []).map((row) => row.map((c) => String(c ?? "")));
}

// Write many discrete ranges in ONE API call (quota-frugal; the report fill
// is a single batch). RAW (default): numbers stay numbers (template cell
// formats apply the ₪), strings are never reinterpreted (ARCHITECTURE.md
// §8.3). Pass "USER_ENTERED" only for cells that must be parsed as real
// values by Sheets — e.g. DD/MM/YYYY strings that should become real dates
// instead of RAW-written text (which Sheets prefixes with a text-marker
// apostrophe since it looks like a date).
export async function batchWriteCells(
  accessToken: string,
  spreadsheetId: string,
  data: Array<{ range: string; values: (string | number)[][] }>,
  valueInputOption: "RAW" | "USER_ENTERED" = "RAW",
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption, data },
  });
}

export async function clearSheetRange(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
}

export async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ id: string }> {
  const drive = driveClient(accessToken);
  const { Readable } = await import("node:stream");
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id",
  });
  return { id: res.data.id! };
}

// ============================================================================
// User settings (stored in הגדרות tab as key/value rows)
// ============================================================================

const CARD_LAST4_RE = /^\d{4}$/;

export async function getUserSettings(
  accessToken: string,
  spreadsheetId: string,
): Promise<UserSettings> {
  const sheets = sheetsClient(accessToken);
  const empty: UserSettings = { myCardsLast4: [], householdSize: null, reportTemplate: null };
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TAB_SETTINGS}!A2:B`,
    });
    const rows = r.data.values || [];
    const out: UserSettings = { ...empty };
    for (const row of rows) {
      const key = String(row[0] ?? "");
      const value = String(row[1] ?? "");
      if (key === SETTINGS_KEY.MyCardsLast4) {
        out.myCardsLast4 = value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => CARD_LAST4_RE.test(s));
      }
      if (key === SETTINGS_KEY.HouseholdSize) {
        const n = Number(value);
        out.householdSize = Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
      }
      if (key === SETTINGS_KEY.ReportTemplate) {
        try {
          const t = JSON.parse(value) as { id?: unknown; name?: unknown };
          if (typeof t.id === "string" && t.id && typeof t.name === "string") {
            out.reportTemplate = { id: t.id, name: t.name };
          }
        } catch { /* malformed row — treat as unset */ }
      }
    }
    return out;
  } catch {
    return empty;
  }
}

export async function writeUserSettings(
  accessToken: string,
  spreadsheetId: string,
  s: UserSettings,
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const validCards = Array.from(
    new Set(s.myCardsLast4.filter((c) => CARD_LAST4_RE.test(c))),
  );
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_TAB_SETTINGS}!A2:B`,
  });
  const rows: string[][] = [[SETTINGS_KEY.MyCardsLast4, validCards.join(",")]];
  if (s.householdSize !== null) rows.push([SETTINGS_KEY.HouseholdSize, String(s.householdSize)]);
  if (s.reportTemplate !== null) rows.push([SETTINGS_KEY.ReportTemplate, JSON.stringify(s.reportTemplate)]);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TAB_SETTINGS}!A2`,
    valueInputOption: "RAW",
    requestBody: {
      values: rows,
    },
  });
}
