# Plan: Bi-Monthly Insolvency Report Generator ("הכנת דוח דו-חודשי")

> **STATUS: ✅ COMPLETE — shipped to production 2026-07-13.** All six wizard steps
> are live, including step-6 report generation (הפק דוח: working sheet + anonymous
> government report from the clean template) and the signed-PDF bundle export
> (נפק PDF: personal details + stamped signature + source documents + attached
> receipts, streamed progress, preview mode, image compression). This document is
> retained as the **historical feature spec**; the execution-era specs and plans
> live under `docs/superpowers/specs/` and `docs/superpowers/plans/`
> (step-6: `2026-07-09-insolvency-report-step6.md`; PDF export:
> `2026-07-12-report-pdf-export.md`, `2026-07-12-report-pdf-fit-and-progress.md`).

> Original charter (historical): Handoff spec for a fresh local CLI session.
> Build on `dev`, feature branch `feat/insolvency-report`, PR into `dev`.
> Never touch `main`.

---

## 1. Context — why this exists

The user is in an Israeli insolvency proceeding ("חדלות פירעון"). Every two
months he must file an official income/expense report ("דו"ח על הכנסות והוצאות
יחיד/ה בהליך חדלות פירעון") with supporting evidence (receipts) for each
expense. He and his spouse are **two separate cases** (David — תיק 455886,
Chava — תיק 455881) sharing one household/bank account.

Today this is done by hand in two Google Sheets per period. The app must
automate the pipeline end-to-end. This is a **new dedicated flow**, not a tweak
to the existing receipt scanner — though it reuses much of its machinery.

The user confirmed these product decisions:

1. **New dedicated page** "הכנת דוח דו-חודשי" with ordered, wizard-style steps.
2. **Email-receipt search deferred to Phase B** (no Gmail scope yet).
3. **Phased build** — Phase A = core ingest/reconcile/report; Phase B = email + cash polish.
4. Cash receipts come from a **Drive folder** (reuse existing DriveImport pattern). Google Photos auto-search is technically blocked (post-2025 API) — do not attempt.

---

## 2. Ground truth from the real documents (READ THIS FIRST)

The planning session inspected the user's actual prior-period documents (Drive
folder `1KsFGglayc7RxHlNwoPIWEjq18RZh4s4C`) and both reference spreadsheets.
The executor must internalize these facts before coding — they drive every
design choice.

### 2.1 Input documents per period (what the user uploads)

