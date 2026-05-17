import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SettingsForm } from "@/components/SettingsForm";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  return (
    <div className="space-y-4 max-w-lg">
      <header>
        <h1 className="text-2xl font-bold">הגדרות</h1>
        <p className="text-sm text-muted-foreground">
          הגדרות אישיות נשמרות בגיליון Google Sheets שלך.
        </p>
      </header>
      <SettingsForm />
    </div>
  );
}
