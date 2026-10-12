-- Audit trail, run log and work queue for the signal scan.

create table if not exists public.signal_runs (
  id bigint generated always as identity primary key,
  run_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'partial')),
  processed int not null default 0,
  with_signal int not null default 0,
  quiet int not null default 0,
  failed int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  exa_requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0
);

-- Every verified signal behind every score.
create table if not exists public.vc_signals (
  id bigint generated always as identity primary key,
  vc_id uuid not null references public.vc_pipeline (id),
  run_id bigint references public.signal_runs (id),
  signal_date date not null,
  type text not null check (type in ('invested', 'wrote', 'spoke', 'event', 'other')),
  scope text not null check (scope in ('person', 'firm')),
  relevance text not null check (relevance in ('high', 'medium', 'low')),
  title text,
  url text not null,
  source text not null default 'exa' check (source in ('exa', 'crunchbase')),
  evidence_quote text not null,
  one_line text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_run bigint references public.signal_runs (id),
  unique (vc_id, url)
);
create index if not exists vc_signals_vc_date on public.vc_signals (vc_id, signal_date);

create table if not exists public.signal_queue (
  run_id bigint not null references public.signal_runs (id),
  vc_id uuid not null references public.vc_pipeline (id),
  claimed_at timestamptz,
  done_at timestamptz,
  attempts int not null default 0,
  outcome text check (outcome in ('signal', 'quiet', 'failed')),
  last_error text,
  primary key (run_id, vc_id)
);

alter table public.signal_runs enable row level security;
alter table public.vc_signals enable row level security;
alter table public.signal_queue enable row level security;
revoke all on public.signal_runs, public.vc_signals, public.signal_queue from anon, authenticated;

-- Starts a run and queues every VC (or only p_vc_ids, for a pilot).
-- Returns null without starting if a run is already in progress.
create or replace function public.start_signal_run(p_vc_ids uuid[] default null)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  rid bigint;
begin
  perform pg_advisory_xact_lock(hashtext('start_signal_run'));

  -- A run stuck for 6h+ (crashed worker) is closed as partial so it can't block forever.
  update public.signal_runs
     set status = 'partial', finished_at = now(),
         errors = errors || jsonb_build_array(jsonb_build_object('error', 'run abandoned after 6 hours', 'at', now()))
   where status = 'running' and started_at < now() - interval '6 hours';

  if exists (select 1 from public.signal_runs where status = 'running') then
    raise notice 'A signal run is already running; not starting another.';
    return null;
  end if;

  insert into public.signal_runs default values returning id into rid;
  insert into public.signal_queue (run_id, vc_id)
    select rid, p.id from public.vc_pipeline p
     where p_vc_ids is null or p.id = any (p_vc_ids);
  return rid;
end;
$$;

-- Claims up to n VCs. Reclaims rows claimed >10 min ago; gives up after 3 attempts.
create or replace function public.claim_signal_batch(n int)
returns table (run_id bigint, vc_id uuid, attempts int)
language sql
set search_path = ''
as $$
  with c as (
    select q.run_id, q.vc_id
      from public.signal_queue q
      join public.signal_runs r on r.id = q.run_id and r.status = 'running'
     where q.done_at is null
       and q.attempts < 3
       and (q.claimed_at is null or q.claimed_at < now() - interval '10 minutes')
     order by q.attempts, q.vc_id
     limit n
       for update of q skip locked
  )
  update public.signal_queue q
     set claimed_at = now(), attempts = q.attempts + 1
    from c
   where q.run_id = c.run_id and q.vc_id = c.vc_id
  returning q.run_id, q.vc_id, q.attempts;
$$;

