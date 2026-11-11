# Direct settlement report-period boundary

The bank settlement aggregate, its latest date and its foreign-currency matching pool must describe the selected report year and two months. Currently bank direct-card settlements are consumed before the period filter. Uploaded bank statements can include neighboring-month rows, which inflate the comparison total despite card detail being correctly filtered.

Apply a year-and-month gate within the bank settlement branch in lib/report/reconcile.ts before all three mutations. Preserve the existing settlement-date attribution of card details and salary timing. A prior-month purchase paid in the report period remains eligible. A report-month purchase paid after the period stays outside the report.

Verify with anonymous boundary cases and read-only reconciliation of the user's already-authorized source files. Check typecheck, lint and build. The user reprocesses the report and confirms the visible checksum before code commit. Real financial data and local source paths must stay out of repository artifacts.
