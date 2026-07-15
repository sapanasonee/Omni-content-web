import { NextResponse } from 'next/server'
import type { createClient } from '@/lib/supabase/server'

// ─── Why this file exists ────────────────────────────────────────────────────
//
// Every API route in this app receives `workspace_id` / `persona_id` from the
// client and, before this guard existed, "verified" them with a bare
// `.eq('id', workspace_id).single()` lookup. That check only proves the row is
// *visible to the session* — and visibility is decided entirely by Supabase
// RLS. That made RLS a single point of failure for tenant isolation:
//
//   1. RLS policies for the core tables (workspaces, personas, content_pieces,
//      contexts) live ONLY in the live Supabase instance — they are not
//      tracked in this repo, so they can drift or be dropped without any code
//      review catching it. This has already happened once (trending_cache was
//      hand-created in production without its RLS policies).
//   2. The blast radius extends beyond Postgres: brand_dna.json reads/writes
//      and approved-content writes go to GCS, which has NO row-level security.
//      Those GCS paths are built from client-supplied IDs, gated only by the
//      Supabase lookups. One permissive policy would let an attacker read or
//      overwrite another tenant's Brand DNA — the file every prompt is built
//      from.
//
// This guard is the second wall (defense-in-depth): it asserts ownership
// EXPLICITLY in the query predicate (`owner_id = auth user id`), so even a
// fully-permissive RLS policy cannot make a foreign workspace pass. RLS stays
// the primary enforcement layer; this makes a single policy mistake
// non-catastrophic instead of game over.
//
// Usage convention: every route that accepts a workspace_id MUST call
// `requireWorkspaceOwnership` before touching any workspace-scoped data, and
// every route that accepts a persona_id MUST chain
// `requirePersonaInWorkspace` after it. The two-step (workspace, then persona
// filtered by workspace_id) is deliberate — it preserves the project's
// established two-query pattern that avoids PostgREST relationship ambiguity
// now that multiple FK paths exist between workspaces and personas.
// ─────────────────────────────────────────────────────────────────────────────

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

// Strict UUID shape check, applied BEFORE any ID reaches a query or a GCS
// path template. Two reasons beyond tidiness:
//   - Postgres raises 22P02 on non-UUID input to a uuid column; today that
//     error is swallowed into a generic 404, but it pollutes logs and makes
//     real failures harder to spot. Rejecting garbage up front is cheaper.
//   - brand-dna and approve interpolate these IDs into GCS object paths
//     (`workspaces/{id}/personas/{id}/...`). Constraining IDs to UUID shape
//     makes path traversal via crafted IDs (e.g. "../") structurally
//     impossible rather than merely unlikely.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

// Only the columns routes actually consume. Deliberately NOT select('*'):
// a narrow projection means adding a sensitive column to workspaces later
// (billing details, tokens) never silently starts flowing through guard
// call sites.
export interface GuardedWorkspace {
  id: string
  owner_id: string
  plan_tier: string | null
  generations_used: number | null
}

export type WorkspaceGuardResult =
  | { workspace: GuardedWorkspace; failure: null }
  | { workspace: null; failure: NextResponse }

// Asserts the workspace exists AND belongs to the authenticated user.
//
// The ownership condition lives in the SQL predicate itself
// (`.eq('owner_id', userId)`) rather than as a JS check on the returned row,
// so it holds even if RLS returns rows it shouldn't — the comparison happens
// in the database against the column, not against whatever a broken policy
// let through. The belt-and-suspenders JS re-check below costs nothing and
// catches the (pathological) case of a PostgREST/query-builder regression
// dropping the filter.
//
// Failure is always a 404, never a 403: a 403 on someone else's workspace ID
// confirms that the ID exists, which is itself an information leak. "Not
// found" is what an attacker sees whether the workspace is missing or merely
// not theirs — indistinguishable by design. This also matches the status the
// routes already returned, so no client behavior changes.
export async function requireWorkspaceOwnership(
  supabase: ServerSupabase,
  userId: string,
  workspaceId: unknown,
): Promise<WorkspaceGuardResult> {
  const notFound = () => ({
    workspace: null,
    failure: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }),
  })

  if (!isUuid(workspaceId)) return notFound()

  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('id, owner_id, plan_tier, generations_used')
    .eq('id', workspaceId)
    .eq('owner_id', userId)
    .single()

  if (error || !workspace || workspace.owner_id !== userId) return notFound()

  return { workspace: workspace as GuardedWorkspace, failure: null }
}

export type PersonaGuardResult<T> =
  | { persona: T; failure: null }
  | { persona: null; failure: NextResponse }

// Asserts the persona belongs to the given workspace. Must be called AFTER
// requireWorkspaceOwnership has vouched for the workspace — this function
// deliberately does not re-verify ownership, it only pins the persona to the
// already-trusted workspace. Skipping this step lets a caller mix their own
// workspace_id with a foreign persona_id, which matters because several
// write paths (GCS brand-DNA path, rag counts, rulebook history) are keyed
// by persona_id alone.
//
// `columns` defaults to the minimal 'id' existence check; callers that need
// more (approve needs active_rag_count, brand-dna needs display_name) pass
// their own projection and type parameter instead of forcing select('*') on
// everyone.
export async function requirePersonaInWorkspace<T = { id: string }>(
  supabase: ServerSupabase,
  workspaceId: string,
  personaId: unknown,
  columns = 'id',
): Promise<PersonaGuardResult<T>> {
  const notFound = () => ({
    persona: null,
    failure: NextResponse.json({ error: 'Persona not found in this workspace' }, { status: 404 }),
  })

  if (!isUuid(personaId)) return notFound()

  const { data: persona, error } = await supabase
    .from('personas')
    .select(columns)
    .eq('id', personaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (error || !persona) return notFound()

  return { persona: persona as T, failure: null }
}
