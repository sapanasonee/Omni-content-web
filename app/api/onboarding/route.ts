import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { NextResponse } from 'next/server'
import type { BrandDNA } from '@/lib/types'
import { normalizeSections } from '@/lib/brand-dna-schema'
import { evaluateSignupEmail, isExemptExistingAccount } from '@/lib/signup-policy'
import { sendFounderAlert } from '@/lib/founder-alert'

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

    // 1b. Signup email policy — the authoritative gate for the early-access
    //     offer. This endpoint is where a bare auth user becomes a real
    //     account (workspace + free generation quota + 3 quota-exempt
    //     activation drafts), so it's the right choke point: blocking here
    //     means a disposable-inbox signup can never reach anything that
    //     costs money, while the magic-link auth user it created remains an
    //     inert row. Accounts created before the policy cutoff are exempt
    //     unconditionally (pre-existing testing accounts) — see
    //     lib/signup-policy.ts for the full reasoning and the fail-safe
    //     direction of the exemption.
    if (!isExemptExistingAccount(user.created_at)) {
      const verdict = evaluateSignupEmail(user.email || '')
      if (!verdict.allowed) {
        return NextResponse.json({ error: verdict.reason }, { status: 403 })
      }
    }

    // 2/3. Parse AND normalize the request body. This route is the primary
    //    creator of brand_dna.json, and it previously wrote the raw parsed
    //    JSON to GCS verbatim (`const data: OnboardingData = await
    //    request.json()` — a type assertion, not a runtime check). That left
    //    the primary write path LESS defended than the secondary /dna editing
    //    surface, which already normalized. Consequences of a malformed file:
    //    every generation prompt dereferences nested DNA fields without
    //    guards, so a missing `audience.segments` array 500s all generation
    //    for the persona — and since /dna also can't render a malformed file,
    //    the account is wedged with no self-service fix. Normalizing here
    //    (same shared allowlist coercion the PUT path uses) makes a
    //    well-shaped file a structural invariant of the system rather than a
    //    hope about client behavior. The old direct property access
    //    (`data.identity.full_name`) also threw on absent `identity`,
    //    turning bad requests into opaque 500s instead of 400s.
    const data = normalizeSections(await request.json())
    if (!data) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 4. Cap workspaces per account before creating another one.
    //
    // The generation quota (30/month on solo) is tracked PER WORKSPACE, and
    // this route would happily create a fresh workspace on every call — so an
    // authenticated user could mint unlimited workspaces and with them
    // unlimited free generations (plus 3 quota-exempt activation drafts
    // each). The cap turns that from "unlimited" into "bounded and small".
    //
    // Why 5 and not 1: re-running onboarding is a legitimate flow (the user
    // may want a fresh profile after a pivot, and existing test accounts have
    // done exactly that), and /api/me already resolves to the most recent
    // workspace, so older ones are inert rather than harmful.
    //
    // STOPGAP — this number is currently load-bearing for spend, and shouldn't
    // be. Because quota is tracked PER WORKSPACE, this cap is the only thing
    // bounding free generations per account: at 5 the ceiling is ~150/month,
    // which is exactly what /pricing sells as the paid Studio tier. That is
    // knowingly accepted for early access (there is no billing yet), but it
    // must be closed before the offer is publicized. The fix is to move the
    // quota counter to the ACCOUNT level so "how many voices" and "how much
    // you can generate" stop being the same dial — at which point this cap
    // goes back to being a pure abuse guard and can drop to 1-2.
    //
    // Multiple brand voices are NOT supposed to come from multiple workspaces
    // any more: that's what personas are for (POST /api/personas, capped by
    // PLAN_LIMITS.max_personas). Don't raise this again to add voices.
    const MAX_WORKSPACES_PER_USER = 5
    const { count: workspaceCount } = await supabase
      .from('workspaces')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)

    if ((workspaceCount ?? 0) >= MAX_WORKSPACES_PER_USER) {
      return NextResponse.json({
        error: 'Workspace limit reached for this account. Contact support if you need a reset.'
      }, { status: 403 })
    }

    // 5. Create workspace in Supabase
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

    // 6. Create default persona in Supabase
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

    // 7. Build brand DNA JSON
    const brandDNA: BrandDNA = {
      schema_version: '1.0',
      workspace_id: workspace.id,
      persona_id: persona.id,
      updated_at: new Date().toISOString(),
      sections: data,
    }

    // 8. Save to GCS
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

    // 9. Permanent new-user founder alert. This is the durable "genuinely new
    //    user" signal (a workspace was just created behind auth + the
    //    disposable-email gate) — distinct from the temporary every-login alert
    //    in /api/notify-signin, and NOT time-boxed. Best-effort and non-fatal:
    //    a mail failure must never fail an onboarding that already succeeded.
    await sendFounderAlert(
      `[Vowwl] New user onboarded — ${data.identity.full_name}`,
      `A new user just finished onboarding and has a live workspace.\n\n` +
        `Name:     ${data.identity.full_name}\n` +
        `Email:    ${user.email || '(unknown)'}\n` +
        `Role:     ${data.identity.role}\n` +
        `Industry: ${data.identity.industry}\n` +
        `Time:     ${new Date().toISOString()}\n`,
    )

    // 10. Return success
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