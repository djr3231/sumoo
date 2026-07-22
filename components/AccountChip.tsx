import { Badge } from "./ui/badge";
import { FAMILY_ROLE, type FamilyRole } from "@/lib/types";

// Presentation-only role names (not domain values). Exhaustive switch — a
// new FAMILY_ROLE value must be handled here before this compiles.
export function roleLabel(role: FamilyRole): string {
  switch (role) {
    case FAMILY_ROLE.UploadView:
      return "העלאה וצפייה";
    case FAMILY_ROLE.Full:
      return "גישה מלאה";
    case FAMILY_ROLE.FullNoReport:
      return "מלאה ללא הפקת דוח";
  }
}

// Shown in the header whenever the user is acting on someone else's account.
// Nothing else in the UI distinguishes a shared account from a personal one.
export function AccountChip({
  ownerEmail,
  role,
  className,
}: {
  ownerEmail: string;
  role: FamilyRole;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={className}>
      <span dir="auto" className="min-w-0 truncate">
        {ownerEmail || "חשבון משותף"}
      </span>
      <span aria-hidden="true">·</span>
      <span className="whitespace-nowrap">{roleLabel(role)}</span>
    </Badge>
  );
}
