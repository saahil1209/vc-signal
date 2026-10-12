// signal-scan: claims a batch of VCs, researches each, verifies, scores, and
// writes the four signal columns through apply_signal_updates(). Called by pg_cron.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { gatherDocs } from "./exa.ts";
import { extractSignals } from "./gemini.ts";
import { capRelevance, verifySignals } from "./verify.ts";
import { buildUpdate } from "./score.ts";
import type { StoredSignal } from "./score.ts";
import { windowStart } from "./window.ts";

const BATCH_SIZE = Number(Deno.env.get("BATCH_SIZE") ?? "5");
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const FOUNDER_SECTOR = Deno.env.get("FOUNDER_SECTOR") ?? "B2B logistics / supply-chain SaaS, raising Seed";

type Claimed = { run_id: number; vc_id: string; attempts: number };
type VcRow = { id: string; vc_name: string; firm: string; thesis: string | null; status: string; last_contact_date: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

async function processVc(
  db: SupabaseClient,
  runId: number,
  runDate: string,
  vc: VcRow,
  keys: { exa: string; gemini: string },
): Promise<string> {
  const usage = { exa: 0, in: 0, out: 0 };
  try {
    const start = windowStart(runDate);
    const { docs, requests } = await gatherDocs(keys.exa, vc, start, runDate);
    usage.exa = requests;

    if (docs.length > 0) {
      const x = await extractSignals(keys.gemini, MODEL, {
        vcName: vc.vc_name, firm: vc.firm, thesis: vc.thesis, founderSector: FOUNDER_SECTOR, runDate, windowStart: start,
      }, docs);
      usage.in = x.inputTokens;
      usage.out = x.outputTokens;

      const { kept } = verifySignals(x.signals, docs, start, runDate);
      if (kept.length > 0) {
        const { error } = await db.from("vc_signals").upsert(
          kept.map((s) => ({ ...s, vc_id: vc.id, run_id: runId, last_seen_run: runId, source: "exa" })),
          { onConflict: "vc_id,url" },
        );
        if (error) throw new Error(`vc_signals upsert: ${error.message}`);
      }
    }

    // Score from every stored signal in the window, not just this run's finds.
    const { data: rows, error: selErr } = await db
      .from("vc_signals")
      .select("signal_date, type, scope, relevance, one_line, url")
      .eq("vc_id", vc.id)
      .gte("signal_date", start)
      .lte("signal_date", runDate);
    if (selErr) throw new Error(`vc_signals select: ${selErr.message}`);

    const { update, outcome } = buildUpdate(vc, (rows ?? []) as StoredSignal[], runDate);
    const { error: upErr } = await db.rpc("apply_signal_updates", { updates: [update] });
    if (upErr) throw new Error(`apply_signal_updates: ${upErr.message}`);

    const { error: finErr } = await db.rpc("finish_queue_item", {
      p_run: runId, p_vc: vc.id, p_outcome: outcome, p_exa: usage.exa, p_in: usage.in, p_out: usage.out,
    });
    if (finErr) throw new Error(`finish_queue_item: ${finErr.message}`);
    return outcome;
  } catch (e) {
    // Research failed: the four columns are left untouched for this VC.
    await db.rpc("finish_queue_item", {
      p_run: runId, p_vc: vc.id, p_outcome: "error", p_error: errMsg(e), p_exa: usage.exa, p_in: usage.in, p_out: usage.out,
    });
    return "error";
  }
}

/**
 * Re-applies the relevance cap to stored signals and recomputes the four columns
 * from them. No Exa or Gemini calls. Skips VCs never successfully scored, since a
 * failed search is not evidence of silence.
 */
async function rescore(db: SupabaseClient) {
  const runDate = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10); // IST
  const start = windowStart(runDate);

  const { data: vcs, error } = await db
    .from("vc_pipeline")
    .select("id, vc_name, status, last_contact_date, follow_up_score")
    .not("follow_up_score", "is", null);
  if (error) throw new Error(`vc_pipeline: ${error.message}`);

  const downgraded: { vc: string; one_line: string }[] = [];
  const updates = [];
  for (const vc of vcs ?? []) {
    const { data: rows, error: sErr } = await db
      .from("vc_signals")
      .select("id, signal_date, type, scope, relevance, title, one_line, evidence_quote, url")
      .eq("vc_id", vc.id)
      .gte("signal_date", start)
      .lte("signal_date", runDate);
    if (sErr) throw new Error(`vc_signals: ${sErr.message}`);

    const signals = [];
    for (const r of rows ?? []) {
      const capped = capRelevance({ ...r, title: r.title ?? "" });
      if (capped !== r.relevance) {
        const { error: uErr } = await db.from("vc_signals").update({ relevance: capped }).eq("id", r.id);
        if (uErr) throw new Error(`vc_signals update: ${uErr.message}`);
        downgraded.push({ vc: vc.vc_name, one_line: r.one_line });
      }
      signals.push({ ...r, relevance: capped });
    }
    updates.push(buildUpdate(vc, signals as StoredSignal[], runDate).update);
  }

  const { error: upErr } = await db.rpc("apply_signal_updates", { updates });
  if (upErr) throw new Error(`apply_signal_updates: ${upErr.message}`);
  return { rescored: updates.length, downgraded };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: authorised, error: authErr } = await db.rpc("verify_cron_secret", {
    p_secret: req.headers.get("x-cron-secret") ?? "",
  });
  if (authErr || authorised !== true) return json({ error: "unauthorised" }, 401);

  const body = await req.json().catch(() => ({})) as { mode?: string };
  if (body.mode === "rescore") return json(await rescore(db));

  const exa = Deno.env.get("EXA_API_KEY");
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (!exa || !gemini) {
    // Names only, never values: helps spot a misspelt secret.
    const similar = Object.keys(Deno.env.toObject()).filter((k) => /exa|gemini|google/i.test(k));
    return json({
      error: "Edge Function secrets missing",
      missing: [!exa && "EXA_API_KEY", !gemini && "GEMINI_API_KEY"].filter(Boolean),
      similar_names_found: similar,
    }, 500);
  }

  const { data: claimedData, error: claimErr } = await db.rpc("claim_signal_batch", { n: BATCH_SIZE });
  if (claimErr) return json({ error: `claim_signal_batch: ${claimErr.message}` }, 500);
  const claimed = (claimedData ?? []) as Claimed[];
  if (claimed.length === 0) return json({ claimed: 0 });

  const runIds = [...new Set(claimed.map((c) => c.run_id))];
  const { data: runs, error: runErr } = await db.from("signal_runs").select("id, run_date").in("id", runIds);
  if (runErr) return json({ error: `signal_runs: ${runErr.message}` }, 500);
  const runDates = new Map((runs ?? []).map((r: { id: number; run_date: string }) => [r.id, r.run_date]));

  const { data: vcs, error: vcErr } = await db
    .from("vc_pipeline")
    .select("id, vc_name, firm, thesis, status, last_contact_date")
    .in("id", claimed.map((c) => c.vc_id));
  if (vcErr) return json({ error: `vc_pipeline: ${vcErr.message}` }, 500);
  const vcById = new Map((vcs ?? []).map((v: VcRow) => [v.id, v]));

  const outcomes = await Promise.all(claimed.map((c) => {
    const vc = vcById.get(c.vc_id);
    const runDate = runDates.get(c.run_id);
    if (!vc || !runDate) {
      return db.rpc("finish_queue_item", { p_run: c.run_id, p_vc: c.vc_id, p_outcome: "error", p_error: "VC or run not found" })
        .then(() => "error");
    }
    return processVc(db, c.run_id, runDate, vc, { exa, gemini });
  }));

  for (const id of runIds) await db.rpc("maybe_close_signal_run", { p_run: id });

  const tally: Record<string, number> = {};
  for (const o of outcomes) tally[o] = (tally[o] ?? 0) + 1;
  return json({ claimed: claimed.length, ...tally });
});
