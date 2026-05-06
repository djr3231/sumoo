import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ReceiptTable } from "@/components/ReceiptTable";

export default async function ReceiptsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">קבלות</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          טבלה מלאה. ניתן לערוך תאים inline; שינויים נשמרים אוטומטית ל-Google Sheets.
        </p>
      </header>
      <ReceiptTable />
    </div>
  );
}
