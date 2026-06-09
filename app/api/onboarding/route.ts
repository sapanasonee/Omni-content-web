import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { NextResponse } from 'next/server'
import type { OnboardingData, BrandDNA } from '@/lib/types'

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

export async function POST(request: Request) {
  try {
    // 1. Verify auth
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request body
    const data: OnboardingData = await request.json()

    // 3. Validate required fields
    if (!data.identity.full_name || !data.identity.role || !data.identity.industry) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 4. Create workspace in Supabase
    const workspaceName = `${data.identity.full_name}'s Workspace`
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .insert({
        owner_id: user.id,
        name: workspaceName,
        plan_tier: 'solo',
      })
      .select()
      .single()

    if (workspaceError) {
      console.error('Workspace creation error:', workspaceError)
      return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
    }

    // 5. Create default persona in Supabase
    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .insert({
        workspace_id: workspace.id,
        name: 'default',
        display_name: data.identity.full_name,
        active_rag_count: 0,
      })
      .select()
      .single()

    if (personaError) {
      console.error('Persona creation error:', personaError)
      await supabase.from('workspaces').delete().eq('id', workspace.id)
      return NextResponse.json({ error: 'Failed to create persona' }, { status: 500 })
    }

    // 6. Build brand DNA JSON
    const brandDNA: BrandDNA = {
      schema_version: '1.0',
      workspace_id: workspace.id,
      persona_id: persona.id,
      updated_at: new Date().toISOString(),
      sections: data,
    }

    // 7. Save to GCS
    const gcsPath = `workspaces/${workspace.id}/personas/${persona.id}/brand_dna.json`
    const bucket = getBucket()
    const file = bucket.file(gcsPath)
    await file.save(JSON.stringify(brandDNA, null, 2), {
      contentType: 'application/json',
      metadata: {
        workspace_id: workspace.id,
        persona_id: persona.id,
      },
    })

    // 8. Return success
    return NextResponse.json({
      success: true,
      workspace_id: workspace.id,
      persona_id: persona.id,
    })

  } catch (error) {
    console.error('Onboarding error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}