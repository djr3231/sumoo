"use client";
import { useState } from "react";
import Link from "next/link";
import { List } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { Button } from "./ui/button";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";

interface MobileNavProps {
  email: string;
  showFullNav: boolean;
}

export function MobileNav({ email, showFullNav }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="תפריט">
          <List size={22} />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col pt-10 gap-0">
        <nav className="flex flex-col text-base">
          <Link href="/upload" onClick={() => setOpen(false)} className="px-3 py-3 hover:bg-accent">
            העלאה
          </Link>
          <Link href="/receipts" onClick={() => setOpen(false)} className="px-3 py-3 hover:bg-accent">
            קבלות
          </Link>
          {showFullNav && (
            <>
              <Link href="/compare" onClick={() => setOpen(false)} className="px-3 py-3 hover:bg-accent">
                השוואה
              </Link>
              <Link href="/report" onClick={() => setOpen(false)} className="px-3 py-3 hover:bg-accent">
                דוח דו-חודשי
              </Link>
              <Link href="/settings" onClick={() => setOpen(false)} className="px-3 py-3 hover:bg-accent">
                הגדרות
              </Link>
            </>
          )}
        </nav>
        <div className="mt-auto pt-6 flex flex-col gap-3 text-sm border-t border-border">
          <div className="flex items-center justify-between px-3 pt-3 pb-3">
            <span className="text-muted-foreground">{email}</span>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <UserMenu email={email} />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
