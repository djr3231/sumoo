import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { peekActingRole } from "@/lib/accounts";
import { roleCan, CAPABILITY } from "@/lib/types";
import { ReportWizard } from "@/components/ReportWizard";

export default async function ReportPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = await peekActingRole();
  if (!roleCan(role, CAPABILITY.ReportBuild)) redirect("/receipts");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">הכנת דוח דו-חודשי</h1>
        <p className="text-sm text-muted-foreground">
          בחר תקופה, העלה מסמכים, והפק דוח דו-חודשי להגשה
        </p>
      </header>

      <ReportWizard canExport={roleCan(role, CAPABILITY.ReportExport)} />
    </div>
  );
}
