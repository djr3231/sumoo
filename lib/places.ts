// Google Places API (New) — Text Search.
// Used to verify / clean up noisy OCR'd Israeli store names after LLM
// canonicalization. Returns null silently when the API key isn't configured,
// so callers can treat it as a best-effort enrichment step.

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export async function resolveStoreName(query: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  if (!query || query.trim().length < 2) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "iw",
        regionCode: "IL",
        maxResultCount: 1,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: Array<{ displayName?: { text?: string } }>;
    };
    const text = data.places?.[0]?.displayName?.text;
    return text && text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

// Heuristic: should we bother sending this canonical name to Places?
// Triggers on OCR-artifact markers commonly seen on Israeli receipts.
export function looksUnresolved(name: string): boolean {
  if (!name) return false;
  return (
    /[א-ת]\.[א-ת]\./.test(name) ||      // proprietor abbreviations: ג.מ., ד.נ., א.מ.
    /\(0\d\)/.test(name) ||              // district codes like (07), (03)
    /בע"מ|ע"מ|ב\.ו\./.test(name) ||      // legal suffixes
    /\d{4,}/.test(name)                   // long digit sequences
  );
}
