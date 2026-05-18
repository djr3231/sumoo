"use client";
import { useState } from "react";
import Link from "next/link";
import { List } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { Button } from "./ui/button";
import { SignOutButton } from "./SignOutButton";

interface MobileNavProps {
  email: string;
}

export function MobileNav({ email }: MobileNavProps) {
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
          <Link href="/compare" onClick={() => setOpen(false)} className="px-3 py-3 hover:bg-accent">
            השוואה
          </Link>
          <Link href="/settings" onClick={() => setOpen(false)} className="px-3 py-3 hover:bg-accent">
            הגדרות
          </Link>
        </nav>
        <div className="mt-auto pt-6 flex flex-col gap-3 text-sm">
          <span className="text-muted-foreground px-3">{email}</span>
          <div className="px-3">
            <SignOutButton />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
