# OpenAI API implementation plan

Branch: feat/openai-api. Base: a8169d51328bde35a5b57c3c016daa63bb72b05c.
Spec: ../specs/2026-11-11-openai-api-design.md. Execute using subagent-driven development.

- [x] Implement a private server transport in lib/openai-responses.ts. Accept a model ID, instructions, strict schema, text and optional typed base64 attachment. Bound retries and request duration, protect sensitive data, reject incomplete/refusal/error output. Verify request and output shape against official documentation.
- [x] Migrate the seven lib/ai.ts callers and schemas. Remove the unused Gemini dependency from the manifests. Verify four document and three text operations, strict nested schemas, nullable values and preservation of domain transformations.
- [x] Align active configuration, setup documentation, provider labels and error mapping with the new service. Preserve existing UI language except the literal provider name.
- [x] Review combined diff, run typecheck, lint and build. Inspect the remaining references and record evidence.
- [ ] User verifies receipt image/PDF, statement, salary slip, direct charges, canonicalization, duplicates and expense classification. Check a legible amount, an unreadable field and debit sign against the source. Confirm user-facing behavior before committing the runtime change.

Static handoff: typecheck passed; production build generated 33/33 pages. Lint over the project excluding nested worktrees reports only the accepted UploadZone.tsx:93 finding. Review confirmed seven strict schemas and the 75/90-second deduplication fallback budgets. Live project access and extraction accuracy await user verification.

Follow-up: the local project's model list includes both configured IDs. A synthetic PDF reproduced HTTP 400 invalid_json_schema because the Hebrew Lawyer label contains a double quote. Both affected schemas now send the category keys and decode them to the original labels. Live synthetic requests to Sol and Luna both completed with HTTP 200, mapped Lawyer back to the original label, and the PDF yielded the expected 12.34 total. User verification through the upload UI remains open.

Release authorization: on 2026-11-12 the user explicitly approved committing and pushing all session changes through dev. Earlier user feedback confirmed the new model's results. Synthetic API requests verified both quote-safe category schemas. The full user E2E matrix above remains incomplete; authorization is not recorded as verification of those unchecked cases.
