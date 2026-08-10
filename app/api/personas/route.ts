import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { NextResponse } from 'next/server'
import type { BrandDNA } from '@/lib/types'
import { planLimitsFor } from '@/lib/types'
import { normalizeSections } from '@/lib/brand-dna-schema'
import { requireWorkspaceOwnership } from '@/lib/auth-guard'

// ─── Brand voices ────────────────────────────────────────────────────────────
//
// A "brand voice" on /pricing is a PERSONA, not a workspace. The whole
// voice-learning stack is already persona-keyed — brand_dna.json lives at
// workspaces/{ws}/personas/{p}/, and RAG retrieval, the observed voice
// profile, and the edit rulebook all scope by persona_id — so adding a voice
// means adding a persona inside the workspace the user already has.
//
// This route exists because before it, the ONLY way to get a second voice was
// to run onboarding again, which minted a whole new WORKSPACE. That conflated
// voices with tenancy and, because the generation quota is per-workspace, made
// every extra voice also an extra free quota bucket. Creating personas here
// keeps voices on one workspace and one quota.
//
// Tenancy note: personas are scoped to a workspace, so isolation between
// voices is a property of the persona_id in every downstream query and GCS
// path — NOT of the workspace boundary. Anything added later that reads across
// personas (an aggregate library view, cross-voice analytics) must keep
// filtering by persona_id or voices will bleed into each other.
// ─────────────────────────────────────────────────────────────────────────────

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

// GET: list the voices in a workspace, plus how many more this tier allows.
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspace_id = searchParams.get('workspace_id')
    if (!workspace_id) {
      return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })
    }

    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure

    const { data: personas } = await supabase
      .from('personas')
      .select('id, workspace_id, name, display_name, active_rag_count, created_at')
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: true })

    const limits = planLimitsFor(wsGuard.workspace.plan_tier)
    const used = personas?.length ?? 0

    return NextResponse.json({
      personas: personas || [],
      max_personas: limits.max_personas === Infinity ? null : limits.max_personas,
      can_add: used < limits.max_personas,
    })
  } catch (error) {
    console.error('Personas GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: add a brand voice (persona + its brand_dna.json) to an existing
// workspace. Mirrors the persona half of /api/onboarding, minus workspace
// creation and minus the signup-email gate (that gate belongs at account
// creation; this caller already has a workspace, so they already passed it).
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspace_id, sections: rawSections } = await request.json()
    if (!workspace_id) {
      return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })
    }

    // Same normalizer as both other Brand DNA write paths. brand_dna.json is
    // interpolated into every generation/critic/topics prompt, so a third
    // write path that skipped this would reintroduce exactly the malformed-DNA
    // failure lib/brand-dna-schema.ts exists to make structurally impossible.
    const sections = normalizeSections(rawSections)
    if (!sections) {
      return NextResponse.json({ error: 'Name, role and industry are required' }, { status: 400 })
    }

    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const workspace = wsGuard.workspace

    // Tier cap on voices. Counted with a HEAD count rather than from a fetched
    // list so the check reads the current row count at call time.
    //
    // This is a check-then-insert race in principle: two concurrent POSTs can
    // both observe count = limit - 1 and both insert. That is accepted here —
    // unlike the generation quota (which reserves atomically via an RPC
    // because it maps to real per-call spend), an extra persona costs nothing
    // recurring and is trivially deleted. Make this atomic only if personas
    // ever gain per-seat billing.
    const limits = planLimitsFor(workspace.plan_tier)
    const { count: personaCount } = await supabase
      .from('personas')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)

    if ((personaCount ?? 0) >= limits.max_personas) {
      return NextResponse.json({
        error: limits.max_personas === 1
          ? 'Your plan includes one brand voice. Upgrade to Studio to manage up to 5.'
          : `You've used all ${limits.max_personas} brand voices on your plan.`,
        code: 'voice_limit_reached',
        max_personas: limits.max_personas,
      }, { status: 403 })
    }

    const displayName = sections.identity.full_name

    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .insert({
        workspace_id,
        // `name` is the stable internal slug; onboarding's first persona uses
        // 'default'. Derive subsequent ones from the display name so they're
        // legible in the SQL editor, with a timestamp suffix for uniqueness
        // (no unique constraint exists on (workspace_id, name), so this is for
        // human readability, not correctness).
        name: `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'voice'}-${Date.now().toString(36)}`,
        display_name: displayName,
        active_rag_count: 0,
      })
      .select()
      .single()

    if (personaError) {
      console.error('Persona creation error:', personaError)
      return NextResponse.json({ error: 'Failed to create brand voice' }, { status: 500 })
    }

    const brandDNA: BrandDNA = {
      schema_version: '1.0',
      workspace_id,
      persona_id: persona.id,
      updated_at: new Date().toISOString(),
      sections,
    }

    try {
      await getBucket()
        .file(`workspaces/${workspace_id}/personas/${persona.id}/brand_dna.json`)
        .save(JSON.stringify(brandDNA, null, 2), {
          contentType: 'application/json',
          metadata: { workspace_id, persona_id: persona.id },
        })
    } catch (storageError) {
      // A persona with no DNA file is a wedged voice: /dna renders its empty
      // state and generation has nothing to build a prompt from. Roll the row
      // back so a retry starts clean, matching how /api/onboarding deletes the
      // workspace when persona creation fails.
      console.error('Brand DNA write failed, rolling back persona:', storageError)
      await supabase.from('personas').delete().eq('id', persona.id)
      return NextResponse.json({ error: 'Failed to save brand voice' }, { status: 500 })
    }

    // Switch to the new voice immediately — creating one is an explicit act of
    // intent to use it, and landing back on the previous voice would be a
    // confusing no-op. Non-fatal: the voice exists and is selectable from the
    // sidebar even if this write fails.
    const { error: activeError } = await supabase
      .from('workspaces')
      .update({ active_persona_id: persona.id })
      .eq('id', workspace_id)
      .eq('owner_id', user.id)

    if (activeError) {
      console.warn('Could not set active persona after create:', activeError.message)
    }

    return NextResponse.json({
      success: true,
      workspace_id,
      persona_id: persona.id,
      display_name: persona.display_name,
    })
  } catch (error) {
    console.error('Personas POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
