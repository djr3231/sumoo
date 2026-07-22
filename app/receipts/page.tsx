import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { peekActingRole } from "@/lib/accounts";
import { roleCan, CAPABILITY } from "@/lib/types";
import { ReceiptTable } from "@/components/ReceiptTable";

export default async function ReceiptsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = await peekActingRole();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">קבלות</h1>
        <p className="text-sm text-muted-foreground">
          {roleCan(role, CAPABILITY.EditReceipts)
            ? "טבלה מלאה. ניתן לערוך תאים inline; שינויים נשמרים אוטומטית ל-Google Sheets."
            : "טבלה מלאה."}
        </p>
      </header>
      <ReceiptTable readOnly={!roleCan(role, CAPABILITY.EditReceipts)} />
    </div>
  );
}
