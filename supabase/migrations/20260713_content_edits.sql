-- Edit-delta history: one row per edited-then-approved piece, holding the
-- categorized diff between what the machine generated (original_body) and
-- what the user approved (body). The rulebook layer aggregates these to
-- propose standing rules.
--
-- NOTE: rule suggestions are stored in the existing `contexts` table with
-- status = 'suggested'. If your contexts.status column has a CHECK constraint
-- limiting it to ('active','closed'), extend it to include 'suggested'.

create table if not exists content_edits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  persona_id uuid not null references personas(id) on delete cascade,
  content_piece_id uuid references content_pieces(id) on delete set null,
  deltas jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists content_edits_persona_recency
  on content_edits (persona_id, created_at desc);

alter table content_edits enable row level security;

drop policy if exists "Owners read their content edits" on content_edits;
create policy "Owners read their content edits" on content_edits
  for select using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

drop policy if exists "Owners insert their content edits" on content_edits;
create policy "Owners insert their content edits" on content_edits
  for insert with check (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );
