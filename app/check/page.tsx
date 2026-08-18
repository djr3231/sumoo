import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ReceiptCheck } from "@/components/ReceiptCheck";
import { Card, CardContent } from "@/components/ui/card";

export default async function CheckPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">האם כבר סרקתי?</h1>
        <p className="text-sm text-muted-foreground">
          סרוק קבלה שמצאת ובדוק אם היא כבר במערכת
        </p>
      </header>

      <Card>
        <CardContent>
          <ReceiptCheck />
        </CardContent>
      </Card>
    </div>
  );
}
