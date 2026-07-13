"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignatureField } from "@/components/SignatureField";
import type { PersonalDetails, PdfProgress } from "@/lib/report/pdf";

export interface PdfExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  progress: PdfProgress | null;
  onSubmit: (payload: {
    personal: PersonalDetails;
    signaturePngBase64: string;
    previewOnly?: boolean;
  }) => void;
}

// DD/MM/YYYY, zero-padded — same convention as the /api/report/pdf route.
function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Approved stage strings (design spec 2026-07-12). Counter format: (X מתוך Y).
function progressLabel(p: PdfProgress): string {
  const count =
    p.done !== undefined && p.total !== undefined ? ` (${p.done} מתוך ${p.total})` : "";
  switch (p.stage) {
    case "prepare":
      return "מכין את הדוח…";
    case "export":
      return "מייצא וחותם…";
    case "sources":
      return `מצרף מסמכי מקור…${count}`;
    case "receipts":
      return `מצרף קבלות…${count}`;
    case "move":
      return `מסדר קבצים בדרייב…${count}`;
    case "upload":
      return "שומר את הקובץ…";
  }
}

// The form body is only rendered while `open` is true, so each open remounts
// it fresh and every field's `useState` initial re-runs — this is the reset-
// on-open mechanism (no `useEffect` + `setState` needed, keeping the repo's
// `react-hooks/set-state-in-effect` lint rule clean).
function PdfExportForm({
  busy,
  progress,
  onSubmit,
}: {
  busy: boolean;
  progress: PdfProgress | null;
  onSubmit: (payload: {
    personal: PersonalDetails;
    signaturePngBase64: string;
    previewOnly?: boolean;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayDDMMYYYY());
  const [sig, setSig] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pdf-export-name">שם</Label>
          <Input
            id="pdf-export-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pdf-export-case-number">מס&apos; תיק ממונה</Label>
          <Input
            id="pdf-export-case-number"
            type="text"
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pdf-export-address">כתובת עדכנית</Label>
          <Input
            id="pdf-export-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pdf-export-phone">טלפון</Label>
          <Input
            id="pdf-export-phone"
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pdf-export-date">תאריך</Label>
          <Input
            id="pdf-export-date"
            type="text"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>חתימה</Label>
          <SignatureField value={sig} onChange={setSig} />
        </div>
      </div>
      <DialogFooter>
        {busy && progress ? (
          <p className="me-auto self-center text-sm text-muted-foreground">
            {progressLabel(progress)}
          </p>
        ) : null}
        <DialogClose asChild>
          <Button variant="outline" type="button">
            ביטול
          </Button>
        </DialogClose>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !name.trim() || !sig}
          onClick={() =>
            onSubmit({
              personal: { name, caseNumber, address, phone, date },
              signaturePngBase64: sig as string,
              previewOnly: true,
            })
          }
        >
          תצוגה מקדימה
        </Button>
        <Button
          type="button"
          disabled={busy || !name.trim() || !sig}
          onClick={() =>
            onSubmit({
              personal: { name, caseNumber, address, phone, date },
              signaturePngBase64: sig as string,
            })
          }
        >
          {busy ? "מנפיק…" : "הנפק"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PdfExportDialog({ open, onOpenChange, busy, progress, onSubmit }: PdfExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>פרטים להנפקת ה-PDF</DialogTitle>
          <DialogDescription>
            הפרטים ישמשו להנפקה חד-פעמית ולא יישמרו במערכת.
          </DialogDescription>
        </DialogHeader>
        {open && <PdfExportForm busy={busy} progress={progress} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  );
}
