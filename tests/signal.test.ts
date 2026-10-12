// Run: node --test tests/   (Node 22.6+ strips TS types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import { inWindow, parseIsoDate, windowStart } from "../supabase/functions/signal-scan/window.ts";
import { canonicalUrl, verifySignals } from "../supabase/functions/signal-scan/verify.ts";
import type { Doc, RawSignal } from "../supabase/functions/signal-scan/verify.ts";
import { buildSummary, buildUpdate, recommend, scoreSignals, WAITING, YET_TO_REACH_OUT } from "../supabase/functions/signal-scan/score.ts";
import type { StoredSignal } from "../supabase/functions/signal-scan/score.ts";

const RUN = "2026-10-12";
const START = windowStart(RUN); // 2026-09-12

// ---------- window ----------
test("window: start is 30 days back", () => assert.equal(START, "2026-09-12"));
test("window: in-window dates", () => {
  assert.ok(inWindow("2026-10-12", START, RUN));
  assert.ok(inWindow("2026-09-12", START, RUN));
  assert.ok(inWindow("2026-10-01", START, RUN));
});
test("window: out-of-window and future dates", () => {
  assert.ok(!inWindow("2026-09-11", START, RUN));
  assert.ok(!inWindow("2026-10-13", START, RUN));
});
test("window: missing or unparseable dates", () => {
  assert.ok(!inWindow(null, START, RUN));
  assert.ok(!inWindow("", START, RUN));
  assert.ok(!inWindow("October 2026", START, RUN));
  assert.equal(parseIsoDate("2026-02-30"), null);
});

// ---------- verify ----------
const doc: Doc = {
  id: "d1",
  url: "https://www.example.com/post/?utm_source=x",
  title: "Why we invested in FreightCo",
  publishedDate: "2026-10-05",
  text: "Today we are thrilled to announce our seed investment in FreightCo,\n a  digital freight platform for mid-market shippers.",
};
const good: RawSignal = {
  doc_id: "d1", url: "https://example.com/post", date: "2026-10-05", type: "invested", scope: "person",
  relevance: "high", identity_match: "confirmed", title: "FreightCo seed", one_line: "Led seed round in FreightCo.",
  evidence_quote: "“our seed investment in FreightCo, a digital freight platform”",
};
const check = (s: Partial<RawSignal>) => verifySignals([{ ...good, ...s }], [doc], START, RUN);

test("verify: good signal kept (whitespace, case, curly quotes normalised)", () => {
  const { kept } = check({});
  assert.equal(kept.length, 1);
  assert.equal(kept[0].url, doc.url);
});
test("verify: quote not in document dropped", () => {
  assert.equal(check({ evidence_quote: "we doubled down on warehouse robotics" }).kept.length, 0);
});
test("verify: paraphrased quote dropped", () => {
  assert.equal(check({ evidence_quote: "our seed investment into FreightCo" }).kept.length, 0);
});
test("verify: uncertain identity dropped", () => {
  assert.equal(check({ identity_match: "uncertain" }).kept.length, 0);
});
test("verify: unknown doc_id or mismatched url dropped", () => {
  assert.equal(check({ doc_id: "d9" }).kept.length, 0);
  assert.equal(check({ url: "https://other.com/post" }).kept.length, 0);
});
test("verify: out-of-window, future, missing dates dropped", () => {
  assert.equal(check({ date: "2026-08-01" }).kept.length, 0);
  assert.equal(check({ date: "2026-10-20" }).kept.length, 0);
  assert.equal(check({ date: "" }).kept.length, 0);
});
test("verify: duplicate url kept once", () => {
  assert.equal(verifySignals([good, good], [doc], START, RUN).kept.length, 1);
});
test("canonicalUrl strips www, tracking params, trailing slash", () => {
  assert.equal(canonicalUrl("https://www.Example.com/a/?utm_source=x&id=2#top"), "example.com/a?id=2");
});

// ---------- score ----------
const sig = (o: Partial<StoredSignal>): StoredSignal => ({
  signal_date: "2026-10-10", type: "wrote", scope: "person", relevance: "high", one_line: "Wrote on freight tech.",
  url: "https://example.com/" + Math.random(), ...o,
});

test("calibration: one high personal signal anywhere in window clears 20 (every type)", () => {
  for (const type of ["invested", "wrote", "spoke", "event"] as const) {
    for (const date of ["2026-10-12", "2026-10-03", "2026-09-12"]) {
      const { score } = scoreSignals([sig({ type, signal_date: date })], RUN);
      assert.ok(score >= 20, `${type} on ${date} scored ${score}`);
    }
  }
});
test("calibration: low-relevance activity never clears 20", () => {
  const lows = ["invested", "wrote", "spoke", "event", "other"].flatMap((type, i) =>
    [0, 5, 10].map((d) => sig({ type: type as StoredSignal["type"], relevance: "low", signal_date: `2026-10-${String(12 - i - d).padStart(2, "0")}` }))
  );
  assert.ok(scoreSignals(lows, RUN).score < 20);
});
test("score: recency and firm scope multipliers", () => {
  assert.equal(scoreSignals([sig({ type: "invested", signal_date: "2026-10-10" })], RUN).score, 40);
  assert.equal(scoreSignals([sig({ type: "invested", signal_date: "2026-10-01" })], RUN).score, 34);
  assert.equal(scoreSignals([sig({ type: "invested", signal_date: "2026-09-20" })], RUN).score, 28);
  assert.equal(scoreSignals([sig({ type: "invested", scope: "firm", signal_date: "2026-10-10" })], RUN).score, 24);
});
test("score: same type within 3 days collapses to the highest", () => {
  const { score, counted } = scoreSignals([
    sig({ type: "spoke", signal_date: "2026-10-10" }),
    sig({ type: "spoke", signal_date: "2026-10-08", relevance: "medium" }),
  ], RUN);
  assert.equal(counted.length, 1);
  assert.equal(score, 30);
});
test("score: top 3 only, capped at 100", () => {
  const many = [1, 5, 9, 13].map((d) => sig({ type: "invested", signal_date: `2026-10-${String(12 - d).padStart(2, "0")}` }));
  const { score, counted } = scoreSignals(many, RUN);
  assert.equal(counted.length, 3);
  assert.equal(score, 100);
});
test("score: out-of-window signal scores 0", () => {
  assert.equal(scoreSignals([sig({ signal_date: "2026-09-01" })], RUN).score, 0);
});

