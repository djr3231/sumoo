import "server-only";
import { setTimeout as delay } from "node:timers/promises";

interface StructuredRequest {
  model: string;
  instructions: string;
  name: string;
  schema: object;
  text: string;
  attachment?: { data: string; mimeType: string };
}

export class OpenAIResponseError extends Error {
  constructor(message: string, readonly status: 429 | 500 | 503 = 500) {
    super(message);
    this.name = "OpenAIResponseError";
  }
}

function attachmentPart({ mimeType, data }: NonNullable<StructuredRequest["attachment"]>) {
  const dataUrl = `data:${mimeType};base64,${data}`;
  if (mimeType === "application/pdf") {
    return { type: "input_file", filename: "document.pdf", file_data: dataUrl, detail: "high" };
  }
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
    return { type: "input_image", image_url: dataUrl, detail: "high" };
  }
  throw new OpenAIResponseError("Unsupported document format.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOutput(response: unknown): string {
  const invalid = new OpenAIResponseError("OpenAI returned an invalid result.");
  if (!isRecord(response) || response.status !== "completed" || response.error ||
      response.incomplete_details || !Array.isArray(response.output)) {
    throw new OpenAIResponseError("OpenAI did not complete the request.");
  }

  const chunks: string[] = [];
  for (const item of response.output) {
    if (!isRecord(item)) throw invalid;
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.status !== "completed" ||
        item.role !== "assistant" || !Array.isArray(item.content)) throw invalid;
    for (const part of item.content) {
      if (!isRecord(part)) throw invalid;
      if (part.type === "refusal") throw new OpenAIResponseError("OpenAI declined the request.");
      if (part.type !== "output_text" || typeof part.text !== "string") throw invalid;
      if (item.phase !== "commentary") chunks.push(part.text);
    }
  }
  const text = chunks.join("");
  // Keep parser errors, which may quote the financial document, inside this boundary.
  try {
    if (!isRecord(JSON.parse(text))) throw invalid;
  } catch {
    throw invalid;
  }
  return text;
}

async function httpError(response: Response): Promise<OpenAIResponseError> {
  if (response.status === 429) {
    const body: unknown = await response.json().catch(() => null);
    if (isRecord(body) && isRecord(body.error) &&
        (body.error.code === "insufficient_quota" || body.error.type === "insufficient_quota")) {
      return new OpenAIResponseError("OpenAI quota is unavailable.");
    }
    return new OpenAIResponseError("OpenAI rate limit reached.", 429);
  }
  await response.body?.cancel();
  if (response.status === 503) return new OpenAIResponseError("OpenAI is temporarily unavailable.", 503);
  return new OpenAIResponseError("OpenAI could not process the request.");
}

function timeoutMs(args: StructuredRequest): number {
  // The dedup route skips slow phases at 75/90 s and saves deterministic matches.
  // Give its timer a head start, then abort the abandoned provider request.
  if (args.name === "canonical_stores") return 76_000;
  if (args.name === "duplicate_groups") return 91_000;
  if (args.attachment?.mimeType === "application/pdf" && args.name !== "receipt") return 95_000;
  // The receipt route also needs time for Drive and Sheets inside its 60 s limit.
  return 45_000;
}

export async function requestStructuredText(args: StructuredRequest): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIResponseError("OpenAI is not configured.");

  const textPart = { type: "input_text", text: args.text };
  const content = args.attachment ? [attachmentPart(args.attachment), textPart] : [textPart];
  const body = JSON.stringify({
    model: args.model,
    instructions: args.instructions,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: args.name, schema: args.schema, strict: true } },
    store: false,
  });
  const signal = AbortSignal.timeout(timeoutMs(args));
  try {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal,
        cache: "no-store",
        redirect: "error",
      });
      if (response.ok) {
        const result: unknown = await response.json().catch(() => null);
        return readOutput(result);
      }
      const error = await httpError(response);
      if (attempt >= 2 || error.status === 500) throw error;
      await delay(3_000, undefined, { signal });
    }
  } catch (error) {
    if (!signal.aborted && error instanceof OpenAIResponseError) throw error;
    throw new OpenAIResponseError("OpenAI is temporarily unavailable.", 503);
  }
}
