-- Paid-tier waitlist: emails captured from the /pricing page's "get on the
-- list" for tiers that aren't purchasable yet (Studio today). Same privacy
-- posture as login_events: RLS on with NO policies, so the public anon key
-- (which ships in the browser) can neither read nor write the table. The only
-- path in is the join_waitlist SECURITY DEFINER function. Read it yourself as
-- service role from the SQL editor to pull the list for launch outreach.

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier text not null,
  created_at timestamptz not null default now()
);

-- One row per (email, tier). The function always lowercases before insert, so
-- a plain unique index dedupes case-insensitively.
create unique index if not exists waitlist_email_tier on waitlist (email, tier);

alter table waitlist enable row level security;
-- (no policies on purpose — see header)

create or replace function join_waitlist(p_email text, p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into waitlist (email, tier)
  values (lower(trim(p_email)), p_tier)
  on conflict (email, tier) do nothing;
end;
$$;

revoke all on function join_waitlist(text, text) from public;
grant execute on function join_waitlist(text, text) to anon, authenticated;
