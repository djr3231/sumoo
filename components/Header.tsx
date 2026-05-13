import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "./SignOutButton";

export default async function Header() {
  const session = await getServerSession(authOptions);

  return (
    <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="font-bold text-lg">סומו</Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/upload" className="px-3 py-1.5 rounded hover:bg-[hsl(var(--accent))]">
            העלאה
          </Link>
          <Link href="/receipts" className="px-3 py-1.5 rounded hover:bg-[hsl(var(--accent))]">
            קבלות
          </Link>
          <Link href="/compare" className="px-3 py-1.5 rounded hover:bg-[hsl(var(--accent))]">
            השוואה
          </Link>
          <Link href="/settings" className="px-3 py-1.5 rounded hover:bg-[hsl(var(--accent))]">
            הגדרות
          </Link>
        </nav>
        <div className="text-sm flex items-center gap-3">
          {session?.user?.email && (
            <>
              <span className="text-[hsl(var(--muted-foreground))]">
                {session.user.email}
              </span>
              <SignOutButton />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
