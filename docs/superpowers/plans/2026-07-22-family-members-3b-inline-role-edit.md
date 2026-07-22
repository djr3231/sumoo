# Family Members — Plan 3b: Inline Role Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the family-member badge list with clean rows that expose an explicit pencil → inline Select → save/cancel role-edit flow.

**Architecture:** This is a client-only change in `SettingsForm.tsx`. The existing `POST /api/family` upsert remains the sole mutation boundary; local state tracks one edit target, one role draft, an add request, and the member email currently being mutated. Server responses replace the member list—no optimistic update and no API change.

**Tech Stack:** React 19 client component state, TypeScript strict, existing shadcn `Button`/`Select`, existing Lucide React icons, Sonner toasts.

**Spec:** `docs/superpowers/specs/2026-07-22-family-members-3b-inline-role-edit-design.md`
**Branch:** `feat/family-members` — **Base commit:** `ee58ce7`

## Global Constraints

- Modify only `components/SettingsForm.tsx`; no API, data model, dependency, or generated primitive changes.
- Use only installed shadcn primitives and Lucide icons: `Pencil`, `Check`, `X`, `Trash2`, `Loader2`.
- Icon-only buttons use the existing `Button size="icon"` 40×40 px touch target and email-specific `aria-label` values.
- Square corners, existing theme tokens, mobile-first layout, RTL logical utilities, and bidi-isolated emails are mandatory.
- Only one member can be edited at a time; starting another edit discards the previous unsaved draft.
- The only new Hebrew strings are the four strings approved in the spec §6. Do not add any other Hebrew copy.
- No visual verification or dev server. Verify with typecheck + lint; accepted pre-existing lint finding: `components/UploadZone.tsx:138`. Run build once at the batch gate.
- The implementer does not commit. The orchestrator reviews the report and diff, reruns verification, and commits.

---

### Task 1: Inline family-role editing in `SettingsForm`

**Files:**
- Modify: `components/SettingsForm.tsx`

**Interfaces:**
- Consumes: `FamilyMember`, `FamilyRole`, `FAMILY_ROLE_VALUES`, `roleLabel()`, and existing `POST /api/family` response type `FamilyResponse`.
- Produces: explicit view/edit/saving UI states for every member row; no exported interface changes.

- [ ] **Step 1: Update imports and family state**

Remove the unused `Badge` import. Replace the Lucide import and the four current family state declarations with:

```tsx
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
```

```tsx
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<FamilyRole>(FAMILY_ROLE.UploadView);
  const [addingMember, setAddingMember] = useState(false);
  const [busyMemberEmail, setBusyMemberEmail] = useState<string | null>(null);
  const [editingMemberEmail, setEditingMemberEmail] = useState<string | null>(null);
  const [editingMemberRole, setEditingMemberRole] = useState<FamilyRole | null>(null);
```

- [ ] **Step 2: Separate add/remove busy state and add edit handlers**

Change `addMember()` to use `addingMember` instead of `familyBusy`. Existing success, sharing-warning, and failure strings stay unchanged:

```tsx
  async function addMember() {
    const email = memberEmail.trim().toLowerCase();
    if (!email) return;
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
    }
  }
```

Change `removeMember()` to use the target email as its busy identity:

```tsx
  async function removeMember(email: string) {
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
    }
  }
```

Append the edit-state functions after `removeMember()`:

```tsx
  function startEditingMember(member: FamilyMember) {
    setEditingMemberEmail(member.email);
    setEditingMemberRole(member.role);
  }

  function cancelEditingMember() {
    setEditingMemberEmail(null);
    setEditingMemberRole(null);
  }

  async function saveMemberRole(member: FamilyMember) {
    const role = editingMemberRole;
    if (!role || role === member.role) return;
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
    }
  }
```

- [ ] **Step 3: Replace member badges with responsive inline-edit rows**

Replace the current `members.length > 0` block with:

```tsx
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
                        disabled={isBusy}
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
                            disabled={!roleChanged || isBusy}
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
                            disabled={isBusy}
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
                            disabled={busyMemberEmail !== null}
                            aria-label={`עריכת ההרשאה של ${member.email}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void removeMember(member.email)}
                            disabled={busyMemberEmail !== null}
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
```

This keeps the role as text in view mode, gives the active row a real Select, and keeps all controls on the theme's 40px icon-button target.

- [ ] **Step 4: Update the separate add form busy state**

In the add-member form, replace all three `familyBusy` references with `addingMember`. The resulting controls must be:

```tsx
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
              disabled={addingMember}
              dir="ltr"
              className="w-full sm:flex-1"
            />
```

```tsx
            <Select
              value={memberRole}
              onValueChange={(value) => setMemberRole(value as FamilyRole)}
              disabled={addingMember}
            >
```

```tsx
            <Button
              onClick={addMember}
              variant="outline"
              disabled={!memberEmail || addingMember}
              className="w-full sm:w-auto"
            >
              {addingMember && <Loader2 className="me-2 size-4 animate-spin" />}
              הוספה
            </Button>
```

- [ ] **Step 5: Verify the task**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
```

Expected: exit 0.

Run:

```powershell
.\node_modules\.bin\eslint.cmd .
```

Expected: only the accepted pre-existing `components/UploadZone.tsx:138` finding.

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Commit (orchestrator only)**

```powershell
git add components/SettingsForm.tsx
git commit -m "feat(family): add inline role editing"
```

---

### Task 2: Batch gate

**Files:** none — verification only.

- [ ] **Step 1: Production build**

Run:

```powershell
.\node_modules\.bin\next.cmd build
```

Expected: success; `/api/family` remains in the route list.

- [ ] **Step 2: Final typecheck, lint, and scope audit**

Run the Task 1 typecheck and lint commands again. Then run:

```powershell
git diff ee58ce7..HEAD --name-only
```

Expected production-code output: only `components/SettingsForm.tsx` (plus this committed plan document).

- [ ] **Step 3: User E2E handoff**

Hand off the six scenarios from the spec §7. Do not start the dev server or attempt visual verification.

