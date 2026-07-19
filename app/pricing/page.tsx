import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing — Vowwl',
  description:
    'Free during early access. Founding members lock in their rate before public pricing.',
}

// ─── Honesty constraints (read before editing this page) ─────────────────────
// No billing exists yet (no Stripe, no enforcement beyond the solo generation
// cap) — so this page must never present a paid tier as purchasable today.
// Anything not live is labeled "coming"/waitlist and routes to the Calendly
// conversation, not a buy button. The founding-member promise (free during
// early access + locked-in rate at launch) is the deliberate scarcity answer
// from CLAUDE.md that needs no billing infrastructure to be true.
//
// PLANNED_* prices are PLACEHOLDERS pending a real pricing decision — change
// them here, they appear nowhere else.
// ─────────────────────────────────────────────────────────────────────────────
const PLANNED_STUDIO_PRICE = '$29'
const CALENDLY_URL = 'https://calendly.com/sonisapna45/30min'

const TIERS = [
  {
    name: 'Founding member',
    badge: 'Available now',
    live: true,
    price: 'Free',
    priceNote: 'during early access — no credit card',
    blurb:
      'Everything Vowwl does today, free while we build it with our first founders.',
    features: [
      '30 pieces a month — posts, newsletters, comments',
      '1 brand voice, learned from you',
      'Voice-first onboarding + 3 instant drafts',
      'Brand memory: every approval teaches it',
      'Voice check on every draft',
      'Learns your rules from your edits and rejections',
      'Trending topics in your niche',
      'Comments in your voice on any post',
    ],
    cta: { label: 'Start free →', href: '/login', external: false },
    footnote: 'Founding members keep a locked-in rate when paid plans launch.',
  },
  {
    name: 'Studio',
    badge: 'Coming soon',
    live: false,
    price: PLANNED_STUDIO_PRICE,
    priceNote: '/month · planned launch pricing',
    blurb:
      'For creators running more than one voice — or posting daily across platforms.',
    features: [
      '150 pieces a month',
      'Up to 5 brand voices',
      'Unlimited brand memory',
      'Everything in Founding member',
    ],
    cta: { label: 'Get on the list', href: CALENDLY_URL, external: true },
    footnote: 'Join free today — founding members get first access at a locked-in rate.',
  },
  {
    name: 'Agency',
    badge: 'Planned',
    live: false,
    price: "Let's talk",
    priceNote: 'shaped with early agency partners',
    blurb:
      'Ghostwriters and agencies managing many client voices that must never blur.',
    features: [
      'Unlimited pieces',
      'Unlimited client voices, strictly isolated',
      'Client workspaces',
      'Everything in Studio',
    ],
    cta: { label: 'Talk to us', href: CALENDLY_URL, external: true },
    footnote: 'Building this with a handful of agencies — want to shape it?',
  },
]

const FAQS = [
  {
    q: 'Is it actually free?',
    a: 'Yes. During early access, everything Vowwl does today is free — 30 pieces a month, no credit card, no trial clock. We want your feedback and your edits (that\'s literally how the product learns), not your card number.',
  },
  {
    q: 'What happens when paid plans launch?',
    a: "Founding members keep what they have and lock in a founding rate that won't go up. You'll never be silently moved to a paid plan — pricing changes will be announced, and you choose.",
  },
  {
    q: 'What counts as a piece?',
    a: 'One generation: a LinkedIn post, a tweet, a newsletter section, a blog draft, or a set of comment options. Editing, approving, and re-reading your library are always free.',
  },
  {
    q: 'Does my content train some shared model?',
    a: 'No. Your voice profile, your examples, and your rules live in your workspace and shape your generations only. Nothing you write or approve is used for anyone else.',
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* Nav */}
      <nav className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#534AB7] rounded-lg" />
          <span className="text-sm font-bold">Vowwl</span>
        </Link>
        <div className="flex items-center gap-5">
          <span className="text-sm text-gray-900 font-medium">Pricing</span>
          <Link
            href="/login"
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Header */}
      <section className="max-w-3xl mx-auto px-6 pt-12 pb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">
          Free while we earn your voice.
        </h1>
        <p className="text-sm text-gray-500 max-w-xl mx-auto leading-relaxed">
          Vowwl is in early access. Founding members get everything free today and a
          locked-in rate when paid plans launch — because the product is only as good
          as the founders teaching it.
        </p>
      </section>

      {/* Tiers */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-5">
          {TIERS.map(tier => (
            <div
              key={tier.name}
              className={
                tier.live
                  ? 'rounded-2xl border-2 border-[#534AB7] p-6 flex flex-col relative bg-[#FAFAFF]'
                  : 'rounded-2xl border border-gray-200 p-6 flex flex-col'
              }
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold">{tier.name}</h2>
                <span
                  className={
                    tier.live
                      ? 'px-2.5 py-1 bg-[#534AB7] text-white rounded-full text-[11px] font-medium'
                      : 'px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full text-[11px] font-medium'
                  }
                >
                  {tier.badge}
                </span>
              </div>

              <div className="mb-1">
                <span className="text-3xl font-bold">{tier.price}</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">{tier.priceNote}</p>

              <p className="text-sm text-gray-600 leading-relaxed mb-5">{tier.blurb}</p>

              <ul className="space-y-2 mb-6 flex-1">
                {tier.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-[#534AB7] mt-0.5 flex-shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {tier.cta.external ? (
                <a
                  href={tier.cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:border-gray-400 transition-colors"
                >
                  {tier.cta.label}
                </a>
              ) : (
                <Link
                  href={tier.cta.href}
                  className="block text-center px-5 py-2.5 bg-[#534AB7] text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {tier.cta.label}
                </Link>
              )}
              <p className="text-xs text-gray-400 mt-3 text-center">{tier.footnote}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why free */}
      <section className="bg-[#FAFAFF] border-y border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-14 text-center">
          <p className="text-lg sm:text-xl font-medium leading-relaxed text-gray-800">
            Why free? Because Vowwl learns from the founders who use it.
            <br />
            <span className="text-[#534AB7]">
              Your edits and your rules make the product
            </span>{' '}
            — early access is the trade, and founding members keep the upside.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <h2 className="text-sm font-semibold text-[#534AB7] uppercase tracking-wide text-center mb-8">
          Questions, answered straight
        </h2>
        <div className="space-y-6">
          {FAQS.map(faq => (
            <div key={faq.q} className="border border-gray-100 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-1.5">{faq.q}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <h2 className="text-2xl font-bold mb-3">Sound like you, from piece one.</h2>
        <p className="text-sm text-gray-500 mb-6">
          Two minutes of talking, three drafts in your voice. Free while in early access.
        </p>
        <Link
          href="/login"
          className="inline-block px-6 py-3 bg-[#534AB7] text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Start free →
        </Link>
        <p className="mt-4 text-sm text-gray-500">
          Prefer a walkthrough first?{' '}
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#534AB7] font-medium hover:opacity-80 transition-opacity underline underline-offset-2"
          >
            Book time with me
          </a>
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-5 h-5 bg-[#534AB7] rounded-md" />
            <span className="text-xs font-semibold text-gray-700">Vowwl</span>
          </Link>
          <p className="text-xs text-gray-400">© {new Date().getFullYear()} Vowwl · vowwl.com</p>
        </div>
      </footer>

    </div>
  )
}
