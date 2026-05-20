import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "./SignOutButton";
import { SignInButton } from "./SignInButton";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";

export default async function Header() {
  const session = await getServerSession(authOptions);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center">
        {session?.user ? (
          <>
            {/* Mobile header — hamburger on start (right in RTL), logo on end (left) */}
            <div className="flex md:hidden items-center justify-between w-full">
              <MobileNav email={session.user.email ?? ""} />
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
                <Link href="/compare" className="px-3 py-1.5 hover:bg-accent">
                  השוואה
                </Link>
                <Link href="/settings" className="px-3 py-1.5 hover:bg-accent">
                  הגדרות
                </Link>
              </nav>
              <div className="text-sm flex items-center gap-3">
                <ThemeToggle />
                <span className="text-muted-foreground">
                  {session.user.email}
                </span>
                <SignOutButton />
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
