import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { peekActingRole } from "@/lib/accounts";
import { roleCan, CAPABILITY } from "@/lib/types";
import { CompareView } from "@/components/CompareView";

export default async function ComparePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = await peekActingRole();
  if (!roleCan(role, CAPABILITY.Maintain)) redirect("/receipts");
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
