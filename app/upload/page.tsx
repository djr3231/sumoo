import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { peekActingRole } from "@/lib/accounts";
import { roleCan, CAPABILITY } from "@/lib/types";
import { UploadZone } from "@/components/UploadZone";
import { DriveImport } from "@/components/DriveImport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function UploadPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = await peekActingRole();
  const canDriveImport = roleCan(role, CAPABILITY.DriveBrowse);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">העלאת קבלות</h1>
        <p className="text-sm text-muted-foreground">
          תוכל להעלות מקומית, או לייבא תיקייה מ-Google Drive.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2 items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">העלאה ישירה (drag-and-drop)</CardTitle>
          </CardHeader>
          <CardContent>
            <UploadZone />
          </CardContent>
        </Card>

        {canDriveImport && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ייבוא מתיקיית Google Drive</CardTitle>
            </CardHeader>
            <CardContent>
              <DriveImport />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
