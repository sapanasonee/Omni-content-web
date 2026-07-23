'use client'

import { useState } from 'react'
import Link from 'next/link'

type Persona = 'founder' | 'corporate'
type Channel = 'linkedin' | 'twitter' | 'newsletter'

const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'linkedin', label: 'LinkedIn Post' },
  { id: 'twitter', label: 'X / Twitter Thread' },
  { id: 'newsletter', label: 'Newsletter Draft' },
]

const PREVIEWS: Record<Persona, Record<Channel, string>> = {
  founder: {
    linkedin: `Our MRR grew 40% this quarter. Not because we landed one big client, but because I stopped hiring senior VPs too early.\n\nHere's the counterintuitive lesson six months of hiring mistakes taught me...`,
    twitter: `1/ We almost ran out of runway in month 4.\n\nHere's exactly what we changed, and why most founders fix the wrong thing first 🧵`,
    newsletter: `This month: the growth metric I stopped tracking (and the one that actually predicts churn six weeks out).`,
  },
  corporate: {
    linkedin: `Great product strategy isn't about saying yes to more features.\n\nIt's about the roadmap items you have the discipline to kill. Here's how we decide what doesn't ship.`,
    twitter: `1/ Most "AI strategy" decks are the same 12 slides with a different logo.\n\nHere's what actually separates the teams shipping real outcomes 🧵`,
    newsletter: `This quarter: why your best engineers are quietly disengaging, and the org design fix nobody's talking about.`,
  },
}

export default function Hero() {
  const [persona, setPersona] = useState<Persona>('founder')
  const [channel, setChannel] = useState<Channel>('linkedin')

  return (
    <header className="max-w-6xl mx-auto px-6 pt-20 pb-16">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div className="text-center lg:text-left">
          <p className="text-xs font-mono font-semibold text-[#534AB7] uppercase tracking-widest mb-4">
            The content engine for founders, directors, and future consultants
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
            Your strategic insights.<br />Polished in 2 minutes.
          </h1>
          <p className="mt-5 text-lg text-gray-500 max-w-xl mx-auto lg:mx-0">
            Stop wasting hours trying to prompt generic AI tools. Give us 2 minutes of your
            voice to map your unique Brand DNA. Vowwl builds your personalized content
            engine, mapping out ideas and writing high-impact posts that look, feel, and
            sound authentic to you.
          </p>

          <div className="mt-8 flex items-center justify-center lg:justify-start gap-4">
            <Link
              href="/login"
              className="px-6 py-3 bg-[#534AB7] text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Start building your brand for free →
            </Link>
          </div>

          <div className="mt-6 flex items-center justify-center lg:justify-start gap-2">
            <button
              type="button"
              onClick={() => setPersona('founder')}
              aria-pressed={persona === 'founder'}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                persona === 'founder'
                  ? 'bg-[#534AB7] text-white border-[#534AB7]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              I am a Founder
            </button>
            <button
              type="button"
              onClick={() => setPersona('corporate')}
              aria-pressed={persona === 'corporate'}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                persona === 'corporate'
                  ? 'bg-[#534AB7] text-white border-[#534AB7]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              I am a Corporate Leader
            </button>
          </div>

          <p className="mt-4 text-xs text-gray-400 text-center lg:text-left">
            Magic-link sign in · 30 free pieces a month · no credit card
          </p>
          <p className="mt-4 text-sm text-gray-500 text-center lg:text-left">
            Want a personal walkthrough instead?{' '}
            <a
              href="https://calendly.com/sonisapna45/30min"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#534AB7] font-medium hover:opacity-80 transition-opacity underline underline-offset-2"
            >
              Book time with me
            </a>
          </p>
        </div>

        {/* 3-step pipeline: setup -> brand DNA -> distribution */}
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="text-[11px] font-mono uppercase tracking-wide text-[#534AB7] font-semibold mb-2">
              Step 1 · Onboarding
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xl" aria-hidden="true">🎙️</span>
              <span className="text-sm font-medium text-gray-800">2-Minute Voice Setup</span>
              <span className="ml-auto inline-flex items-end gap-[2px] h-3" aria-hidden="true">
                {[40, 100, 60, 85, 50].map((h, i) => (
                  <span
                    key={i}
                    className="w-[2px] bg-[#534AB7] rounded-full"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </span>
            </div>
          </div>

          <div className="flex justify-center" aria-hidden="true">
            <div className="w-px h-6 bg-gray-200" />
          </div>

          <div className="bg-[#FAFAFF] border border-[#534AB7]/20 rounded-2xl p-5">
            <div className="text-[11px] font-mono uppercase tracking-wide text-[#534AB7] font-semibold mb-3">
              Step 2 · The Core Engine
            </div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl" aria-hidden="true">🧬</span>
              <span className="text-sm font-semibold text-gray-800">Brand DNA Generated</span>
            </div>
            <ul className="space-y-1.5">
              <li className="text-xs text-gray-600 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-[#534AB7]" />
                Tone: Bold &amp; Analytical
              </li>
              <li className="text-xs text-gray-600 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-[#534AB7]" />
                Target Audience Mapped
              </li>
              <li className="text-xs text-gray-600 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-[#534AB7]" />
                20+ Custom Ideas Mapped
              </li>
            </ul>
          </div>

          <div className="flex justify-center" aria-hidden="true">
            <div className="w-px h-6 bg-gray-200" />
          </div>

          <div className="bg-white border border-gray-300 rounded-2xl p-5 shadow-md shadow-gray-100">
            <div className="text-[11px] font-mono uppercase tracking-wide text-gray-400 mb-3">
              Step 3 · Distribution
            </div>
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannel(c.id)}
                  aria-pressed={channel === c.id}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    channel === c.id
                      ? 'bg-[#534AB7] text-white border-[#534AB7]'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
              {PREVIEWS[persona][channel]}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
