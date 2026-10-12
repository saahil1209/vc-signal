// Deterministic scoring and the four signal columns. No AI here.

import { daysBetween, windowStart } from "./window.ts";
import type { Relevance, Scope, SignalType } from "./verify.ts";

export const WAITING = "Waiting for response";
export const YET_TO_REACH_OUT = "Yet to reach out";
export const ACT_THRESHOLD = 20;
export const HOLD_DAYS = 10;

// event/high is 30 (not 25) so a single high-relevance personal event 15-30 days
// old still clears 20 (25 * 0.7 = 17.5 would not), per the calibration rule.
const BASE: Record<SignalType, Record<Relevance, number>> = {
  invested: { high: 40, medium: 25, low: 5 },
  wrote: { high: 30, medium: 18, low: 5 },
  spoke: { high: 30, medium: 18, low: 5 },
  event: { high: 30, medium: 15, low: 5 },
  other: { high: 10, medium: 6, low: 2 },
};

export type StoredSignal = {
  signal_date: string;
  type: SignalType;
  scope: Scope;
  relevance: Relevance;
  one_line: string;
  url: string;
};

export type Counted = StoredSignal & { base: number; recency: number; scope_factor: number; points: number };

export function recencyFactor(ageDays: number): number {
  if (ageDays < 0) return 0;
  if (ageDays <= 7) return 1.0;
  if (ageDays <= 14) return 0.85;
  if (ageDays <= 30) return 0.7;
  return 0;
}

export function weigh(s: StoredSignal, runDate: string): Counted {
  const base = BASE[s.type][s.relevance];
  const recency = recencyFactor(daysBetween(s.signal_date, runDate));
  const scope_factor = s.scope === "firm" ? 0.6 : 1;
  return { ...s, base, recency, scope_factor, points: base * recency * scope_factor };
}

/** Collapse same-type signals within 3 days (keep highest), sum the top 3, cap at 100. */
export function scoreSignals(signals: StoredSignal[], runDate: string): { score: number; counted: Counted[] } {
  const weighed = signals
    .map((s) => weigh(s, runDate))
    .filter((s) => s.points > 0)
    .sort((a, b) => b.points - a.points || b.signal_date.localeCompare(a.signal_date));

  const kept: Counted[] = [];
  for (const s of weighed) {
    const dup = kept.some((k) => k.type === s.type && Math.abs(daysBetween(k.signal_date, s.signal_date)) <= 3);
    if (!dup) kept.push(s);
  }
  const counted = kept.slice(0, 3);
  const score = Math.min(100, Math.round(counted.reduce((sum, s) => sum + s.points, 0)));
  return { score, counted };
}

export type VcState = { status: string; last_contact_date: string | null };

/** recommended_action; rule 1 (research failed) is handled by the caller not writing at all. */
export function recommend(vc: VcState, score: number, top: Counted | undefined, runDate: string): string {
  if (vc.status !== WAITING && vc.status !== YET_TO_REACH_OUT) {
    throw new Error(`Unknown status "${vc.status}"`);
  }
  const contactedDaysAgo = vc.last_contact_date ? daysBetween(vc.last_contact_date, runDate) : null;

  if (vc.status === WAITING && contactedDaysAgo !== null && contactedDaysAgo <= HOLD_DAYS) {
    const base = `Hold: reply window open (contacted ${contactedDaysAgo} days ago).`;
    return score >= ACT_THRESHOLD && top ? `${base} Save for follow-up: ${top.one_line}` : base;
  }
  if (score === 0) return "Deprioritise: no verified signal in the last 30 days.";
  if (score >= ACT_THRESHOLD && top && vc.status === YET_TO_REACH_OUT) {
    return `Reach out this week. Open with: ${top.one_line} (${top.signal_date})`;
  }
  if (score >= ACT_THRESHOLD && top && vc.status === WAITING) {
    return `Follow up this week. Reference: ${top.one_line} (${top.signal_date})`;
  }
  return "Low priority: monitor";
}

export function buildSummary(counted: Counted[], runDate: string): string {
  if (counted.length === 0) return `No verified signal in the 30 days to ${runDate}.`;
  return counted
    .slice(0, 2)
    .map((s) => `${s.signal_date} · ${s.one_line} · ${s.url}`)
    .join("\n");
}

export type SignalUpdate = {
  id: string;
  last_signal_date: string | null;
  signal_summary: string;
  follow_up_score: number;
  recommended_action: string;
};

/** The four columns for one VC, from every stored signal in the current window. */
export function buildUpdate(
  vc: VcState & { id: string },
  signals: StoredSignal[],
  runDate: string,
): { update: SignalUpdate; outcome: "signal" | "quiet"; counted: Counted[] } {
  const start = windowStart(runDate);
  const inWin = signals.filter((s) => s.signal_date >= start && s.signal_date <= runDate);
  const { score, counted } = scoreSignals(inWin, runDate);
  const newest = inWin.reduce<string | null>((m, s) => (m === null || s.signal_date > m ? s.signal_date : m), null);
  return {
    update: {
      id: vc.id,
      last_signal_date: newest,
      signal_summary: buildSummary(counted, runDate),
      follow_up_score: score,
      recommended_action: recommend(vc, score, counted[0], runDate),
    },
    outcome: counted.length > 0 ? "signal" : "quiet",
    counted,
  };
}