-- Records one VC's result. p_outcome: 'signal' | 'quiet' | 'error'.
-- An error before the 3rd attempt releases the row for retry; on the 3rd it fails.
create or replace function public.finish_queue_item(
  p_run bigint, p_vc uuid, p_outcome text, p_error text default null,
  p_exa int default 0, p_in bigint default 0, p_out bigint default 0)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.signal_runs
     set exa_requests = exa_requests + p_exa,
         input_tokens = input_tokens + p_in,
         output_tokens = output_tokens + p_out
   where id = p_run;

  if p_outcome in ('signal', 'quiet') then
    update public.signal_queue
       set done_at = now(), outcome = p_outcome, last_error = null
     where run_id = p_run and vc_id = p_vc;
  elsif p_outcome = 'error' then
    update public.signal_queue q
       set last_error = left(p_error, 500),
           claimed_at = case when q.attempts >= 3 then q.claimed_at end,
           done_at    = case when q.attempts >= 3 then now() end,
           outcome    = case when q.attempts >= 3 then 'failed' end
     where q.run_id = p_run and q.vc_id = p_vc;

    update public.signal_runs
       set errors = errors || jsonb_build_array(jsonb_build_object('vc_id', p_vc, 'error', left(p_error, 500), 'at', now()))
     where id = p_run
       and exists (select 1 from public.signal_queue
                    where run_id = p_run and vc_id = p_vc and outcome = 'failed');
  else
    raise exception 'finish_queue_item: unknown outcome %', p_outcome;
  end if;
end;
$$;

-- Closes the run once nothing is left to do. Returns true if the run is closed.
create or replace function public.maybe_close_signal_run(p_run bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  -- 3rd attempt claimed >10 min ago and never reported back: give up on it.
  with timed_out as (
    update public.signal_queue
       set done_at = now(), outcome = 'failed', last_error = coalesce(last_error, 'worker timed out')
     where run_id = p_run and done_at is null and attempts >= 3
       and claimed_at < now() - interval '10 minutes'
    returning vc_id, last_error
  )
  update public.signal_runs
     set errors = errors || coalesce((select jsonb_agg(jsonb_build_object('vc_id', vc_id, 'error', last_error, 'at', now())) from timed_out), '[]'::jsonb)
   where id = p_run;

  if exists (select 1 from public.signal_queue where run_id = p_run and done_at is null) then
    return false;
  end if;

  update public.signal_runs r
     set finished_at = now(),
         processed = c.processed, with_signal = c.with_signal, quiet = c.quiet, failed = c.failed,
         status = case when c.failed > 0 then 'partial' else 'completed' end
    from (select count(*) filter (where outcome in ('signal', 'quiet')) as processed,
                 count(*) filter (where outcome = 'signal') as with_signal,
                 count(*) filter (where outcome = 'quiet') as quiet,
                 count(*) filter (where outcome = 'failed') as failed
            from public.signal_queue where run_id = p_run) c
   where r.id = p_run and r.status = 'running';
  return true;
end;
$$;

revoke execute on function public.start_signal_run(uuid[]) from public, anon, authenticated;
revoke execute on function public.claim_signal_batch(int) from public, anon, authenticated;
revoke execute on function public.finish_queue_item(bigint, uuid, text, text, int, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.maybe_close_signal_run(bigint) from public, anon, authenticated;
grant execute on function public.claim_signal_batch(int) to service_role;
grant execute on function public.finish_queue_item(bigint, uuid, text, text, int, bigint, bigint) to service_role;
grant execute on function public.maybe_close_signal_run(bigint) to service_role;

-- What Vikram opens: his pipeline ranked by score, with a stale flag when no
-- run has finished in 5 days (Mon->Thu is 3 days, Thu->Mon is 4).
create or replace view public.vc_pipeline_this_week
with (security_invoker = true) as
select
  p.follow_up_score,
  p.recommended_action,
  p.vc_name,
  p.firm,
  p.status,
  p.last_contact_date,
  p.signal_summary,
  p.last_signal_date,
  p.thesis,
  p.contact_history,
  p.personal_notes,
  lr.started_at as last_run_at,
  lr.status as last_run_status,
  not exists (
    select 1 from public.signal_runs
     where status in ('completed', 'partial') and finished_at > now() - interval '5 days'
  ) as data_stale,
  p.id
from public.vc_pipeline p
left join lateral (
  select started_at, status from public.signal_runs order by id desc limit 1
) lr on true
order by p.follow_up_score desc nulls last, p.vc_name;

revoke all on public.vc_pipeline_this_week from anon, authenticated;
