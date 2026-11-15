# Receipt Matching Pool Loading

Approved in chat on 2026-11-15. This is a focused wizard-state correction.

## Problem and intent

Entering or resuming the matching step restores expense attachments but not the
receipt pool. The only pool loader also runs automatic matching. Consequently,
detaching a receipt after resume cannot restore it to the unmatched list until
another automatic run, which may consume it before the user can split it.

## Approach

Load the pool from the existing report-receipts GET when entering the matching
step, without attaching receipts. Reconstruct available receipts from the latest
expense/attachment decisions, retaining explicitly available split receipts on
subsequent loads. Keep automatic matching behind its existing button.

Loading by automatically running the matcher was rejected because it recreates
the reported problem. Persisting complete receipt snapshots was rejected because
it duplicates live receipt data and expands the progress contract unnecessarily.

## Behavior and constraints

- New and resumed reports expose available receipts after the read completes,
  even before the first automatic match.
- Existing attachments, dismissals, manual edits, and split behavior remain intact.
- Detach waits for a successful pool load and returns the receipt immediately.
- Stale reads cannot apply after leaving the step or changing/reprocessing a period.
- A manual match supersedes an outstanding read-only pool request.
- Load failures use the existing error display; the existing match button can retry.
- No API/schema/model/matching-algorithm changes, dependencies, or new Hebrew copy.
- Reuse existing `טוען…` for pool loading and existing matching copy for matching.
- No personal receipt details are stored in this spec or plan.
- Per repository instructions, use static checks and user runtime verification;
  do not add automated tests or start/visually verify the app.

## User verification

Enter a fresh matching step and confirm receipts appear without attachments being
created. Resume a saved report, detach an attached receipt, and confirm it appears
in the available list without clicking Match. Manually split that receipt across
the intended lines, then verify the explicit Match button still handles other
receipts and preserves the manual decisions.
