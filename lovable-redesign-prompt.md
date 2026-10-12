Redesign the home page and the visual theme. Keep all data access, auth, the VC page logic, Runs and Add VC exactly as they are, and keep every backend rule from the original spec (no Supabase integration, no migrations, never write the four signal columns).

## Theme: red and purple
- Dark mode is the default: near-black background (#0B0B0F), cards one step lighter (#15151C) with a 1px border (#24242E), white text, muted grey secondary text. Light mode: white background, #F7F7FA cards, near-black text.
- Accents: purple (#7C3AED, hover #6D28D9) as the primary colour for navigation, active states, links and primary buttons; red (#E11D48) for urgency: "Contact this week", high relevance, score rings above 20 and the stale-data banner. Use a subtle purple-to-red gradient only on the score rings and the hero metric, nowhere else.
- Holds = amber, Monitor = slate, Quiet = dark grey, Not scored yet = outline only.
- Rounded cards (14px radius), soft shadows in light mode only, Inter or a similar geometric sans, larger headings (28-32px for the page title).

## Layout (like a student-portal home: sidebar, main column, right insights column)
- Left sidebar: logo "VC Signal", nav items This week (home), All VCs, Runs, then the signed-in user at the bottom with sign-out.
- Top bar: "Welcome back" + user name on the right, theme toggle.

## Home page, top to bottom
1. **Header:** "Welcome back, Vikram" and the subline "Here's who's worth your time this week." Below it, "Last scanned <relative time> · <status>" and the stale banner when data_stale is true.

2. **This week's priorities** (main column): up to 3 large highlight cards for the highest-scoring VCs in "Contact this week". Each shows a circular score ring, name, firm, the action verb as a pill ("Reach out" / "Follow up"), and the top signal's one line with its date and source link. Click opens the VC page.

3. **Analysis** (main column), a row of compact cards:
   - **Pipeline at a glance:** a large ring showing % of VCs with a verified signal in the last 30 days (with_signal / scored), with counts beneath: Contact this week, Holds, Monitor, Quiet, Not scored.
   - **Signal mix:** a horizontal stacked bar of all signals in the last 30 days by relevance (high red, medium purple, low grey), and a small bar list by type (invested, wrote, spoke, event, other).
   - **Score distribution:** a small histogram of follow_up_score in buckets 0, 1-19, 20-39, 40+.
   - **Waiting on replies:** count of "Waiting for response" VCs, how many are inside the 10-day reply window (Holds) vs overdue for a follow-up.
   Compute all of this client-side from vc_pipeline_this_week and vc_signals (select vc_id, signal_date, type, relevance, scope). Keep the charts simple (recharts is fine) and readable in both themes.

4. **All VCs** (main column, full width): a responsive grid (4 columns desktop, 2 tablet, 1 phone) of every VC, sorted by score. Each card is a "weekly summary":
   - top row: initials avatar, name, firm, a small score ring
   - group pill (Contact this week / Hold / Monitor / Quiet / Not scored) and status pill
   - the recommended action in one or two lines
   - the top signal: date, one line (truncate to 2 lines), source domain
   - footer: last contact ("Never" if null) and signal count this window
   Filters above the grid: search, group chips, status. Clicking a card opens that VC's profile page.

5. **Right column (desktop only; stacks below on smaller screens):**
   - **Fresh signals:** the 6 most recent high or medium relevance signals across all VCs, newest first: VC name, type icon, one line, relative date, link.
   - **Reply windows closing:** Holds sorted by days since contact (closest to 10 first), each with "X days left".
   - **Last scan:** run date, status, with signal / quiet / failed counts, link to Runs.

## VC profile page
Restyle only, keep the content: header with large score ring and editable fields, "This week" card, the verified activity timeline with relevance pills in the new colours, and the empty-state copy.

## Also
- Add an "All VCs" sidebar route that shows just the grid with its filters.
- Loading skeletons for cards, and empty states that never invent data.
- All database text stays plain text, external links open in a new tab with rel="noopener noreferrer".
