import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "./SignOutButton";
import { SignInButton } from "./SignInButton";

export default async function Header() {
  const session = await getServerSession(authOptions);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="font-bold text-lg">סומו</Link>
        {session?.user ? (
          <>
            <nav className="flex items-center gap-2 text-sm">
              <Link href="/upload" className="px-3 py-1.5hover:bg-accent">
                העלאה
              </Link>
              <Link href="/receipts" className="px-3 py-1.5hover:bg-accent">
                קבלות
              </Link>
              <Link href="/compare" className="px-3 py-1.5hover:bg-accent">
                השוואה
              </Link>
              <Link href="/settings" className="px-3 py-1.5hover:bg-accent">
                הגדרות
              </Link>
            </nav>
            <div className="text-sm flex items-center gap-3">
              <span className="text-muted-foreground">
                {session.user.email}
              </span>
              <SignOutButton />
            </div>
          </>
        ) : (
          <SignInButton />
        )}
      </div>
    </header>
  );
}
