# Omni Content Agent — Web Frontend

Next.js 14 frontend for **Omni Content Agent**, a multi-agent content generation platform built on Google's Agent Development Kit (ADK). This repo is the user-facing application; the ADK multi-agent backend lives in [`omni-content-agent`](https://github.com/sapanasonee/omni-content-agent).

## 🔗 Live Demo

**Try it now:** https://omni-content-web-441385652994.us-central1.run.app

No installation required. Sign in with any email — you'll receive a magic link from Supabase.

## What It Does

Founders and creators define their **Brand DNA** (voice, tone, topics, audience, what to avoid) in a 6-step onboarding. Every piece of content generated is grounded in this brand context via persona-scoped RAG on Vertex AI Search. Approved pieces are re-indexed back into the RAG store, so the system gets sharper with every use.

Supported formats: LinkedIn, Twitter, Newsletter, Blog, Exec Brief.

## Testing Instructions (For Judges)

1. Open the [live demo](https://omni-content-web-441385652994.us-central1.run.app) in an incognito window
2. Enter any email address — a magic link will be sent via Supabase
3. Click the magic link to log in
4. Complete the 6-step **Brand DNA** onboarding (takes ~2 minutes)
5. Navigate to **Generate**, pick a platform (e.g. LinkedIn), pick an input mode (Brief), and write a topic
6. Click **Generate** — content streams in, grounded in your brand context
7. Click **Approve** — the piece is indexed into Vertex AI Search and appears in **Library**
8. Generate a second piece and observe how it learns from approved content

## Architecture

```
User → Next.js Frontend (this repo, Cloud Run)
         ↓
       ADK Backend (omni-content-agent, Cloud Run)
         ↓
     ┌─── Orchestrator Agent
     ├─── Brand DNA Agent ──→ Vertex AI Search (private RAG, persona-scoped)
     ├─── Research Agent ───→ Google Search (live grounding via ADK tool)
     └─── Content Agent ────→ Gemini 2.5 Flash (synthesizes + critic check)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Auth | Supabase (magic link) |
| Database | Supabase Postgres |
| Storage | Google Cloud Storage |
| RAG | Vertex AI Search with persona-scoped filters |
| LLM | Gemini 2.5 Flash via Vertex AI |
| Hosting | Google Cloud Run |

## Key Routes

- `app/onboarding/page.tsx` — 6-step Brand DNA wizard
- `app/(dashboard)/generate/page.tsx` — generation UI with streaming + approve flow
- `app/(dashboard)/library/page.tsx` — approved content library
- `app/api/generate/route.ts` — Vertex AI streaming with `__META__` content-piece-id handoff
- `app/api/approve/route.ts` — critic check → GCS write → Vertex AI Search indexing

## Local Development

Requires Node.js 20+, a Supabase project, and a GCP project with Vertex AI and Cloud Storage enabled.

```bash
npm install
cp .env.example .env.local   # fill in Supabase + GCP credentials
npm run dev
```

App runs at `http://localhost:3002`.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GCP_PROJECT_ID=
GCS_BUCKET_NAME=
NEXT_PUBLIC_ADK_URL=
NEXT_PUBLIC_APP_URL=
```

## Submitted to

Google for Startups AI Challenge — June 2026