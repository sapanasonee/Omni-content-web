// Vowwl one-page site: an archivist/editor for a senior consultant's track
// record (fractional execs, growth/turnaround advisors, coaches with 15-30+
// years in). Replaces the earlier "proof capture for technical services
// firms" pitch entirely — different audience, different problem, different
// offer. Markup is new; styles live in app/site.css.
//
// Apostrophes are written as &apos; only because React's lint rule rejects
// raw ' in JSX text; they render identically.

// ---- Contact links: the only values expected to change -------------------
// Owner's Calendly booking page — the single CTA destination everywhere on
// the page (topbar, hero, final CTA all point here; nothing else competes).
const BOOK_CALL_URL = "https://calendly.com/sonisapna45/30min";
const LINKEDIN_URL = "https://www.linkedin.com/in/sapana-sonee";

export default function Home() {
  return (
    <>
      {/* Top bar */}
      <div className="topbar">
        <div className="wrap">
          <a href="#top" className="brand">Vowwl</a>
          <a href={BOOK_CALL_URL} className="nav-cta" target="_blank" rel="noopener">Book a call</a>
        </div>
      </div>

      {/* Hero — names the gap quietly. The bold claim belongs to "How it works" below. */}
      <header className="hero" id="top">
        <div className="wrap">
          <div className="hero-kicker">For consultants and fractional executives with real track records.</div>
          <h1>Your network sees a fraction of what you&apos;ve actually done.</h1>
          <p className="hero-sub">
            Twenty-plus years of judgment, and most of it never left the room it happened in.
          </p>
          <div className="hero-actions">
            <a href={BOOK_CALL_URL} className="btn-primary" target="_blank" rel="noopener">Book a 15-minute call</a>
            <a href="#how" className="btn-text">See how it works</a>
          </div>
        </div>
      </header>

      {/* The problem, in their words — opens the pain before the mechanic answers it */}
      <section className="problem" id="problem">
        <div className="wrap">
          <h2 className="section-title">You didn&apos;t go quiet because you ran out of things to say.</h2>
          <div className="problem-list">
            <p>You&apos;ve solved the same problem so many times that your sharpest instinct doesn&apos;t register as insight anymore. It&apos;s just how you think now. You don&apos;t mention it — not because it&apos;s small, but because to you, it stopped being news a decade ago.</p>
            <p>Writing about your own wins feels like something else entirely. Not pride — just beneath you, somehow. So you stay quiet, and the market slowly resets its idea of what you&apos;re capable of, because nothing reminds them.</p>
            <p>You think clearly out loud, in a room, in real time. Put the same thought in writing and it comes out flat — a slide version of something that was alive five minutes ago. So most of it never gets written down at all.</p>
            <p>And somewhere in the last few years, you became the most senior person in every room you&apos;re in. Useful for your clients. Quieter for you — there&apos;s no one left to push back on your thinking the way you used to push back on others&apos;.</p>
          </div>
          <p className="problem-close">None of that means the experience isn&apos;t there. It means no one&apos;s caught it yet.</p>
        </div>
      </section>

      {/* The reframe — archivist framing, bridges the problem into the mechanic */}
      <section className="reframe">
        <div className="wrap">
          <p className="reframe-statement">We don&apos;t generate your opinions. We surface them.</p>
          <p className="reframe-body">
            You already have the point of view — earned over twenty-plus years of actually being in the room.
            Our job isn&apos;t to invent one for you. It&apos;s to notice the one you already have, and shape it
            into something good enough to carry your name.
          </p>
        </div>
      </section>

      {/* How it works — copy is verbatim per brief. Single vertical column, no cards, no icons. */}
      <section className="how" id="how">
        <div className="wrap">
          <h2 className="how-title">
            You already said the valuable thing.<br />
            You just said it in a meeting — not on LinkedIn.
          </h2>
          <p className="how-sub">
            Your experience doesn&apos;t need more effort from you. It needs someone to catch it and shape it.
            Here&apos;s the whole of it:
          </p>

          <div className="steps">
            <div className="step">
              <div className="step-num">01</div>
              <div>
                <h3>We talk. Once a month.</h3>
                <p>A real conversation with someone who knows your world — not a form, not a voice note. You walk through actual situations: the deal that nearly died, the call you&apos;d make differently now. That&apos;s the entire ask on your time.</p>
              </div>
            </div>
            <div className="step">
              <div className="step-num">02</div>
              <div>
                <h3>We find what&apos;s worth saying.</h3>
                <p>The part you can&apos;t do for yourself, because you&apos;re too close to it. We catch the story you&apos;d have dismissed as obvious, and shape it in your voice, from your own material — fewer, sharper pieces, signal over volume.</p>
              </div>
            </div>
            <div className="step">
              <div className="step-num">03</div>
              <div>
                <h3>Nothing goes out without your yes.</h3>
                <p>You see every piece before it&apos;s live and kill anything that isn&apos;t you. Decades of reputation, kept entirely in your hands. Your name, your call, every time.</p>
              </div>
            </div>
          </div>

          <p className="how-close">
            No dashboard. No content calendar. No homework. One conversation a month, and a body of work
            that sounds like you at your sharpest.
          </p>
        </div>
      </section>

      {/* Offer — pilot / founding-client framing, deliberately no price */}
      <section className="offer" id="offer">
        <div className="wrap">
          <h2 className="section-title">We&apos;re taking on a small number of founding clients.</h2>
          <p className="section-intro">
            Not because of what it costs — there&apos;s no rate card to point you to yet. This only works with
            real attention, and real attention doesn&apos;t scale past a handful of people at a time. If that
            sounds like a fit, the next step is a conversation, not a form.
          </p>
        </div>
      </section>

      {/* Social proof — placeholder until the first founding clients have something to show */}
      <section className="proof" id="proof">
        <div className="wrap">
          <div className="proof-label">What clients say</div>
          <p className="proof-body">
            The first founding clients are still in month one. Their names and their own words will go
            here once there&apos;s something real to show — not before.
          </p>
        </div>
      </section>

      {/* Final CTA — same single action as the hero */}
      <section className="cta" id="contact">
        <div className="wrap">
          <h2>If this sounds like your week, let&apos;s talk.</h2>
          <p>One conversation. No pitch deck, no onboarding call, no commitment beyond the fifteen minutes.</p>
          <div className="cta-actions">
            <a href={BOOK_CALL_URL} className="btn-primary" target="_blank" rel="noopener">Book a 15-minute call</a>
            <a href={LINKEDIN_URL} className="btn-text" target="_blank" rel="noopener">Connect on LinkedIn</a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="wrap">
          <span>Vowwl — for the track record you haven&apos;t written down yet.</span>
          <span>Built by <a href={LINKEDIN_URL} target="_blank" rel="noopener">Sapana Sonee</a></span>
        </div>
      </footer>
    </>
  );
}
