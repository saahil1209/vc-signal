-- Schedule: Mon + Thu 07:45 IST (02:15 UTC) enqueue; a worker tick every 2 min
-- calls signal-scan only while queue rows are waiting (so manual runs work any time).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The cron secret is generated inside the database and never printed. The Edge
-- Function checks the x-cron-secret header against it via verify_cron_secret().
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'signal_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'signal_cron_secret',
                                'x-cron-secret header for the signal-scan Edge Function');
  end if;
  if not exists (select 1 from vault.secrets where name = 'signal_scan_url') then
    perform vault.create_secret('https://fgkltayciixoigwgtgbp.supabase.co/functions/v1/signal-scan',
                                'signal_scan_url', 'signal-scan Edge Function URL');
  end if;
end $$;

create or replace function public.verify_cron_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets
                  where name = 'signal_cron_secret' and decrypted_secret = p_secret);
$$;
revoke execute on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

create or replace function public.kick_signal_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid bigint;
begin
  select id into rid from public.signal_runs where status = 'running' order by id desc limit 1;
  if rid is null or public.maybe_close_signal_run(rid) then
    return;
  end if;
  if exists (select 1 from public.signal_queue
              where run_id = rid and done_at is null and attempts < 3
                and (claimed_at is null or claimed_at < now() - interval '10 minutes')) then
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'signal_scan_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signal_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000);
  end if;
end;
$$;
revoke execute on function public.kick_signal_worker() from public, anon, authenticated;

select cron.schedule('signal-enqueue', '15 2 * * 1,4', $$select public.start_signal_run()$$);
select cron.schedule('signal-worker', '*/2 * * * *', $$select public.kick_signal_worker()$$);
