-- Back to private: undo the public demo grants from 20261012000006. Signed-in
-- users on dashboard_users keep the access from 20261012000005; sign-in is now
-- email + password (set per user in the SQL editor, see README), so no emails.

revoke all on public.vc_pipeline, public.vc_signals, public.signal_runs, public.vc_pipeline_this_week from anon;
drop policy if exists demo_read on public.vc_pipeline;
drop policy if exists demo_read on public.vc_signals;
drop policy if exists demo_read on public.signal_runs;
drop policy if exists demo_update on public.vc_pipeline;
drop policy if exists demo_insert on public.vc_pipeline;

-- Run now: dashboard users only, at most one scan start per hour (paid APIs).
create or replace function public.dashboard_start_run()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_dashboard_user() then
    raise exception 'not a dashboard user';
  end if;
  if exists (select 1 from public.signal_runs where started_at > now() - interval '1 hour') then
    raise exception 'A scan already started in the last hour. Try again later.';
  end if;
  return public.start_signal_run();
end;
$$;
revoke execute on function public.dashboard_start_run() from public, anon;
grant execute on function public.dashboard_start_run() to authenticated;
