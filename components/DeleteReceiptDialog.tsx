"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEFAULT_STORE_NAME, type Receipt } from "@/lib/types";
import { formatDate, formatILS } from "@/lib/utils";

export interface DeleteReceiptDialogProps {
  // null while the dialog is closed, or once the row is gone.
  receipt: Receipt | null;
  open: boolean;
  busy: boolean;
  // How many other rows point at this one through `linkedTo` (dedup writes it).
  linkedCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DeleteReceiptDialog({
  receipt,
  open,
  busy,
  linkedCount,
  onOpenChange,
  onConfirm,
}: DeleteReceiptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>מחיקת קבלה</DialogTitle>
          <DialogDescription>
            הפעולה תמחק את השורה מגיליון הקבלות. הקובץ ב-Drive יישאר.
          </DialogDescription>
        </DialogHeader>
        {receipt && (
          <>
            {/* Identity readout — the table is sorted and paged, so the user
                needs to see which row is about to go. */}
            <div className="space-y-1 border border-border bg-muted p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">
                  {receipt.storeName ?? DEFAULT_STORE_NAME}
                </span>
                <span className="shrink-0 tabular-nums">
                  {receipt.amount === null ? "—" : formatILS(receipt.amount)}
                </span>
              </div>
              <div className="text-muted-foreground">
                {formatDate(receipt.date) || "—"}
              </div>
              <div className="truncate text-muted-foreground" title={receipt.fileName}>
                {receipt.fileName}
              </div>
            </div>
            {linkedCount > 0 && (
              <p className="text-muted-foreground">
                שורות אחרות מקושרות לקבלה זו ({linkedCount}). הקישור שלהן יישאר ללא יעד.
              </p>
            )}
          </>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={busy}>
              ביטול
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !receipt}
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            מחק
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
