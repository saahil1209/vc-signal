-- Vikram's pipeline. Everything except the four signal columns belongs to him.
create table if not exists public.vc_pipeline (
  id uuid primary key default gen_random_uuid(),
  vc_name text not null,
  firm text not null,
  thesis text,
  last_contact_date date,
  status text not null default 'Yet to reach out'
    check (status in ('Yet to reach out', 'Waiting for response')),
  contact_history text,
  personal_notes text,
  created_at timestamptz not null default now()
);

-- The only columns the signal system may write (enforced in 20261012000002_guard).
alter table public.vc_pipeline add column if not exists last_signal_date date;
alter table public.vc_pipeline add column if not exists signal_summary text;
alter table public.vc_pipeline add column if not exists follow_up_score int
  check (follow_up_score between 0 and 100);
alter table public.vc_pipeline add column if not exists recommended_action text;

-- No policies: anon and authenticated read nothing. service_role and postgres bypass RLS.
alter table public.vc_pipeline enable row level security;
