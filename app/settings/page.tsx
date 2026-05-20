import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SettingsForm } from "@/components/SettingsForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
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
