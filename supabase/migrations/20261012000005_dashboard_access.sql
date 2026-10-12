-- Dashboard access: signed-in users listed in dashboard_users can read the
-- pipeline, signals and runs, edit Vikram's own columns, add VCs, and start a
-- run. They can never write the four signal columns or delete. Everyone else
-- (anon, or signed in but not listed) reads nothing.

create table if not exists public.dashboard_users (
  email text primary key check (email = lower(email))
);
alter table public.dashboard_users enable row level security;
revoke all on public.dashboard_users from anon, authenticated;

create or replace function public.is_dashboard_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.dashboard_users
                  where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke execute on function public.is_dashboard_user() from public, anon;
grant execute on function public.is_dashboard_user() to authenticated;

-- Read
grant select on public.vc_pipeline, public.vc_signals, public.signal_runs, public.vc_pipeline_this_week to authenticated;
drop policy if exists dashboard_read on public.vc_pipeline;
create policy dashboard_read on public.vc_pipeline for select to authenticated using (public.is_dashboard_user());
drop policy if exists dashboard_read on public.vc_signals;
create policy dashboard_read on public.vc_signals for select to authenticated using (public.is_dashboard_user());
drop policy if exists dashboard_read on public.signal_runs;
create policy dashboard_read on public.signal_runs for select to authenticated using (public.is_dashboard_user());

-- Write: Vikram's columns only. No privilege on the four signal columns, no DELETE.
grant update (vc_name, firm, thesis, status, last_contact_date, contact_history, personal_notes)
  on public.vc_pipeline to authenticated;
grant insert (vc_name, firm, thesis, status, last_contact_date, contact_history, personal_notes)
  on public.vc_pipeline to authenticated;
drop policy if exists dashboard_update on public.vc_pipeline;
create policy dashboard_update on public.vc_pipeline for update to authenticated
  using (public.is_dashboard_user()) with check (public.is_dashboard_user());
drop policy if exists dashboard_insert on public.vc_pipeline;
create policy dashboard_insert on public.vc_pipeline for insert to authenticated
  with check (public.is_dashboard_user());

-- Run now. Returns the new run id, or null if a run is already in progress.
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
  return public.start_signal_run();
end;
$$;
revoke execute on function public.dashboard_start_run() from public, anon;
grant execute on function public.dashboard_start_run() to authenticated;
