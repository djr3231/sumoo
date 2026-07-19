import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { peekActingRole } from "@/lib/accounts";
import { roleCan, CAPABILITY } from "@/lib/types";
import { SettingsForm } from "@/components/SettingsForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = await peekActingRole();
  if (!roleCan(role, CAPABILITY.SettingsRead)) redirect("/receipts");
  return (
    <div className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>הגדרות</CardTitle>
          <CardDescription>
            הגדרות אישיות נשמרות בגיליון Google Sheets שלך.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm />
        </CardContent>
      </Card>
    </div>
  );
}
