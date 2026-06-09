import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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
    const status = searchParams.get('status') || 'approved'
    const format = searchParams.get('format')
    const limit = parseInt(searchParams.get('limit') || '20')

    if (!workspace_id) {
      return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })
    }

    let query = supabase
      .from('content_pieces')
      .select('*')
      .eq('workspace_id', workspace_id)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (persona_id) query = query.eq('persona_id', persona_id)
    if (format) query = query.eq('format', format)

    const { data: items, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: items || [] })

  } catch (error) {
    console.error('Library error:', error)
    return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })
  }
}