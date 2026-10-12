Build "VC Signal", a private dashboard for Vikram, a first-time founder raising a Seed round for a B2B logistics SaaS. Twice a week a backend job scans his ~50 target VCs for public activity in the last 30 days and scores who is worth contacting this week. This app is how he works that list. The backend already exists; you are building the front end only.

## Backend (already exists, do not change it)
Use supabase-js directly with these values in `src/lib/supabase.ts`:
- URL: https://fgkltayciixoigwgtgbp.supabase.co
- Publishable key: sb_publishable_zjgyhe2l_COjZCWsvbxoXA_Jl6NCN5N

IMPORTANT: Do NOT connect Lovable's Supabase integration, and do NOT create, alter or migrate any tables, policies, functions or edge functions. The schema and security rules are final. Only read/write through the tables, view and RPC below.

### Auth
Magic-link sign-in only (`supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })`). No sign-up page, no passwords. Only allow-listed emails can see data; anyone else signs in and sees nothing, so if the pipeline query returns 0 rows after sign-in, show "Your email doesn't have access to this dashboard."

### Data
`vc_pipeline_this_week` (view, read-only, already ordered by score desc):
id (uuid), vc_name, firm, thesis, status ('Yet to reach out' | 'Waiting for response'), last_contact_date (date|null), contact_history (text|null), personal_notes (text|null), follow_up_score (int 0-100|null), recommended_action (text|null), signal_summary (text|null; 1-2 lines, each "YYYY-MM-DD · one line · url"), last_signal_date (date|null), last_run_at (timestamptz), last_run_status ('running'|'completed'|'partial'), data_stale (boolean).

`vc_signals` (read-only): id, vc_id, signal_date, type ('invested'|'wrote'|'spoke'|'event'|'other'), scope ('person'|'firm'), relevance ('high'|'medium'|'low'), title, url, evidence_quote, one_line.

`signal_runs` (read-only): id, run_date, started_at, finished_at, status, processed, with_signal, quiet, failed, errors (jsonb array of {vc_id, error, at}), exa_requests, input_tokens, output_tokens.

`vc_pipeline` (table): the user may UPDATE only vc_name, firm, thesis, status, last_contact_date, contact_history, personal_notes, and INSERT new rows with those columns. The four signal columns (last_signal_date, signal_summary, follow_up_score, recommended_action) are written only by the backend: never include them in any update or insert payload, or the database rejects the request. No deletes.

RPC `dashboard_start_run()` returns the new run id, or null if a run is already in progress.

## Grouping (derive from recommended_action)
- Contact this week: starts with "Reach out" or "Follow up"
- Holds: starts with "Hold"
- Monitor: starts with "Low priority"
- Quiet: starts with "Deprioritise"
- Not scored yet: recommended_action is null (research failed or new VC)

## Screens
1. **This week (home)**
   - Header: "Last scanned <relative time> · <status>". If data_stale is true, a prominent amber banner: "No completed scan in the last 5 days. Data may be out of date." If last_run_status is 'partial', a subtle note linking to Runs.
   - Summary chips with counts per group; clicking filters.
   - Search (name or firm) and status filter.
   - Groups in order: Contact this week, Holds, Monitor, Not scored yet, Quiet (Quiet collapsed by default).
   - Each row/card: score as a badge (green >= 20, grey otherwise), name and firm, recommended action, top signal (first line of signal_summary: date, one line, and a source link opening in a new tab), status pill, last contact ("Never" if null).
   - Click a row to open the VC page.
2. **VC page** (`/vc/:id`)
   - Header: name, firm, thesis, status, last contact. Inline-editable: status (select), last_contact_date (date picker), thesis, contact_history and personal_notes (textareas). Save on blur with a small "Saved" confirmation; show errors.
   - "This week": score badge, recommended action, signal summary.
   - "Verified activity, last 30 days": timeline of this VC's vc_signals with signal_date in the last 30 days, newest first. Each item: date, type icon, relevance pill (high = emerald, medium = amber, low = slate), "Firm" tag when scope = 'firm', one line, the evidence quote in a blockquote, and the source domain as a link.
   - If no signals: "No verified public activity in the last 30 days. This means no evidence was found, not that they're inactive."
3. **Runs**
   - Table of signal_runs, newest first: date, status, processed / with signal / quiet / failed, Exa requests, tokens in/out, duration. Expandable row showing errors (map vc_id to VC name).
   - "Run now" button calling dashboard_start_run(); if it returns null, toast "A scan is already running". While a run is 'running', poll every 10s and show progress (processed so far is not stored live; show "Running…" with elapsed time).
4. **Add VC**: a small dialog (name, firm, thesis, status, last contact) that inserts into vc_pipeline. New VCs show under "Not scored yet" until the next scan.

## Design
Calm, dense, professional: a tool a founder opens at 7:45am with coffee. Inspiration: Linear and Attio. Light theme default with dark mode. Neutral greys, one accent (deep indigo), Inter font, 8px radius, generous whitespace, no gradients or stock illustrations. Desktop-first table layout that collapses to cards on mobile. Treat all text from the database as plain text (never render as HTML). Every external link opens in a new tab with rel="noopener noreferrer".