| Doc                         | Format             | Example file                                                                         | Notes                                                  |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Checking account (עו"ש)     | **XLS** and/or PDF | `תנועות בחשבון עו_ש_03-04.xls`, `…עו״ש.pdf`                                          | Bank Yahav (יהב), acct 04-401-135187                   |
| Direct card detail (דיירקט) | PDF                | `פירוט חיובים דיירקט.pdf`                                                            | Isracard Direct, card 6021                             |
| Salary slips ×2/month       | PDF                | `תלוש_חוה_02/03.pdf` (civilian, עיריית חריש), `שכר-דודי-02/03.pdf` (army, מופת/צה"ל) | **Two earners / two jobs.** Net pay is the key figure. |

The XLS עו"ש is the cleanest structured source — prefer it over the PDF when both exist.

### 2.2 עו"ש (checking) transaction shape

Columns (RTL): `תאריך | תאריך ערך | אסמכתא | תיאור פעולה | חובה(₪) | זכות(₪) | יתרה משוערכת(₪)`.
Transaction families seen:

- **`ישראכרט-דיירקט 6021`** — debit settlements of the Direct card. **These are NOT separate expenses** — they are the bank-side reflection of the דיירקט detail. Report from the merchant-level דיירקט detail; ignore these aggregate lines to avoid double counting. (Use them only as a reconciliation checksum: sum of דיירקט detail ≈ sum of these lines.)
- **`משיכה מבנקט 6021`** — ATM **cash withdrawals**. Sum these per period → this is the cash amount that must be justified by camera receipts.
- **`הו"ק/...`** — standing orders (e.g. `הו"ק/ועד תמר 250`, `הו"ק/גיל יהלום 800`).
- **`משכורת/...`** (זכות) — salaries (`משכורת/מופת קבע 8,664.06`, `משכורת/עיריית חריש 9,757.58`).
- **`קצבת ילדים`** (זכות) — National Insurance child allowance (173).
- **`העברה/<name>`** (זכות) — transfers from family/friends. **In the prior gov report these were NOT counted as income.** Flag for user confirmation per period; default = exclude from reported income, but list them in the working sheet.
- Direct debits to authorities: `עיריית חריש` (municipality), `שירותי בריאות כללית`, `חברת החשמל`, `פרטנר`, `הכונס הרשמי / תשלום לממונה`.

### 2.3 דיירקט (card) detail shape → this becomes the working sheet

Each charge: merchant name, amount, currency (₪ or $ for אתר חו"ל), optional note, date. Foreign charges (CLAUDE.AI, ANTHROPIC, SPOTIFY, GOOGLE ONE) show `$` + `אתר חו"ל`. Some are standing orders (GOOGLE ONE marked `הוראת קבע`).

### 2.4 The working sheet ("חישוב תדפיסי בנק") — intermediate artifact

Sheet `חיובים דיירקט` columns, verbatim:

```
שם בית עסק | סכום חיוב | מטבע חיוב | פירוט נוסף | תאריך חיוב | קטגוריה | קבלה
```

- `קטגוריה` = one of the **fixed government expense categories** (§3.2).
- `קבלה` = receipt filename (`IMG_20260503_*.jpg` for camera/cash, `*.pdf` for email receipts like `Receipt for your Lime ride.pdf`, `Pango PDF`, `Donation_Receipt_*.pdf`), or `-` if none.
- Food gets an extra breakdown sheet (`פירוטים`): per-month date+amount list summing to `סה"כ כלכלה`.

Camera receipts in the sample were all shot in one session (`IMG_20260503_*`) — i.e. the user photographs a stack of cash receipts at once. This is exactly the Phase-A cash-folder use case.

---

## 3. The government report — FIXED schema (output target)

The final deliverable mirrors the official template (file `1Vc_ITRfkS3klTqDVEHrf7-SQM9tzieCq`, an `.xlsx`). It contains **one report per individual** (David + Chava), each identical structure, two month-columns.

### 3.1 Income rows (6, fixed)

1. הכנסה ממשכורת (נטו)
2. הכנסה מעסק
3. פנסיה
4. הכנסה משכר דירה / סיוע בשכר דירה
5. קצבאות מהמוסד לביטוח לאומי
6. הכנסות מתשלום מזונות
   → `סה"כ הכנסות`

### 3.2 Expense rows (23, fixed) — these ARE the categorization target

1. שכר דירה
2. משכנתא
3. מיסי עירייה
4. כלכלה (מזון), מס' נפשות \_\_
5. תקשורת ביתית (טלפון, טלוויזיה, אינטרנט)
6. טלפון נייד
7. גז
8. וועד בית
9. מים
10. חשמל
11. הלבשה
12. אחזקת רכב
13. נסיעות
14. תשלום חודשי לממונה
15. הוצאות רפואיות חריגות
16. נסיעות בתחבורה ציבורית
17. הוצאות טיפול בילדים עד גיל 3
18. תשלום מזונות לזכאים
19. תספורת
20. שונות
21. עו"ד
22. כלי בית ותחזוקה
23. (spare/blank)
    → `סה"כ הוצאות`

### 3.3 Footer (fixed)

Address, phone, the legal declaration (`...ס' 346 לחוק חדלות פירעון ושיקום כלכלי, התשע"ח – 2018`), date, signature line.

**These 29 strings are the canonical domain enum for this feature.** Declare them once in `lib/types.ts` (new `GOV_INCOME_CATEGORY` / `GOV_EXPENSE_CATEGORY` const objects), mirroring the existing const-enum pattern (ARCHITECTURE.md §4.4). Everything else maps INTO these.

---

## 4. Architecture

Layer a **"reporting period"** concept on top of the existing app. Reuse the
service layer (`lib/google.ts`, `lib/ai.ts`, `lib/parsers.ts`, `lib/match.ts`);
add report-specific logic in new modules.

### 4.1 Output location & artifacts (per period)

- Create Drive folder `דוחות חודשיים/<m1>-<m2>_<year>` (e.g. `5-6_2026`) via a new `ensureReportFolder()` (model on existing `ensureUploadFolder` in `lib/google.ts:549`).
- Inside it:
  - subfolder for uploaded source docs (עו"ש, דיירקט, salary slips),
  - subfolder for cash-receipt photos,
  - the **working spreadsheet** (the `חיובים דיירקט` audit trail), generated by the app,
  - the **final government report**, produced by **copying the template file** (`1Vc_…`) into the folder and filling cells — do NOT rebuild the merged-cell layout from scratch (far more robust). Use Drive `files.copy` then Sheets `values.update` to known cells. (The executor should confirm the template file ID is stable / or store a copy in the repo's Drive.)

### 4.2 New page — "הכנת דוח דו-חודשי" (wizard)

New route `app/report/page.tsx` + client component `components/ReportWizard.tsx`.
Use the existing shadcn primitives (Stepper-like layout with `Card` per step;
no new deps). Ordered steps mirroring the user's mental model:

1. **בחירת תקופה** — pick the two months + year → derive folder name. Create the period folder.
2. **העלאת מסמכים** — upload עו"ש (xls/pdf), דיירקט (pdf), salary slips (pdf ×N). Reuse `UploadZone`/`DriveFolderPicker` patterns; store into the period source subfolder.
3. **פירוק וסיווג** — parse all docs; show the classified income/expense tables (editable, like `ReceiptTable` inline edit). This is where category assignment happens.
4. **התאמת קבלות** — attach receipts to charges: from existing scanned receipts (reuse `lib/match.ts`), and (Phase A) from the cash-receipt Drive folder.
5. **מזומן** — show sum of ATM withdrawals vs. sum of cash receipts; help the user close the gap.
6. **הפקת דוח** — generate working sheet + filled government report into the period folder; link out.

(Phase B inserts an "חיפוש קבלות במייל" sub-step inside step 4.)

### 4.3 Data flow / new backend modules

- `lib/report/period.ts` — period model, folder naming, folder creation.
- `lib/report/classify.ts` — map a transaction (merchant + description + amount sign) to a `GOV_INCOME_CATEGORY` / `GOV_EXPENSE_CATEGORY`. Use Gemini (`lib/ai.ts` pattern) with the fixed category enum baked into the response schema (ARCHITECTURE.md §1.3 exhaustive-switch discipline). Seed with a learned merchant→category map (persist in a new sheet tab so corrections stick across periods).
- `lib/report/reconcile.ts` — the core: ingest parsed עו"ש + דיירקט + salaries, drop the `ישראכרט-דיירקט` aggregate lines, keep merchant-level card charges, fold in non-card עו"ש debits (הו"ק, authorities, ממונה), compute cash-withdrawal total, compute income from salary nets + קצבת ילדים. Output a per-individual, per-month category roll-up.
- `lib/report/salary.ts` — extract NET pay + month from a salary slip PDF (Gemini OCR; the slips are messy RTL — net is `נטו לתשלום` / `שכר חודשי נטו`). Two slips per month → sum.
- `lib/report/generate.ts` — copy gov template, write category sums into the fixed cells for both individuals; build the working sheet.

### 4.4 New API routes (Node runtime, `requireAccessToken`)

`app/api/report/period`, `/parse`, `/classify`, `/reconcile`, `/generate` — thin orchestrators over the lib modules, returning JSON envelopes (ARCHITECTURE.md §7.4).

### 4.5 New sheet tabs / settings

- A learned `merchant → gov-category` map (new tab, persists corrections).
- Per-period working data may live in the generated per-period spreadsheet rather than the main app spreadsheet — keeps the insolvency data isolated. Executor to decide; default = per-period spreadsheet in the period folder.

---

## 5. Reuse map (build on, don't reinvent)

| Need                           | Reuse                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Folder create/find             | `ensureUploadFolder` → clone as `ensureReportFolder` (`lib/google.ts:549`)                                           |
| File upload/download/list      | `uploadFileToDrive`, `downloadDriveFile`, `listDriveFolderImages` (`lib/google.ts:503-590`)                          |
| Spreadsheet create + format    | `ensureSpreadsheet`, `ensureTabs`, `applyTabFormatting`, `writeHeaders` (`lib/google.ts:147-273`)                    |
| CSV/XLSX/PDF statement parsing | `lib/parsers.ts` + `parseStatementPDF` (`lib/ai.ts:471`) — extend for the Yahav XLS + Direct PDF column shapes in §2 |
| Receipt OCR                    | `extractReceipt` (`lib/ai.ts:214`) for cash photos                                                                   |
| Receipt↔charge matching        | `lib/match.ts` (amount ±0.5%, date ±3d, name fuzzy) — reuse for attaching receipts to charges                        |
| Cash-folder import UI          | `components/DriveImport.tsx` + `DriveFolderPicker.tsx`                                                               |
| Inline-editable tables         | `components/ReceiptTable.tsx` patterns                                                                               |
| Const-enum domain types        | pattern in `lib/types.ts` §4.4                                                                                       |

---

## 6. Phase split

### Phase A (first PR) — core pipeline, manual receipt sourcing

- Period folder + wizard skeleton (steps 1-3, 5-6).
- Parse עו"ש (XLS first) + דיירקט PDF + salary slips.
- Reconcile + classify into the fixed gov categories (with editable overrides).
- Cash: compute withdrawal total; import cash-receipt photos from a Drive folder; OCR + categorize; show coverage gap.
- Generate working sheet + filled government report (template-copy approach) for **David first**; structure so Chava is a second pass.
- No email integration.

### Phase B (later) — automation polish

- Add `gmail.readonly` scope + email-receipt search (Lime/Spotify/Pango/Google/donation PDFs land in email).
- Auto-match email receipts to charges.
- Optional: investigate on-device "is this image a receipt?" object-detection model to pre-filter a photos folder before upload (user's idea — evaluate feasibility/value; not required).
- Second individual (Chava) full automation; income-source edge cases.

---

## 7. Open decisions — executor must confirm with the user before/early in build

1. **Two individuals**: generate both David + Chava reports in Phase A, or David only first? (Plan assumes David first, Chava-ready structure.)
2. **Family/friend transfers** (`העברה/<name>` credits): confirmed excluded from reported income? (Prior report excluded them.)
3. **Which net salary figure** counts when a slip has retro/adjustment lines — use `נטו לתשלום` of the month the period covers.
4. **Government template source**: is file `1Vc_…` the canonical blank template to copy each period, or should a clean blank be stored in the repo's Drive?
5. **Category overrides persistence**: confirm a learned merchant→category map tab is wanted (recommended — saves work every period).
6. Strings: every Hebrew UI label not already in §3 or the codebase → STOP-and-ASK (CLAUDE.MD §4).

---

## 8. Verification (end-to-end)

1. Run the wizard for period `3-4_2026` using the user's known-good prior docs (Drive folder `1KsFGglayc7RxHlNwoPIWEjq18RZh4s4C`).
2. Compare generated output against the user's hand-made references:
   - working sheet vs. `חישוב תדפיסי בנק 03-04` (`1MdQ_xHYLHT139RktKn_LGxZrPM-L_69XxifAZDc_AsQ`),
   - government report vs. `דו'ח דו-חודשי…` (`1Vc_ITRfkS3klTqDVEHrf7-SQM9tzieCq`).
   - Targets to hit (David, חודש מרץ / אפריל): סה"כ הכנסות `18,566.57 / 18,594.64`; סה"כ הוצאות `19,258.71 / 18,208.57`; e.g. כלכלה `4,680.44 / 7,585.57`, תשלום לממונה `5,200 / 5,200`. Category sums should match within rounding; investigate any line that doesn't.
3. `npm run typecheck` + `npm run build` pass; design-system greps clean; no `alert()`.
4. Hand off to user for visual + numeric verification before declaring done.

---

## 9. Out of scope

- Filing/submitting the report to any government system (manual).
- Google Photos automated search (API blocked post-2025).
- Bank/card API integration (always user-uploaded documents).
- Changing the existing receipt-scanner pages.

---

## Reference file IDs (Drive)

- Prior-period source docs folder: `1KsFGglayc7RxHlNwoPIWEjq18RZh4s4C`
- User's working calc sheet (example): `1MdQ_xHYLHT139RktKn_LGxZrPM-L_69XxifAZDc_AsQ`
- Government format template: `1Vc_ITRfkS3klTqDVEHrf7-SQM9tzieCq`
