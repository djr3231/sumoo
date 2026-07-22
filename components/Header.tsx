import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { peekActingAccount } from "@/lib/accounts";
import { roleCan, CAPABILITY } from "@/lib/types";
import { UserMenu } from "./UserMenu";
import { SignInButton } from "./SignInButton";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { AccountChip } from "./AccountChip";

export default async function Header() {
  const session = await getServerSession(authOptions);
  const { role, ownerEmail } = await peekActingAccount();
  const showFullNav = roleCan(role, CAPABILITY.Maintain);
  // role === "owner" means the personal account — no chip at all there.
  const sharedRole = role === "owner" ? null : role;

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center">
        {session?.user ? (
          <>
            {/* Mobile header — hamburger on start (right in RTL), logo on end (left) */}
            <div className="flex md:hidden items-center justify-between w-full gap-2">
              <MobileNav email={session.user.email ?? ""} showFullNav={showFullNav} />
              {sharedRole && (
                <AccountChip
                  ownerEmail={ownerEmail ?? ""}
                  role={sharedRole}
                  className="min-w-0 max-w-[60%] gap-1"
                />
              )}
              <Link href="/" className="font-bold text-lg">סומו</Link>
            </div>

            {/* Desktop header — unchanged layout */}
            <div className="hidden md:flex items-center justify-between w-full gap-4">
              <Link href="/" className="font-bold text-lg">סומו</Link>
              <nav className="flex items-center gap-2 text-sm">
                <Link href="/upload" className="px-3 py-1.5 hover:bg-accent">
                  העלאה
                </Link>
                <Link href="/receipts" className="px-3 py-1.5 hover:bg-accent">
                  קבלות
                </Link>
                {showFullNav && (
                  <>
                    <Link href="/compare" className="px-3 py-1.5 hover:bg-accent">
                      השוואה
                    </Link>
                    <Link href="/report" className="px-3 py-1.5 hover:bg-accent">
                      דוח דו-חודשי
                    </Link>
                    <Link href="/settings" className="px-3 py-1.5 hover:bg-accent">
                      הגדרות
                    </Link>
                  </>
                )}
              </nav>
              <div className="text-sm flex items-center gap-3">
                <ThemeToggle />
                {sharedRole ? (
                  <AccountChip
                    ownerEmail={ownerEmail ?? ""}
                    role={sharedRole}
                    className="max-w-[20rem] gap-1"
                  />
                ) : (
                  <span className="text-muted-foreground">
                    {session.user.email}
                  </span>
                )}
                <UserMenu email={session.user.email ?? ""} />
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between w-full">
            <Link href="/" className="font-bold text-lg">סומו</Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <SignInButton />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
