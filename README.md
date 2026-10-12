# VC Signal: Vikram's pipeline intelligence

Twice a week (Mon + Thu, 07:45 IST) every VC in `vc_pipeline` is checked for public activity in the last 30 days (Exa search → Gemini extraction → code verification → deterministic score). Only four columns are written: `last_signal_date`, `signal_summary`, `follow_up_score`, `recommended_action`.

Supabase project: `VC Signal` (`fgkltayciixoigwgtgbp`, ap-south-1).

## What Vikram opens
Table Editor → `vc_pipeline_this_week` (view): ranked by score, with `last_run_at`, `last_run_status`, `data_stale` (true if no run finished in 5 days).

## Rule zero: his columns are protected in the database
- `service_role` has UPDATE on the four signal columns only; no INSERT/DELETE.
- Trigger `vc_pipeline_guard` rejects any service_role insert, delete, or update that changes anything except those four columns, including columns added later.
- The Edge Function writes only through `apply_signal_updates(jsonb)`. `last_signal_date` only moves forward.
- Vikram's own edits (Table Editor, SQL editor) are unaffected.

## Run now
SQL editor: `select start_signal_run();` (all VCs) or `select start_signal_run(array['<uuid>', ...]::uuid[]);` (a subset). The `signal-worker` cron (every 2 min) processes 5 VCs per call until the queue is empty. Returns null if a run is already in progress.

## Change the schedule
`select cron.alter_job((select jobid from cron.job where jobname = 'signal-enqueue'), schedule := '15 2 * * 1,4');` (UTC).

## Keys
Dashboard → Edge Functions → Secrets: `EXA_API_KEY`, `GEMINI_API_KEY`. Optional: `GEMINI_MODEL` (default `gemini-3.8-flash`), `BATCH_SIZE` (default 5). To rotate, overwrite the secret; it applies on the next call.
The cron secret lives only in Vault (`signal_cron_secret`) and is never printed. To rotate: `select vault.update_secret((select id from vault.secrets where name='signal_cron_secret'), encode(extensions.gen_random_bytes(32),'hex'));`

## Audit trail
- `vc_signals`: every verified signal: date, type, relevance, URL, verbatim evidence quote.
- `signal_runs`: one row per run: counts, `errors`, `exa_requests`, `input_tokens`, `output_tokens`.
- `signal_queue`: per-VC attempts and last error for each run.

## When a run is partial, failed, or stale (owner)
1. `select * from signal_runs order by id desc limit 3;` and read `errors`.
2. Failed VCs kept their previous four columns. A failed search is never recorded as "quiet".
3. Fix the cause (usually a key or quota), then `select start_signal_run();`.

## Tests
`node --test tests/signal.test.ts` (Node 22.6+): window, verification, scoring calibration, every recommended_action branch.

## Known limits
- Only public, indexed content counts. LinkedIn-only posts and unlisted events are missed.
- "Quiet" means no verified public signal, not that the VC is inactive.
- `vc_pipeline` rows marked `[sample]` are SAMPLE DATA. Replace with Vikram's real list (insert as postgres via Table Editor/SQL, never via service_role).
- Status supports exactly `Yet to reach out` and `Waiting for response`, per the brief.

## Public demo mode (current)
Migration `20261012000006_public_demo_access.sql` removes sign-in: anyone with the dashboard URL can read everything, edit Vikram's own columns, add VCs and press Run now (limited to one scan start per hour). The four signal columns and deletes stay blocked for everyone except the signal system. **Revert this before loading Vikram's real data** (the revert statements are in the migration's header comment) and restore the sign-in screen in the dashboard.

## Dashboard (`dashboard/`)
TanStack Start app designed in Lovable (project "Strict Build"), exported as a snapshot. It talks to Supabase directly with the publishable key; access is enforced by RLS (`dashboard_users` allow-list), not by the app.

- Local: `cd dashboard && npm install && npm run dev`
- Deploy (Vercel): import **saahil1209/vc-signal-dashboard** (a copy of this folder with the app at the root, made with `git subtree split --prefix dashboard`). `vercel.json` sets the build to `NITRO_PRESET=vercel npm run build`. No environment variables needed. To update it: `git subtree split --prefix dashboard -b d && git push https://github.com/saahil1209/vc-signal-dashboard.git d:main && git branch -D d`.
- After the first deploy, add the Vercel URL in Supabase → Authentication → URL Configuration (Site URL and Redirect URLs), or magic links will point elsewhere.
- Lovable edits do not sync here automatically: re-export from Lovable (Code → Download codebase) and replace `dashboard/`.
- Add a user: `insert into dashboard_users values ('person@example.com');`
