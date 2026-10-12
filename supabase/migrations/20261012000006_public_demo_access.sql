-- Public demo mode (requested): no sign-in. Anyone with the dashboard URL can
-- read the pipeline, edit Vikram's own columns, add VCs and start a scan.
-- Still enforced: no one but the signal system writes the four signal
-- columns (column privileges), nobody can delete, and a scan can start at most
-- once an hour. Revert with 20261012000005's rules before loading real data:
--   revoke all on public.vc_pipeline, public.vc_signals, public.signal_runs, public.vc_pipeline_this_week from anon;
--   drop policy demo_read on ...; drop policy demo_update/demo_insert on public.vc_pipeline;
--   revoke execute on function public.dashboard_start_run() from anon;

grant select on public.vc_pipeline, public.vc_signals, public.signal_runs, public.vc_pipeline_this_week to anon;
drop policy if exists demo_read on public.vc_pipeline;
create policy demo_read on public.vc_pipeline for select to anon using (true);
drop policy if exists demo_read on public.vc_signals;
create policy demo_read on public.vc_signals for select to anon using (true);
drop policy if exists demo_read on public.signal_runs;
create policy demo_read on public.signal_runs for select to anon using (true);

grant update (vc_name, firm, thesis, status, last_contact_date, contact_history, personal_notes)
  on public.vc_pipeline to anon;
grant insert (vc_name, firm, thesis, status, last_contact_date, contact_history, personal_notes)
  on public.vc_pipeline to anon;
drop policy if exists demo_update on public.vc_pipeline;
create policy demo_update on public.vc_pipeline for update to anon using (true) with check (true);
drop policy if exists demo_insert on public.vc_pipeline;
create policy demo_insert on public.vc_pipeline for insert to anon with check (true);

-- Run now: open to everyone, but at most one scan start per hour (paid APIs).
create or replace function public.dashboard_start_run()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.signal_runs where started_at > now() - interval '1 hour') then
    raise exception 'A scan already started in the last hour. Try again later.';
  end if;
  return public.start_signal_run();
end;
$$;
revoke execute on function public.dashboard_start_run() from public;
grant execute on function public.dashboard_start_run() to anon, authenticated;
