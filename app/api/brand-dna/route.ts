import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET: read brand DNA for a persona
// Query params: workspace_id, persona_id
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

    const { data: persona, error } = await supabase
      .from('personas')
      .select('id, display_name, brand_dna')
      .eq('id', persona_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (error || !persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    return NextResponse.json({
      display_name: persona.display_name,
      brand_dna: persona.brand_dna,  // null if not yet populated
    })
  } catch (error) {
    console.error('Brand DNA GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
