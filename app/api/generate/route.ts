import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { VertexAI } from '@google-cloud/vertexai'
import { NextResponse } from 'next/server'
import type { BrandDNA, ContentFormat } from '@/lib/types'

const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!)

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID!,
  location: 'us-central1',
})

const model = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
})

const FORMAT_INSTRUCTIONS: Record<ContentFormat, string> = {
  linkedin: 'LinkedIn post. Max 1300 characters. Short paragraphs. Max 4 hashtags at the end only. Start with a hook. End with insight or question.',
  twitter: 'Twitter/X post. Max 280 characters. One idea. Punchy and direct. No hashtags.',
  newsletter: 'Newsletter section. 300-600 words. Warm and conversational. Clear sections. End with a takeaway.',
  blog: 'Blog post. 600-1000 words. Clear H2 headings. Practical takeaways. Skimmable.',
  exec_brief: 'Executive brief. 200-400 words. Formal. Bullet points. Structure: Context, Key Points, Recommendation.',
}

const UNIVERSAL_GUARDRAILS = `
UNIVERSAL QUALITY GUARDRAILS — apply to every generation without exception:
- Never open with AI-pattern phrases: "In today's fast-paced world", "As we navigate", "In the ever-evolving"
- Never use parallel contrast: "It's not X, it's Y" or "This isn't X, this is Y"
- Never use dramatic reveal colons: "That's when it hit me:", "Here's the truth:"
- Never announce vulnerability before showing it: "I'll be honest", "If I'm being honest"
- Maximum one colon used for dramatic effect per piece
- Active voice always. Passive voice is an AI tell.
- Never add meta-commentary — output only the content itself
- No preamble. Start directly with the content.
`

export async function POST(request: Request) {
  try {
    // 1. Auth check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request
    const {
      workspace_id, persona_id, format, mode,
      topic, raw_input, description,
      tone_override, generation_mode
    } = await request.json()

    if (!workspace_id || !persona_id || !format) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 3. Check usage limit
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspace_id)
      .single()

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (workspace.plan_tier === 'solo' && workspace.generations_used >= 30) {
      return NextResponse.json({
        error: 'Monthly generation limit reached. Upgrade to Studio for more.'
      }, { status: 402 })
    }

    // 4. Load brand DNA from GCS
    const gcsPath = `workspaces/${workspace_id}/personas/${persona_id}/brand_dna.json`
    let brandDNA: BrandDNA | null = null

    try {
      const file = bucket.file(gcsPath)
      const [content] = await file.download()
      brandDNA = JSON.parse(content.toString())
    } catch {
      return NextResponse.json({
        error: 'Brand DNA not found. Please complete onboarding first.'
      }, { status: 404 })
    }

    // 5. Build system prompt
    const dna = brandDNA!.sections
    const systemPrompt = `You are a content writer for ${dna.identity.full_name}.

BRAND IDENTITY:
Role: ${dna.identity.role}
Industry: ${dna.identity.industry}

AUDIENCE:
${dna.audience.description}
Segments: ${dna.audience.segments.join(', ')}

VOICE:
${dna.voice.description}
Tones: ${dna.voice.tones.join(', ')}
Formality: ${dna.voice.formality}/5
Pace: ${dna.voice.pace}/5

GOOD EXAMPLE (study the patterns, not the words — never lift specific references):
${dna.examples.good}

${dna.examples.bad ? `AVOID THIS STYLE:\n${dna.examples.bad}` : ''}

AVOID RULES (hard stops):
${dna.avoid.join('\n')}

${UNIVERSAL_GUARDRAILS}

FORMAT: ${FORMAT_INSTRUCTIONS[format as ContentFormat]}

${tone_override ? `TONE OVERRIDE FOR THIS PIECE: ${tone_override}` : ''}

Write content that sounds exactly like ${dna.identity.full_name}. Not like AI. Not like a template. Like them.
Output only the final content — no preamble, no labels, just the content itself.`

    // 6. Build user prompt
    let userPrompt = ''
    if (mode === 'brief' && topic) {
      userPrompt = `Topic: ${topic}`
    } else if (mode === 'raw' && raw_input) {
      userPrompt = `Transform this raw input into polished content in my voice:\n\n${raw_input}`
    } else if (mode === 'describe' && description) {
      userPrompt = `Description: ${description}`
    } else {
      return NextResponse.json({ error: 'Invalid input mode' }, { status: 400 })
    }

    // 7. Generate with Vertex AI streaming
    const request_body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{
        role: 'user' as const,
        parts: [{ text: userPrompt }]
      }]
    }

    const streamingResult = await model.generateContentStream(request_body)

    // 8. Increment usage counter (fire and forget)
    supabase
      .from('workspaces')
      .update({ generations_used: workspace.generations_used + 1 })
      .eq('id', workspace_id)
      .then(() => {})

    // 9. Stream response and save draft
    const fullText: string[] = []
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamingResult.stream) {
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || ''
            if (text) {
              fullText.push(text)
              controller.enqueue(encoder.encode(text))
            }
          }

          // Save draft after streaming completes
          const body = fullText.join('')
          if (body) {
            await supabase.from('content_pieces').insert({
              workspace_id,
              persona_id,
              format,
              body,
              status: 'draft',
              topic: topic || description || 'Untitled',
              mode: mode,
              generation_mode: generation_mode || 'standard',
              rag_excluded: generation_mode === 'one_time',
            })
          }
        } catch (err) {
          console.error('Streaming error:', err)
        } finally {
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    })

  } catch (error) {
    console.error('Generate error:', error)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}