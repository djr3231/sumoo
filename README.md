# סומו · סורק קבלות אישי

PWA לשימוש אישי שסורקת קבלות (תמונות / PDF), מחלצת מהן את שם החנות, סכום, תאריך וקטגוריה
באמצעות Claude Sonnet עם Vision, מאחסנת ב-Google Sheets, ומאפשרת השוואה לתדפיסי בנק/אשראי
כדי לזהות תנועות חסרות קבלה.

## תכונות

- ייבוא ישיר מתיקיית **Google Drive**, או drag‑and‑drop של קבצים מקומיים.
- חילוץ מבני באמצעות Claude (`claude-sonnet-4-6`) עם prompt caching.
- זיהוי אוטומטי של **כפילויות** ו**זיכויים** (פאס שני).
- טבלה **אינטראקטיבית** באפליקציה, עם עריכה inline שנשמרת ל-Google Sheet.
- ייצוא ל-**CSV** ו-**Excel** + קישור ישיר ל-Sheet.
- העלאת **תדפיסי בנק/אשראי** (PDF / CSV / XLSX) והשוואה אוטומטית לטבלת הקבלות.
- **PWA** — ניתן להתקנה למסך הבית.

## דרישות

- Node 20+.
- חשבון Google.
- מפתח Anthropic API.

## התקנה

```bash
npm install
cp .env.local.example .env.local
# מלא את הערכים ב-.env.local
npm run dev
```

### Google Cloud Console

1. צור פרויקט ב‑[console.cloud.google.com](https://console.cloud.google.com).
2. הפעל את `Google Sheets API` ו-`Google Drive API`.
3. צור OAuth Client (Web application). כתובת ההפנייה לפיתוח:
   `http://localhost:3000/api/auth/callback/google`.
4. הוסף את עצמך כ-test user (אם המסך עדיין ב-Testing).
5. העתק את `Client ID` ו-`Client Secret` ל-`.env.local`.

### Anthropic

1. צור מפתח ב-`console.anthropic.com`.
2. שים אותו ב-`ANTHROPIC_API_KEY`.

### NextAuth secret

```bash
openssl rand -base64 32
```

## שימוש

1. כניסה דרך `/`.
2. ב-`/upload` העלה את 103 תמונות הקבלות (drag‑and‑drop או תיקיית Drive).
3. לאחר שכולן עברו OCR — לחץ "זיהוי כפילויות וזיכויים".
4. ב-`/receipts` ערוך ידנית כל שדה שגוי. שינויים נשמרים אוטומטית.
5. ב-`/compare` העלה תדפיס בנק/אשראי כדי לראות מה חסר.

## עלות צפויה

עבור 100 קבלות: ~$1–$3 חד פעמי, וכמה סנט לאחר prompt caching. תקציב חודשי <$5 לשימוש אישי.

## פריסה

`vercel deploy`. הוסף את אותו set משתני סביבה ב-Vercel, וכתובת redirect חדשה ב-Google
Console: `https://<your>.vercel.app/api/auth/callback/google`.

## מבנה

```
app/
  api/
    auth/[...nextauth]/  # NextAuth handler
    ocr/                 # POST: image → structured receipt
    sheets/              # GET/POST/PATCH טבלת הקבלות
    drive/               # GET קבצים מתיקייה
    dedup/               # POST פאס שני
    statements/          # POST פירוק תדפיס
    match/               # POST השוואה לקבלות
  upload/, receipts/, compare/
components/              # UploadZone, ReceiptTable, CompareView, ...
lib/
  claude.ts              # שליפת קבלה, זיהוי כפילויות, פירוק PDF
  google.ts              # OAuth, Sheets, Drive
  match.ts               # התאמת תנועות
  parsers.ts             # CSV / XLSX
  types.ts               # סכמות
```

## נקודות פתוחות

- אין בדיקות אוטומטיות (אישי, ידני).
- האייקונים ב-`public/icons/` הם placeholder.
- האפליקציה מניחה משתמש יחיד.
