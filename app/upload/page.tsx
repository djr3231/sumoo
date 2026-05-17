import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { UploadZone } from "@/components/UploadZone";
import { DriveImport } from "@/components/DriveImport";

export default async function UploadPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">העלאת קבלות</h1>
        <p className="text-sm text-muted-foreground">
          תוכל להעלות מקומית, או לייבא תיקייה מ-Google Drive.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold">ייבוא מתיקיית Google Drive</h2>
        <DriveImport />
      </section>

      <hr className="border-border" />

      <section className="space-y-3">
        <h2 className="font-semibold">העלאה ישירה (drag-and-drop)</h2>
        <UploadZone />
      </section>
    </div>
  );
}
