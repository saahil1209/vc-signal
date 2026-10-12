// Exa search: three queries per VC over the signal window, deduped by canonical URL.

import { fetchWithRetry } from "./http.ts";
import { canonicalUrl } from "./verify.ts";
import type { Doc } from "./verify.ts";

const EXA_URL = "https://api.exa.ai/search";
const RESULTS_PER_QUERY = 6;
const TEXT_CHARS = 4000;

type ExaResult = {
  url: string;
  title?: string | null;
  publishedDate?: string | null;
  text?: string | null;
};

export function vcQueries(vcName: string, firm: string): string[] {
  return [
    `"${vcName}" "${firm}"`,
    `"${firm}" logistics supply chain freight warehousing investment`,
    `"${vcName}" podcast interview panel conference keynote`,
  ];
}

async function exaSearch(apiKey: string, query: string, startIso: string, endIso: string): Promise<ExaResult[]> {
  const res = await fetchWithRetry(
    EXA_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: RESULTS_PER_QUERY,
        startPublishedDate: `${startIso}T00:00:00.000Z`,
        endPublishedDate: `${endIso}T23:59:59.999Z`,
        contents: { text: { maxCharacters: TEXT_CHARS } },
      }),
    },
    { label: "Exa search", timeoutMs: 30_000 },
  );
  const json = (await res.json()) as { results?: ExaResult[] };
  return json.results ?? [];
}

/** Any query failing (after retries) fails the whole gather: a failed search is not silence. */
export async function gatherDocs(
  apiKey: string,
  vc: { vc_name: string; firm: string },
  startIso: string,
  runDate: string,
): Promise<{ docs: Doc[]; requests: number }> {
  const queries = vcQueries(vc.vc_name, vc.firm);
  const results = await Promise.all(queries.map((q) => exaSearch(apiKey, q, startIso, runDate)));

  const seen = new Set<string>();
  const docs: Doc[] = [];
  for (const r of results.flat()) {
    if (!r.url || !r.text?.trim()) continue;
    const key = canonicalUrl(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push({
      id: `d${docs.length + 1}`,
      url: r.url,
      title: r.title ?? "",
      publishedDate: r.publishedDate ? r.publishedDate.slice(0, 10) : null,
      text: r.text.slice(0, TEXT_CHARS),
    });
  }
  return { docs, requests: queries.length };
}
