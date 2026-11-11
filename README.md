# סומו · סורק קבלות אישי

PWA לשימוש אישי שסורקת קבלות (תמונות / PDF), מחלצת מהן את שם החנות, סכום, תאריך, קטגוריה
ואמצעי תשלום באמצעות **OpenAI** (vision), מאחסנת ב-Google Sheets, ומאפשרת
השוואה לתדפיסי בנק/אשראי כדי לזהות תנועות חסרות קבלה.

## תכונות

- ייבוא ישיר מתיקיית **Google Drive**, או drag‑and‑drop של קבצים מקומיים (כל קובץ מקומי נשמר
  אוטומטית ל-Drive בתיקייה "סומו - העלאות" ומקבל לינק ישיר).
- חילוץ מבני באמצעות **OpenAI Responses API**.
- **שמות חנויות קנוניים** — טאב "חנויות" אוסף וריאציות OCR ומאחד אותן לשם אחיד.
- **אמצעי תשלום** — מזהה מ-OCR אם שולם בכרטיס/מזומן/מעורב, ומסווג ל-"אשראי"/"מזומן" לפי
  הספרות האחרונות של הכרטיס שלך (env var `MY_CREDIT_CARD_LAST4`).
- **תשלום מעורב** — קבלה עם חלק אשראי + חלק מזומן יוצרת אוטומטית 2 שורות מקושרות.
- זיהוי אוטומטי של **כפילויות** ו**ספחי אשראי** (פאס דטרמיניסטי לפי סכום+תאריך).
- טבלה **אינטראקטיבית** באפליקציה, עריכה inline, מיון/פילטר לכל עמודה, לינק לתמונה המקורית.
- ייצוא ל-**CSV** ו-**Excel** + קישור ישיר ל-Sheet.
- העלאת **תדפיסי בנק/אשראי** (PDF / CSV / XLSX) והשוואה אוטומטית לטבלת הקבלות.
- **PWA** — ניתן להתקנה למסך הבית.

## דרישות

- Node 20+.
- חשבון Google.
- מפתח OpenAI API.

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

### OpenAI

1. Create an [OpenAI project API key](https://platform.openai.com/api-keys).
2. Set `OPENAI_API_KEY` in the server environment (`.env.local` for local development).
3. The project needs access to `gpt-6.1-sol` for documents and `gpt-6-luna` for text tasks.

### הכרטיס שלך

עדכן ב-`MY_CREDIT_CARD_LAST4` את 4 הספרות האחרונות של הכרטיס האישי שלך.
קבלות שתתועדנה בכרטיס הזה יסומנו "אשראי", שאר אמצעי התשלום יסומנו "מזומן".

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

## פריסה

`vercel deploy`. הוסף את אותו set משתני סביבה ב-Vercel.

Vercel: chewie.ceo redirects to www.chewie.ceo with status 307.
Vercel Production environment: NEXTAUTH_URL=https://www.chewie.ceo.
Google Console callback: https://www.chewie.ceo/api/auth/callback/google.
The generated sumoo.vercel.app address is not the public entry point.

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
  ai.ts                  # שליפת קבלה, זיהוי כפילויות, פירוק PDF
  openai-responses.ts    # Server-side Responses API transport
  google.ts              # OAuth, Sheets, Drive
  match.ts               # התאמת תנועות
  parsers.ts             # CSV / XLSX
  types.ts               # סכמות
```

## נקודות פתוחות

- אין בדיקות אוטומטיות (אישי, ידני).
- האייקונים ב-`public/icons/` הם placeholder.
- האפליקציה מניחה משתמש יחיד.
