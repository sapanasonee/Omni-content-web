import Link from 'next/link'
import Hero from '@/components/marketing/Hero'

const FEATURES = [
  {
    title: 'Voice-first onboarding',
    body: 'Talk for 2 minutes about what you believe. Vowwl builds your brand profile from it, no forms-first friction.',
  },
  {
    title: 'Trending in your niche',
    body: 'Five current topics a day, filtered through your audience and beat. Each comes with an angle you can make yours. No more blank page.',
  },
  {
    title: 'A voice check on every draft',
    body: 'Every piece is judged against your own brand rules before you see it: AI-pattern phrases stripped, unsourced claims flagged, voice drift corrected.',
  },
  {
    title: 'Learns from your edits',
    body: "Cut the same phrase three times and Vowwl notices: “Make it a rule?” One tap, and every future draft follows it.",
  },
  {
    title: 'Approval is memory',
    body: 'Every piece you approve becomes an example of how you write. Draft ten reads more like you than draft one.',
  },
  {
    title: 'Your rules, standing',
    body: 'Hard rules that nothing can override, campaign context for series, one-time instructions for a single piece.',
  },
]

const STEPS = [
  {
    n: '1',
    title: 'Say who you are',
    body: 'Answer one question out loud: what do most people in your space get wrong? Vowwl drafts your profile from your own words.',
  },
  {
    n: '2',
    title: 'Get three drafts instantly',
    body: 'Before onboarding even ends, your first three pieces are waiting, grounded in what you just said, in your voice.',
  },
  {
    n: '3',
    title: 'Approve, edit, sharpen',
    body: 'Everything you approve teaches it how you write. Everything you edit teaches it what to stop doing.',
  },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* Nav */}
      <nav className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#534AB7] rounded-lg" />
          <span className="text-sm font-bold">Vowwl</span>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href="/pricing"
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </nav>

      <Hero />

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-gray-100">
        <h2 className="text-sm font-semibold text-[#534AB7] uppercase tracking-wide text-center mb-10">
          How it works
        </h2>
        <div className="grid sm:grid-cols-3 gap-8">
          {STEPS.map(step => (
            <div key={step.n} className="text-center sm:text-left">
              <div className="w-8 h-8 bg-[#EEEDFE] text-[#534AB7] rounded-lg flex items-center justify-center text-sm font-bold mx-auto sm:mx-0 mb-3">
                {step.n}
              </div>
              <h3 className="text-sm font-semibold mb-1.5">{step.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The wedge */}
      <section className="bg-[#FAFAFF] border-y border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <p className="text-xl sm:text-2xl font-medium leading-relaxed text-gray-800">
            Every AI writing tool can produce content.
            <br />
            <span className="text-[#534AB7]">
              Vowwl is built to produce <em>you</em>:
            </span>{' '}
            your openers, your convictions, your rules about what never to say.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <div key={f.title} className="p-5 border border-gray-100 rounded-xl">
              <h3 className="text-sm font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <h2 className="text-2xl font-bold mb-3">Your voice is the moat.</h2>
        <p className="text-sm text-gray-500 mb-6">
          Two minutes of talking, three drafts that sound like you. See it yourself.
        </p>
        <Link
          href="/login"
          className="inline-block px-6 py-3 bg-[#534AB7] text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Start free →
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-[#534AB7] rounded-md" />
            <span className="text-xs font-semibold text-gray-700">Vowwl</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Pricing
            </Link>
            <p className="text-xs text-gray-400">© {new Date().getFullYear()} Vowwl · vowwl.com</p>
          </div>
        </div>
      </footer>

    </div>
  )
}
