<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Use the direct browser Supabase client in src/lib/supabase.ts for the existing backend; this frontend must not provision or modify backend infrastructure.
- Centralize permitted pipeline writes and data queries in src/lib/vc-data.ts; explicit field allowlists protect backend-owned signal columns.
- Keep authentication and the shared application shell in src/components/vc-shell.tsx, with leaf pages for weekly pipeline, VC details, and runs; every page shares one session boundary.

- Share the weekly investor grid between home and /all-vcs in src/components/vc-dashboard.tsx; pure calculations in src/lib/vc-analysis.ts keep metrics testable without backend changes.
