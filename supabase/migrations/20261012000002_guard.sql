-- Rule zero: the signal system (service_role) may write only the four signal
-- columns, and may never insert or delete. Enforced by privileges AND a trigger.

-- 1. Column privileges.
revoke all on public.vc_pipeline from anon, authenticated, service_role;
grant select on public.vc_pipeline to service_role;
grant update (last_signal_date, signal_summary, follow_up_score, recommended_action)
  on public.vc_pipeline to service_role;

-- 2. Guard trigger. Compares the whole row minus the four signal columns, so any
-- column added later is protected automatically. Vikram's edits (SQL editor,
-- Table Editor, his own app) are not service_role and pass through untouched.
create or replace function public.guard_vc_pipeline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  signal_cols text[] := array['last_signal_date', 'signal_summary', 'follow_up_score', 'recommended_action'];
begin
  if coalesce(claims ->> 'role', '') <> 'service_role' and current_user <> 'service_role' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    raise exception 'vc_pipeline guard: the signal system may not insert rows';
  elsif tg_op = 'DELETE' then
    raise exception 'vc_pipeline guard: the signal system may not delete rows';
  end if;

  if (to_jsonb(new) - signal_cols) is distinct from (to_jsonb(old) - signal_cols) then
    raise exception 'vc_pipeline guard: the signal system may only change last_signal_date, signal_summary, follow_up_score, recommended_action';
  end if;

  return new;
end;
$$;

drop trigger if exists vc_pipeline_guard on public.vc_pipeline;
create trigger vc_pipeline_guard
  before insert or update or delete on public.vc_pipeline
  for each row execute function public.guard_vc_pipeline();

-- 3. The only write path the Edge Function uses.
-- Input: [{id, last_signal_date, signal_summary, follow_up_score, recommended_action}]
create or replace function public.apply_signal_updates(updates jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  update public.vc_pipeline t set
    -- 4. last_signal_date only moves forward (greatest() ignores nulls).
    last_signal_date   = greatest(t.last_signal_date, (u ->> 'last_signal_date')::date),
    signal_summary     = u ->> 'signal_summary',
    follow_up_score    = (u ->> 'follow_up_score')::int,
    recommended_action = u ->> 'recommended_action'
  from jsonb_array_elements(updates) u
  where t.id = (u ->> 'id')::uuid;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.apply_signal_updates(jsonb) from public, anon, authenticated;
grant execute on function public.apply_signal_updates(jsonb) to service_role;
