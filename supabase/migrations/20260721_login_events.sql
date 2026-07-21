-- Login-event log: one row per sign-in-link request, powering (a) the founder
-- alert's New/Returning label and (b) engagement tracking (how often an email
-- opens the app) during the early-access window.
--
-- Privacy: RLS is enabled with NO policies, so neither the anon nor the
-- authenticated role can read or write this table directly (the anon key ships
-- in the browser bundle — emails must never be readable through it). The ONLY
-- write/read path is the SECURITY DEFINER function below, which runs as the
-- table owner and is the single choke point. Query the raw data yourself from
-- the Supabase SQL editor / dashboard (service role), which bypasses RLS.

create table if not exists login_events (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists login_events_email_time
  on login_events (email, created_at desc);

alter table login_events enable row level security;
-- (no policies on purpose — see header)

-- Records one login-link request and returns whether this is the FIRST time
-- we've seen this email in the log (true = "New", false = "Returning"). Note
-- "New" means "first login we've observed since tracking began", not "brand-new
-- account" — which is exactly the engagement signal we want for the window.
create or replace function record_login(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  is_new boolean;
begin
  select not exists (select 1 from login_events where email = p_email) into is_new;
  insert into login_events (email) values (p_email);
  return is_new;
end;
$$;

-- Only the definer function is callable; the table stays sealed.
revoke all on function record_login(text) from public;
grant execute on function record_login(text) to anon, authenticated;
