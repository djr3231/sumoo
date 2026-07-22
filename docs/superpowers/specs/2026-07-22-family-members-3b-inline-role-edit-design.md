# Family Members — Plan 3b: Inline Role Editing

- **Date:** 2026-07-22
- **Branch:** `feat/family-members`
- **Status:** Approved design
- **Parent spec:** `docs/superpowers/specs/2026-07-19-family-members-3-management-sharing-design.md`

## 1. Problem

The current family-members UI represents members as compact badges. Updating an
existing member requires re-entering their email in the add form, selecting a new
role, and submitting the member again. The API supports this upsert correctly, but
the UI makes an edit look like an overwrite through the add flow.

## 2. Goal and scope

Give every existing member an explicit, clean inline-edit flow while preserving the
separate add-member form.

This is a UI-only follow-up. `POST /api/family` already updates an existing member by
email and returns the updated member list plus Drive-sharing results. No API, storage,
role, or Drive-permission behavior changes.

## 3. Interaction design

Each member row has three states:

### 3.1 View

- Email rendered as isolated LTR content with truncation.
- Role rendered as presentation text through the existing `roleLabel()` helper.
- A ghost pencil icon enters edit mode.
- The existing remove action becomes a ghost destructive trash icon.

### 3.2 Edit

- Only one member can be edited at a time.
- The role text is replaced inline by the existing shadcn `Select`, initialized to
  the member's current role.
- The pencil icon is replaced by a save icon.
- A ghost cancel icon appears beside save.
- Save is disabled until the draft differs from the stored role.
- Cancel or `Escape` discards the draft and restores view mode.
- Starting an edit on another member discards the previous unsaved draft.

### 3.3 Saving

- Save calls `POST /api/family` with the existing email and draft role.
- The active row stays in edit mode and its save icon becomes a spinner while the
  request runs.
- On success, the returned member list replaces local state and the row returns to
  view mode.
- A partial Drive-sharing result keeps the successful role update and displays the
  existing Drive-sharing warning toast.
- On failure, the row remains open with its draft intact and an update-specific error
  toast is shown.

## 4. Layout and accessibility

- Replace badge chips with quiet list rows separated by the existing border token.
- Desktop: email, role/edit control, and actions share one row.
- Mobile: email and controls stack without horizontal scrolling; icon buttons remain
  40×40 px touch targets.
- Use installed shadcn primitives and Lucide icons only: `Pencil`, `Check`, `X`, and
  `Trash2`. No dependency or primitive is added.
- Every icon-only button has an email-specific `aria-label`.
- Buttons keep visible focus states supplied by the existing shadcn `Button`.
- Theme tokens, square corners, RTL logical utilities, and all other
  `DESIGN-SYSTEM.md` rules remain unchanged.

## 5. State and concurrency

`SettingsForm` gains an edit target and role draft. Update, add, and remove requests
retain separate busy identities so the row responsible for the request shows the
correct state. The UI does not optimistically mutate the member list; server responses
remain the source of truth.

## 6. Approved Hebrew strings

Visible role labels and existing add/remove toasts remain unchanged. The only approved
new presentation strings are:

- `עריכת ההרשאה של {email}` — pencil button accessible label.
- `שמירת ההרשאה של {email}` — save button accessible label.
- `ביטול עריכת ההרשאה של {email}` — cancel button accessible label.
- `עדכון ההרשאה נכשל` — update failure toast.

## 7. Verification

- Typecheck and lint (accepted pre-existing `UploadZone.tsx:138` lint finding).
- Production build at the batch gate.
- User E2E on desktop and mobile:
  1. View mode shows role text, not a disabled select.
  2. Pencil opens exactly one row and preserves the current role.
  3. Cancel and `Escape` restore the original value without an API request.
  4. Save persists a changed role and returns to view mode.
  5. A failed update preserves the draft and edit mode.
  6. Adding and removing members continue to work.

