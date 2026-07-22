"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { UserCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { type FamilyRole } from "@/lib/types";
import { roleLabel } from "./AccountChip";

interface SharedAccount {
  spreadsheetId: string;
  ownerEmail: string;
  role: FamilyRole;
}

interface AccountsResponse {
  email: string;
  shared: SharedAccount[];
  active: { kind: "personal" | "shared"; spreadsheetId?: string };
  error?: string;
}

export function UserMenu({ email }: { email: string }) {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (data || loading) return;
    setLoading(true);
    try {
      const r = await fetch("/api/accounts");
      const j = (await r.json()) as AccountsResponse;
      if (!r.ok) throw new Error(j.error || "failed");
      setData(j);
    } catch {
      toast.error("טעינת החשבונות נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function switchTo(target: string) {
    try {
      const r = await fetch("/api/accounts/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error || "failed");
      }
      // Every view fetches on mount — a full reload is the simplest way to
      // re-render all data for the newly active account.
      window.location.reload();
    } catch {
      toast.error("החלפת החשבון נכשלה");
    }
  }

  const active =
    data?.active.kind === "shared" && data.active.spreadsheetId
      ? data.active.spreadsheetId
      : "personal";

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="חשבון משתמש">
          <UserCircle size={22} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {data ? (
          <DropdownMenuRadioGroup
            value={active}
            onValueChange={(v) => {
              if (v !== active) void switchTo(v);
            }}
          >
            <DropdownMenuRadioItem value="personal">
              החשבון שלי
            </DropdownMenuRadioItem>
            {data.shared.map((a) => (
              <DropdownMenuRadioItem key={a.spreadsheetId} value={a.spreadsheetId}>
                <span className="flex flex-col items-start">
                  <span>{a.ownerEmail}</span>
                  <span className="text-xs text-muted-foreground">
                    {roleLabel(a.role)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <DropdownMenuItem disabled>{loading ? "טוען…" : "…"}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/" })}>
          התנתקות
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
