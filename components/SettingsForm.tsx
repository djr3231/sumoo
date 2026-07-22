"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/Skeleton";
import { Alert, AlertDescription } from "./ui/Alert";
import { DriveFilePicker, type FileSelection } from "./DriveFilePicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { roleLabel } from "./AccountChip";
import { FAMILY_ROLE, FAMILY_ROLE_VALUES, type FamilyMember, type FamilyRole } from "@/lib/types";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

interface SettingsResponse {
  myCardsLast4?: string[];
  householdSize?: number | null;
  reportTemplate?: { id: string; name: string } | null;
  familyMembers?: FamilyMember[];
  error?: string;
}

interface FamilyResponse {
  ok?: boolean;
  members?: FamilyMember[];
  sharing?: Array<{ target: string; ok: boolean }>;
  error?: string;
}

function toReportTemplate(t: FileSelection): { id: string; name: string } | null {
  return t.kind === "drive" ? { id: t.id, name: t.name } : null;
}

export function SettingsForm({ isOwner }: { isOwner: boolean }) {
  const [cards, setCards] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [householdSize, setHouseholdSize] = useState<number | null>(null);
  const [householdDraft, setHouseholdDraft] = useState("");
  const [template, setTemplate] = useState<FileSelection>({ kind: "default" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<FamilyRole>(FAMILY_ROLE.UploadView);
  const [addingMember, setAddingMember] = useState(false);
  const [busyMemberEmail, setBusyMemberEmail] = useState<string | null>(null);
  const [editingMemberEmail, setEditingMemberEmail] = useState<string | null>(null);
  const [editingMemberRole, setEditingMemberRole] = useState<FamilyRole | null>(null);
  const familyMutationLock = useRef(false);
  const isFamilyMutating = addingMember || busyMemberEmail !== null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = (await res.json()) as SettingsResponse;
        if (!alive) return;
        if (!res.ok) { setError(json.error || `HTTP ${res.status}`); return; }
        setCards(Array.isArray(json.myCardsLast4) ? json.myCardsLast4 : []);
        const hs = typeof json.householdSize === "number" ? json.householdSize : null;
        setHouseholdSize(hs);
        setHouseholdDraft(hs != null ? String(hs) : "");
        const rt = json.reportTemplate;
        setTemplate(
          rt && typeof rt.id === "string" && typeof rt.name === "string"
            ? { kind: "drive", id: rt.id, name: rt.name }
            : { kind: "default" },
        );
        setMembers(Array.isArray(json.familyMembers) ? json.familyMembers : []);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function persist(overrides?: {
    cards?: string[];
    householdSize?: number | null;
    template?: FileSelection;
  }) {
    const nextCards = overrides?.cards ?? cards;
    const nextHouseholdSize =
      overrides && "householdSize" in overrides
        ? (overrides.householdSize ?? null)
        : householdSize;
    const nextTemplate = overrides?.template ?? template;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          myCardsLast4: nextCards,
          householdSize: nextHouseholdSize,
          reportTemplate: toReportTemplate(nextTemplate),
        }),
      });
      const json = (await res.json()) as SettingsResponse;
      if (!res.ok) { setError(json.error || `HTTP ${res.status}`); return; }
      toast.success("נשמר ✓");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addAndSave() {
    const v = draft.trim();
    if (!/^\d{4}$/.test(v)) { setDraftError("יש להזין בדיוק 4 ספרות"); return; }
    if (cards.includes(v)) { setDraftError("כבר ברשימה"); return; }
    const next = [...cards, v];
    setCards(next);
    setDraft("");
    setDraftError(null);
    await persist({ cards: next });
  }

  async function removeAndSave(c: string) {
    const next = cards.filter((x) => x !== c);
    setCards(next);
    await persist({ cards: next });
  }

  async function commitHouseholdSize() {
    const n = Number(householdDraft);
    const valid = householdDraft !== "" && Number.isInteger(n) && n >= 1 && n <= 20;
    const next = valid ? n : null;
    setHouseholdDraft(next != null ? String(next) : "");
    if (next === householdSize) return;
    setHouseholdSize(next);
    await persist({ householdSize: next });
  }

  async function changeTemplateAndSave(next: FileSelection) {
    setTemplate(next);
    await persist({ template: next });
  }

  async function addMember() {
    const email = memberEmail.trim().toLowerCase();
    if (!email || familyMutationLock.current) return;
    familyMutationLock.current = true;
    setAddingMember(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: memberRole }),
      });
      const json = (await res.json()) as FamilyResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const known = members.some((m) => m.email === email);
      setMembers(json.members ?? []);
      setMemberEmail("");
      toast.success(known ? "ההרשאה עודכנה" : "בן המשפחה נוסף");
      if (json.sharing?.some((s) => !s.ok)) {
        toast.warning("חלק מהשיתופים ב-Drive נכשלו");
      }
    } catch {
      toast.error("הוספת בן המשפחה נכשלה");
    } finally {
      setAddingMember(false);
      familyMutationLock.current = false;
    }
  }

  async function removeMember(email: string) {
    if (familyMutationLock.current) return;
    familyMutationLock.current = true;
    setBusyMemberEmail(email);
    try {
      const res = await fetch("/api/family", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as FamilyResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMembers(json.members ?? []);
      if (editingMemberEmail === email) {
        setEditingMemberEmail(null);
        setEditingMemberRole(null);
      }
      toast.success("בן המשפחה הוסר");
    } catch {
      toast.error("הסרת בן המשפחה נכשלה");
    } finally {
      setBusyMemberEmail(null);
      familyMutationLock.current = false;
    }
  }

  function startEditingMember(member: FamilyMember) {
    if (familyMutationLock.current) return;
    setEditingMemberEmail(member.email);
    setEditingMemberRole(member.role);
  }

  function cancelEditingMember() {
    setEditingMemberEmail(null);
    setEditingMemberRole(null);
  }

  async function saveMemberRole(member: FamilyMember) {
    const role = editingMemberRole;
    if (!role || role === member.role || familyMutationLock.current) return;
    familyMutationLock.current = true;
    setBusyMemberEmail(member.email);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: member.email, role }),
      });
      const json = (await res.json()) as FamilyResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMembers(json.members ?? []);
      setEditingMemberEmail(null);
      setEditingMemberRole(null);
      toast.success("ההרשאה עודכנה");
      if (json.sharing?.some((s) => !s.ok)) {
        toast.warning("חלק מהשיתופים ב-Drive נכשלו");
      }
    } catch {
      toast.error("עדכון ההרשאה נכשל");
    } finally {
      setBusyMemberEmail(null);
      familyMutationLock.current = false;
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label htmlFor="card-input" className="text-base font-semibold">
          4 ספרות אחרונות של כרטיסי האשראי שלך
        </Label>
        <p className="text-sm text-muted-foreground">
          קבלות שמחויבות באחד מהכרטיסים הללו יסווגו כ&quot;אשראי&quot;. כרטיסים אחרים יסווגו כ&quot;מזומן&quot;.
        </p>

        {cards.length === 0 ? (
          <p className="text-sm border border-dashed border-border p-3">
            ללא כרטיסים מוגדרים — כל חיוב באשראי יסווג כ&quot;אשראי&quot; לפי הקבלה.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {cards.map((c) => (
              <li key={c}>
                <Badge
                  variant="secondary"
                  className="border border-border bg-muted px-3 py-1 text-sm font-normal tracking-normal normal-case gap-1.5"
                >
                  <span className="font-mono">★{c}</span>
                  <button
                    type="button"
                    onClick={() => removeAndSave(c)}
                    disabled={saving}
                    aria-label={`הסר ${c}`}
                    className="text-muted-foreground hover:text-destructive leading-none disabled:opacity-50"
                  >
                    ×
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 items-start">
          <div className="flex-1 space-y-1">
            <Input
              id="card-input"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.replace(/\D/g, "").slice(0, 4));
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addAndSave(); }
              }}
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              aria-invalid={!!draftError}
              className="font-mono"
            />
            {draftError && <p className="text-xs text-destructive">{draftError}</p>}
          </div>
          <Button onClick={addAndSave} variant="outline" disabled={!draft || saving}>
            {saving && <Loader2 className="animate-spin size-4 me-2" />}
            הוסף
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Label htmlFor="household-size-input" className="text-base font-semibold">
          מס&apos; נפשות בבית
        </Label>
        <p className="text-sm text-muted-foreground">
          מספר הנפשות שיירשם בשורת &quot;כלכלה (מזון)&quot; בדוח.
        </p>
        <Input
          id="household-size-input"
          value={householdDraft}
          onChange={(e) => setHouseholdDraft(e.target.value.replace(/\D/g, "").slice(0, 2))}
          onBlur={commitHouseholdSize}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitHouseholdSize(); }
          }}
          inputMode="numeric"
          placeholder="3"
          disabled={saving}
          className="w-24 font-mono"
        />
      </div>

      <div className="space-y-3">
        <Label className="text-base font-semibold">
          תבנית הדוח הדו-חודשי
        </Label>
        <p className="text-sm text-muted-foreground">
          קובץ התבנית שממנו יופק הדוח. ברירת מחדל: התבנית המובנית.
        </p>
        <DriveFilePicker value={template} onChange={changeTemplateAndSave} disabled={saving} />
      </div>

      {isOwner && (
        <div className="space-y-3">
          <Label htmlFor="member-email" className="text-base font-semibold">
            בני משפחה
          </Label>
          <p className="text-sm text-muted-foreground">
            בני משפחה שהוספת יוכלו להיכנס עם חשבון Google שלהם ולעבוד על החשבון
            הזה לפי ההרשאה שתיתן.
          </p>

          {members.length > 0 && (
            <ul className="divide-y divide-border border-y border-border">
              {members.map((member) => {
                const isEditing = editingMemberEmail === member.email;
                const isBusy = busyMemberEmail === member.email;
                const roleChanged =
                  isEditing &&
                  editingMemberRole !== null &&
                  editingMemberRole !== member.role;

                return (
                  <li
                    key={member.email}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && isEditing && !isBusy) {
                        cancelEditingMember();
                      }
                    }}
                    className="grid min-w-0 grid-cols-1 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_auto] sm:items-center sm:gap-3"
                  >
                    <span dir="ltr" className="min-w-0 truncate text-sm font-medium">
                      {member.email}
                    </span>

                    {isEditing ? (
                      <Select
                        value={editingMemberRole ?? member.role}
                        onValueChange={(value) =>
                          setEditingMemberRole(value as FamilyRole)
                        }
                        disabled={isFamilyMutating}
                      >
                        <SelectTrigger
                          className="w-full sm:min-w-44"
                          aria-label={`עריכת ההרשאה של ${member.email}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FAMILY_ROLE_VALUES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {roleLabel(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {roleLabel(member.role)}
                      </span>
                    )}

                    <div className="flex items-center justify-end gap-1 sm:justify-start">
                      {isEditing ? (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            onClick={() => void saveMemberRole(member)}
                            disabled={!roleChanged || isFamilyMutating}
                            aria-label={`שמירת ההרשאה של ${member.email}`}
                          >
                            {isBusy ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={cancelEditingMember}
                            disabled={isFamilyMutating}
                            aria-label={`ביטול עריכת ההרשאה של ${member.email}`}
                          >
                            <X className="size-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditingMember(member)}
                            disabled={isFamilyMutating}
                            aria-label={`עריכת ההרשאה של ${member.email}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void removeMember(member.email)}
                            disabled={isFamilyMutating}
                            aria-label={`הסרה ${member.email}`}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            {isBusy ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-2 items-stretch sm:flex-row sm:items-start">
            <Input
              id="member-email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addMember(); }
              }}
              type="email"
              inputMode="email"
              placeholder="כתובת אימייל"
              disabled={isFamilyMutating}
              dir="ltr"
              className="w-full sm:flex-1"
            />
            <Select
              value={memberRole}
              onValueChange={(value) => setMemberRole(value as FamilyRole)}
              disabled={isFamilyMutating}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="הרשאה">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FAMILY_ROLE_VALUES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={addMember}
              variant="outline"
              disabled={!memberEmail || isFamilyMutating}
              className="w-full sm:w-auto"
            >
              {addingMember && <Loader2 className="me-2 size-4 animate-spin" />}
              הוספה
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