// ---------- recommended_action: every branch ----------
const top = scoreSignals([sig({ one_line: "Led FreightCo seed.", signal_date: "2026-10-10" })], RUN).counted[0];

test("action: hold inside reply window", () => {
  assert.equal(recommend({ status: WAITING, last_contact_date: "2026-10-05" }, 0, undefined, RUN),
    "Hold: reply window open (contacted 7 days ago).");
});
test("action: hold inside reply window with strong signal saves it", () => {
  assert.equal(recommend({ status: WAITING, last_contact_date: "2026-10-02" }, 40, top, RUN),
    "Hold: reply window open (contacted 10 days ago). Save for follow-up: Led FreightCo seed.");
});
test("action: deprioritise at score 0", () => {
  assert.equal(recommend({ status: YET_TO_REACH_OUT, last_contact_date: null }, 0, undefined, RUN),
    "Deprioritise: no verified signal in the last 30 days.");
});
test("action: reach out when yet to reach out and score >= 20", () => {
  assert.equal(recommend({ status: YET_TO_REACH_OUT, last_contact_date: null }, 40, top, RUN),
    "Reach out this week. Open with: Led FreightCo seed. (2026-10-10)");
});
test("action: follow up when waiting >10 days or no contact date", () => {
  const expected = "Follow up this week. Reference: Led FreightCo seed. (2026-10-10)";
  assert.equal(recommend({ status: WAITING, last_contact_date: "2026-09-20" }, 40, top, RUN), expected);
  assert.equal(recommend({ status: WAITING, last_contact_date: null }, 40, top, RUN), expected);
});
test("action: monitor when 0 < score < 20", () => {
  assert.equal(recommend({ status: YET_TO_REACH_OUT, last_contact_date: null }, 12, top, RUN), "Low priority: monitor");
});
test("action: unknown status throws instead of guessing", () => {
  assert.throws(() => recommend({ status: "Meeting", last_contact_date: null }, 40, top, RUN));
});

// ---------- the four columns ----------
test("summary: quiet VC never called inactive", () => {
  assert.equal(buildSummary([], RUN), "No verified signal in the 30 days to 2026-10-12.");
});
test("buildUpdate: quiet VC gets all four columns, null last_signal_date", () => {
  const { update, outcome } = buildUpdate({ id: "x", status: YET_TO_REACH_OUT, last_contact_date: null }, [], RUN);
  assert.equal(outcome, "quiet");
  assert.equal(update.follow_up_score, 0);
  assert.equal(update.last_signal_date, null);
});
test("buildUpdate: summary lines and newest date", () => {
  const { update } = buildUpdate({ id: "x", status: YET_TO_REACH_OUT, last_contact_date: null }, [
    sig({ type: "invested", signal_date: "2026-10-01", one_line: "A", url: "https://a.com" }),
    sig({ type: "wrote", signal_date: "2026-10-09", one_line: "B", url: "https://b.com" }),
  ], RUN);
  assert.equal(update.last_signal_date, "2026-10-09");
  assert.equal(update.signal_summary, "2026-10-01 · A · https://a.com\n2026-10-09 · B · https://b.com");
});

// ---------- relevance cap ----------
import { capRelevance } from "../supabase/functions/signal-scan/verify.ts";
const rel = (one_line: string, relevance: "high" | "medium" | "low" = "high") =>
  capRelevance({ relevance, title: "", one_line, evidence_quote: "" });

test("relevance cap: genuine logistics stays high", () => {
  assert.equal(rel("Led seed in a freight-tech startup."), "high");
  assert.equal(rel("Wrote about supply-chain software for mid-market shippers."), "high");
  assert.equal(rel("Invested in Drivn, an electric fleet operations startup."), "high");
});
test("relevance cap: high with only adjacent B2B words drops to medium", () => {
  assert.equal(rel("Spoke on robots in manufacturing at IMTS."), "medium");
  assert.equal(rel("Led $8M round in quick commerce platform Inamo."), "medium");
});
test("relevance cap: no logistics or B2B words drops to low", () => {
  assert.equal(rel("Fireside chat at the Network State Conference."), "low");
  assert.equal(rel("Co-led $15M round in home interior materials platform Gravity."), "low");
  assert.equal(rel("Spoke at a webinar on pre-seed investing."), "low");
  assert.equal(rel("Discussed how AI changes startups and venture funding.", "medium"), "low");
});
test("relevance cap: orbital logistics is not logistics", () => {
  assert.equal(rel("Joined Impulse Space's orbital logistics Series D."), "low");
});
test("relevance cap: never raises a level", () => {
  assert.equal(rel("Wrote about freight", "medium"), "medium");
  assert.equal(rel("Wrote about freight", "low"), "low");
  assert.equal(rel("Wrote about B2B SaaS", "medium"), "medium");
});
