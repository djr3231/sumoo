import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { CompareView } from "@/components/CompareView";

export default async function ComparePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">השוואה לתדפיס בנק / אשראי</h1>
        <p className="text-sm text-muted-foreground">
          העלה תדפיס PDF / CSV / Excel. האפליקציה תחלץ תנועות, תשווה לקבלות בטבלה,
          ותראה איזה תנועות חסרות קבלה ואילו קבלות לא מופיעות בתדפיס.
        </p>
      </header>
      <CompareView />
    </div>
  );
}
