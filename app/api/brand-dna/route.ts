import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { NextResponse } from 'next/server'
import type { BrandDNA, OnboardingData } from '@/lib/types'

// Brand DNA lives in GCS (brand_dna.json) — the copy generation actually reads.
// This route is the single editing surface for it. (personas.brand_dna in
// Supabase was never written by anything and is not used here.)

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

function dnaPath(workspace_id: string, persona_id: string) {
  return `workspaces/${workspace_id}/personas/${persona_id}/brand_dna.json`
}

async function verifyPersona(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspace_id: string,
  persona_id: string,
) {
  const { data: persona } = await supabase
    .from('personas')
    .select('id, display_name')
    .eq('id', persona_id)
    .eq('workspace_id', workspace_id)
    .single()
  return persona
}

// GET: read brand DNA for a persona
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspace_id = searchParams.get('workspace_id')
    const persona_id = searchParams.get('persona_id')

    if (!workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing workspace_id or persona_id' }, { status: 400 })
    }

    const persona = await verifyPersona(supabase, workspace_id, persona_id)
    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    let sections: OnboardingData | null = null
    try {
      const [content] = await getBucket().file(dnaPath(workspace_id, persona_id)).download()
      const dna: BrandDNA = JSON.parse(content.toString())
      sections = dna.sections
    } catch {
      // No file yet — the page shows its "complete onboarding" empty state.
    }

    return NextResponse.json({
      display_name: persona.display_name,
      brand_dna: sections,
    })
  } catch (error) {
    console.error('Brand DNA GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Coerce client-sent sections into a clean OnboardingData shape so a buggy or
// malicious client can't write arbitrary structure into the DNA file the
// generation prompts interpolate from.
function normalizeSections(raw: unknown): OnboardingData | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, Record<string, unknown>> & { topics?: unknown; avoid?: unknown }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const strArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : []
  const scale = (v: unknown) => {
    const n = typeof v === 'number' ? Math.round(v) : 3
    return Math.min(5, Math.max(1, n))
  }

  const sections: OnboardingData = {
    identity: {
      full_name: str(s.identity?.full_name),
      role: str(s.identity?.role),
      industry: str(s.identity?.industry),
    },
    audience: {
      description: str(s.audience?.description),
      segments: strArray(s.audience?.segments),
    },
    voice: {
      description: str(s.voice?.description),
      tones: strArray(s.voice?.tones),
      formality: scale(s.voice?.formality),
      pace: scale(s.voice?.pace),
    },
    examples: {
      good: str(s.examples?.good),
      bad: str(s.examples?.bad),
    },
    topics: strArray(s.topics),
    voice_sample_transcript: str((s as Record<string, unknown>).voice_sample_transcript),
    avoid: strArray(s.avoid),
    formats: {
      preferred: strArray(s.formats?.preferred),
      cadence: str(s.formats?.cadence),
    },
  }

  if (!sections.identity.full_name || !sections.identity.role || !sections.identity.industry) {
    return null
  }
  return sections
}

// PUT: update brand DNA for a persona
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspace_id, persona_id, sections: rawSections } = await request.json()
    if (!workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing workspace_id or persona_id' }, { status: 400 })
    }

    const sections = normalizeSections(rawSections)
    if (!sections) {
      return NextResponse.json({ error: 'Name, role and industry are required' }, { status: 400 })
    }

    const persona = await verifyPersona(supabase, workspace_id, persona_id)
    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Preserve the envelope of the existing file where present.
    const file = getBucket().file(dnaPath(workspace_id, persona_id))
    let schema_version = '1.0'
    try {
      const [content] = await file.download()
      const existing: BrandDNA = JSON.parse(content.toString())
      if (existing.schema_version) schema_version = existing.schema_version
    } catch {
      // First write for this persona — fresh envelope.
    }

    const dna: BrandDNA = {
      schema_version,
      workspace_id,
      persona_id,
      updated_at: new Date().toISOString(),
      sections,
    }

    await file.save(JSON.stringify(dna, null, 2), {
      contentType: 'application/json',
      metadata: { workspace_id, persona_id },
    })

    return NextResponse.json({ success: true, brand_dna: sections })
  } catch (error) {
    console.error('Brand DNA PUT error:', error)
    return NextResponse.json({ error: 'Failed to save Brand DNA' }, { status: 500 })
  }
}
