import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SignInButton } from "@/components/SignInButton";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/upload");

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>סומו</CardTitle>
          <CardDescription>
            סריקת קבלות אישית, חילוץ אוטומטי של חנות, סכום, תאריך וקטגוריה,
            אחסון ב-Google Sheets, והשוואה לתדפיסי בנק ואשראי.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SignInButton />
          <p className="text-xs text-muted-foreground">
            נדרשת הרשאה ל-Google Drive (לקריאת התמונות) ו-Google Sheets (לכתיבת הטבלה).
          </p>
        </CardContent>
        <CardFooter>
          <Link href="/upload" className="text-sm underline">
            כבר מחובר? דלג להעלאה
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
