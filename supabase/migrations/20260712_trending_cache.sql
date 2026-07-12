-- Trending topics cache: one row per (persona, generation run).
-- The /api/topics route reads the newest row within its TTL before paying for
-- a grounded Gemini call. NOTE: a trending_cache table may already exist in the
-- live Supabase instance (it is referenced by FK paths); `if not exists` keeps
-- this idempotent, but verify the live columns match before relying on it.

create table if not exists trending_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  persona_id uuid not null references personas(id) on delete cascade,
  topics jsonb not null,
  generated_at timestamptz not null default now()
);

create index if not exists trending_cache_persona_recency
  on trending_cache (persona_id, generated_at desc);

alter table trending_cache enable row level security;

drop policy if exists "Owners read their trending cache" on trending_cache;
create policy "Owners read their trending cache" on trending_cache
  for select using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

drop policy if exists "Owners insert their trending cache" on trending_cache;
create policy "Owners insert their trending cache" on trending_cache
  for insert with check (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );
