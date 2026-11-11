# OpenAI financial document extraction

Route receipt images and PDFs, bank/card statements, salary slips and direct-charge statements to gpt-6.1-sol. Route store normalization, duplicate/pair detection and expense categorization to gpt-6-luna. The four document tasks prioritize numeric and row fidelity. The three text tasks prioritize cost.

Use the server-side Responses API with native Fetch, OPENAI_API_KEY, inline image or PDF input, store: false, and strict JSON Schema. Native Fetch fits the single endpoint and the existing bounded retry policy. Never log document bytes, response bodies, prompts or keys. Preserve existing public function signatures, enum sources, date normalization, anonymization rules and printed-evidence instructions. Preserve temporary-overload handling for imports. Reject incomplete or refused responses before downstream writes.

Acceptance requires static checks, then a user check on representative Hebrew documents and text operations against expected amounts, dates, nullable fields and groupings. Deployment needs the OpenAI project key and model access.
