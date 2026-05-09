# סומו · סורק קבלות אישי

PWA לשימוש אישי שסורקת קבלות (תמונות / PDF), מחלצת מהן את שם החנות, סכום, תאריך, קטגוריה
ואמצעי תשלום באמצעות **Gemini 2.5 Flash** (vision), מאחסנת ב-Google Sheets, ומאפשרת
השוואה לתדפיסי בנק/אשראי כדי לזהות תנועות חסרות קבלה.

## תכונות

- ייבוא ישיר מתיקיית **Google Drive**, או drag‑and‑drop של קבצים מקומיים (כל קובץ מקומי נשמר
  אוטומטית ל-Drive בתיקייה "סומו - העלאות" ומקבל לינק ישיר).
- חילוץ מבני באמצעות **Gemini 2.5 Flash** (זול, מהיר, מתמודד טוב עם תמונות מסובבות).
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

### Google AI (Gemini)

1. צור מפתח ב-<https://aistudio.google.com/apikey>.
2. שים אותו ב-`GOOGLE_AI_KEY`. המפתח מתחיל ב-`AIza...`.
3. ה-tier החינמי של Gemini 2.5 Flash נדיב — מספיק ל~1000 קבלות בחודש בלי תשלום.

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
