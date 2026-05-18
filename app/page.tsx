import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SignInButton } from "@/components/SignInButton";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/upload");

  return (
    <div className="max-w-2xl mx-auto py-12 text-center space-y-6">
      <h1 className="text-3xl font-bold">סומו</h1>
      <p className="text-muted-foreground">
        סריקת קבלות אישית, חילוץ אוטומטי של חנות, סכום, תאריך וקטגוריה,
        אחסון ב-Google Sheets, והשוואה לתדפיסי בנק ואשראי.
      </p>
      <div className="flex justify-center">
        <SignInButton />
      </div>
      <p className="text-xs text-muted-foreground">
        נדרשת הרשאה ל-Google Drive (לקריאת התמונות) ו-Google Sheets (לכתיבת הטבלה).
      </p>
      <div className="text-sm pt-8">
        <Link href="/upload" className="underline">
          כבר מחובר? דלג להעלאה
        </Link>
      </div>
    </div>
  );
}
