# Direct period filter implementation plan

Base: a8169d51328bde35a5b57c3c016daa63bb72b05c (dev).
Branch: feat/direct-period-filter.
Spec: ../specs/2026-11-11-direct-period-filter-design.md.

- [x] Read the live report and trace the parser and reconciliation. Reconcile the source files read-only to identify the actual mismatch.
- [x] Add a year-and-month guard before bank direct settlement aggregation, cutoff and FX-pool updates. Touch only lib/report/reconcile.ts.
- [x] Review the diff and verify boundary behavior, typecheck, lint and build. Add no test files or dependencies.
- [ ] User reprocesses the report. Expected: the bank/card gap becomes zero for the observed source set, while card details retain their settlement-month attribution.
- [x] Prepare the focused commit for publication through dev under the user's explicit authorization on 2026-11-12.

Ruling: the observed source set has real settlement dates for every imported card row. Missing-date and PDF evidence changes are separate work. This fix addresses the proven bank aggregate boundary defect.

The original checkout retains the pending OpenAI migration. The isolated worktree contains only this correction and its design/plan. A copy of the focused code patch may be applied to the original checkout for user verification.

Verification: the original checkout includes an identical preview of the six-line guard. Orchestrator typecheck and production build passed there; lint reports only the accepted UploadZone.tsx:93 issue after excluding nested worktrees. Read-only reconciliation of the authorized source set produced a zero gap without changing the card row count. Anonymous boundary checks and independent narrow review passed. The live app remains for user reprocessing. Commits require explicit approval after automatic review rejected the earlier documentation commit.

Release authorization: the user explicitly approved committing and pushing all session changes through dev on 2026-11-12. Reprocessing through the UI has not been separately confirmed. The runtime verification item remains open as a record of that gap.

Fresh release gate: typecheck passed in this isolated worktree. Lint reported only the accepted UploadZone.tsx:93 finding. The production build passed with the supported Webpack option because Turbopack rejects this worktree's local node_modules junction outside its root. The combined original checkout passed the default production build and typecheck with the identical guard.
