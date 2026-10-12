// Code-side verification of what the model proposes. Nothing is kept on the
// model's word alone: the quote must be on the fetched page, the date inside the window.

import { inWindow, parseIsoDate } from "./window.ts";

export type Doc = {
  id: string;
  url: string;
  title: string;
  publishedDate: string | null;
  text: string;
};

export const SIGNAL_TYPES = ["invested", "wrote", "spoke", "event", "other"] as const;
export const SCOPES = ["person", "firm"] as const;
export const RELEVANCES = ["high", "medium", "low"] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];
export type Scope = (typeof SCOPES)[number];
export type Relevance = (typeof RELEVANCES)[number];

export type RawSignal = {
  doc_id: string;
  url: string;
  date: string;
  type: string;
  scope: string;
  relevance: string;
  identity_match: string;
  title: string;
  one_line: string;
  evidence_quote: string;
};

export type VerifiedSignal = {
  url: string;
  signal_date: string;
  type: SignalType;
  scope: Scope;
  relevance: Relevance;
  title: string;
  one_line: string;
  evidence_quote: string;
};

export type Dropped = { signal: RawSignal; reason: string };

/** Lowercase, unify curly quotes/dashes/ellipses, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips wrapping quote marks and leading/trailing ellipses the model may add. */
function normalizeQuote(q: string): string {
  return normalizeText(q)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^(\.\.\.\s*)+|(\s*\.\.\.)+$/g, "")
    .trim();
}

/** Canonical URL for dedupe and matching: no scheme/www/hash/tracking params/trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_)/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${query}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

// "high" relevance must be visible in the signal's own words, whatever the model said.
const LOGISTICS_TERMS =
  /\b(logistics?|supply[- ]chains?|freight|fleets?|truck\w*|warehous\w*|procurement|shipping|shippers?|3pl|fulfil+ment|last[- ]mile|cargo|customs|cross[- ]border trade|trade tech|inventory|couriers?|mid[- ]mile|drayage|ltl|ftl)\b/i;
const NOT_GROUND_LOGISTICS = /\b(orbital|space|in-space)\s+(logistics|transport\w*|delivery)\b/gi;
// "medium" (adjacent B2B) must likewise be visible in the signal's own words.
const ADJACENT_TERMS =
  /\b(b2b|saas|enterprise|industrial\w*|manufactur\w*|mobility|vertical software|marketplaces?|e-?commerce|quick[- ]commerce|commerce|operations|automation|robot\w*|electric vehicles?|evs?|retail tech|construction tech|agri\w*|energy|infrastructure)\b/i;

export function capRelevance(s: { relevance: Relevance; title: string; one_line: string; evidence_quote: string }): Relevance {
  if (s.relevance === "low") return "low";
  const text = `${s.title} ${s.one_line} ${s.evidence_quote}`.replace(NOT_GROUND_LOGISTICS, " ");
  if (LOGISTICS_TERMS.test(text)) return s.relevance;
  return ADJACENT_TERMS.test(text) ? "medium" : "low";
}

export function quoteInDoc(quote: string, doc: Doc): boolean {
  const q = normalizeQuote(quote);
  if (q.length < 8) return false;
  return normalizeText(doc.text).includes(q) || normalizeText(doc.title).includes(q);
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** Keeps only signals that pass every check; one per URL. */
export function verifySignals(
  raw: RawSignal[],
  docs: Doc[],
  windowStartIso: string,
  runDateIso: string,
): { kept: VerifiedSignal[]; dropped: Dropped[] } {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const kept: VerifiedSignal[] = [];
  const dropped: Dropped[] = [];
  const seenUrls = new Set<string>();

  for (const s of raw) {
    const doc = byId.get(s.doc_id);
    let reason: string | null = null;
    if (!doc) reason = "doc_id not in gathered set";
    else if (canonicalUrl(s.url ?? "") !== canonicalUrl(doc.url)) reason = "url does not match its document";
    else if (!quoteInDoc(s.evidence_quote ?? "", doc)) reason = "evidence_quote not found in document";
    else if (!parseIsoDate(s.date)) reason = "date missing or unparseable";
    else if (!inWindow(s.date, windowStartIso, runDateIso)) reason = "date outside window";
    else if (s.identity_match !== "confirmed") reason = "identity not confirmed";
    else if (!oneOf(s.type, SIGNAL_TYPES) || !oneOf(s.scope, SCOPES) || !oneOf(s.relevance, RELEVANCES)) {
      reason = "invalid type, scope or relevance";
    } else if (!s.one_line?.trim()) reason = "missing one_line";
    else if (seenUrls.has(canonicalUrl(doc.url))) reason = "duplicate url";

    if (reason || !doc) {
      dropped.push({ signal: s, reason: reason ?? "doc_id not in gathered set" });
      continue;
    }
    seenUrls.add(canonicalUrl(doc.url));
    const signal = {
      url: doc.url,
      signal_date: parseIsoDate(s.date)!,
      type: s.type as SignalType,
      scope: s.scope as Scope,
      relevance: s.relevance as Relevance,
      title: (s.title || doc.title).trim(),
      one_line: s.one_line.trim(),
      evidence_quote: s.evidence_quote.trim(),
    };
    kept.push({ ...signal, relevance: capRelevance(signal) });
  }
  return { kept, dropped };
}
