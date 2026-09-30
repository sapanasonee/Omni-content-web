// Vowwl one-page site: proof capture for technical services firms.
// Markup ported 1:1 from the approved design file (vowwl_index.html); styles
// live in app/site.css. Copy is unchanged — apostrophes are written as
// &apos; only because React's lint rule rejects raw ' in JSX text; they
// render identically.

// ---- Contact links: the only values expected to change -------------------
// Owner's Calendly booking page (replaced the design file's mailto placeholder).
// Note: the event type is 30 minutes while the button says "15-minute"; switch
// to a 15-minute Calendly event here if/when one exists.
const BOOK_CALL_URL = "https://calendly.com/sonisapna45/30min";
// TODO(owner): confirm the exact LinkedIn profile URL (value from design file).
const LINKEDIN_URL = "https://www.linkedin.com/in/sapana-sonee";

export default function Home() {
  return (
    <>
      {/* Top bar */}
      <div className="topbar">
        <div className="wrap">
          <a href="#top" className="brand">Vowwl</a>
          {/* Scrolls to the closing CTA section rather than leaving the page */}
          <a href="#contact" className="nav-cta">Book a call</a>
        </div>
      </div>

      {/* Hero */}
      <header className="hero" id="top">
        <div className="wrap">
          <div className="hero-kicker">Proof capture for technical services firms</div>
          <h1>Your best work is real.{" "}
            <span className="accent">Your proof is invisible.</span>
          </h1>
          <p className="hero-sub">
            Every project your team delivers generates proof of what changed. It leaks away within two weeks, because nobody is in the right place at the right moment to catch it. Vowwl catches it, and turns it into success stories you can close deals with, without adding work to your delivery team.
          </p>
          <div className="hero-actions">
            <a href="#contact" className="btn-primary">Book a 15-minute call</a>
            <a href="#how" className="btn-text">See how it works</a>
          </div>

          {/* Signature motif: proof decaying across the three moments */}
          <div className="motif" aria-hidden="true">
            <div className="motif-track">
              <div className="motif-node m1"><span className="motif-dot"></span><div className="motif-label">Kickoff</div><div className="motif-note">The problem, in the client&apos;s words</div></div>
              <div className="motif-node m2"><span className="motif-dot"></span><div className="motif-label">Milestone</div><div className="motif-note">What changed, and by how much</div></div>
              <div className="motif-node m3"><span className="motif-dot"></span><div className="motif-label">Close</div><div className="motif-note">Gone, unless someone caught it</div></div>
            </div>
          </div>
        </div>
      </header>

      {/* The three moments where proof leaks */}
      <section className="leak">
        <div className="wrap">
          <h2 className="section-title">Proof doesn&apos;t vanish all at once. It leaks, at three predictable moments.</h2>
          <p className="section-intro">None of this is anyone&apos;s fault. Delivery is always more urgent than documentation, so the proof waits. And while it waits, it decays.</p>
          <div className="moments">
            <div className="moment">
              <h3>At kickoff</h3>
              <p>Nobody records what the client is trying to fix, in their own urgent words, before the work begins. Months later, the origin story is vague.</p>
            </div>
            <div className="moment">
              <h3>At each milestone</h3>
              <p>Something ships. The team knows exactly what changed. Two weeks on they are deep in the next engagement, and the number, the reaction, the detail are gone.</p>
            </div>
            <div className="moment">
              <h3>At close</h3>
              <p>A case study finally gets commissioned. The writer works from tired memory and describes what was built, not what changed. The story ends up thin, or shelved.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Weak vs strong contrast */}
      <section className="contrast">
        <div className="wrap">
          <h2 className="section-title">The same work can be told two ways. Only one closes deals.</h2>
          <p className="section-intro">The difference is never the writing. It&apos;s whether the real detail was caught while it still existed.</p>
          <div className="cards">
            <div className="card card-weak">
              <div className="card-tag">What most firms write</div>
              <div className="card-quote">&ldquo;We improved the client&apos;s cloud infrastructure and reduced their costs.&rdquo;</div>
              <div className="card-note">No name. No number. Nothing a buyer remembers.</div>
            </div>
            <div className="card card-strong">
              <div className="card-tag">What actually convinces a buyer</div>
              <div className="card-quote">&ldquo;A 40-person Series A was losing 3 hours every Monday to manual reporting. We shipped an automated pipeline in 5 days, and the team stopped arguing about whose numbers were right.&rdquo;</div>
              <div className="card-note">Real situation. Real number. A moment they&apos;ll remember.</div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="how" id="how">
        <div className="wrap">
          <h2 className="section-title">How Vowwl catches the strong version, every time</h2>
          <p className="section-intro">A short, scheduled process that sits alongside your delivery, not on top of it.</p>
          <div className="steps">
            <div className="step">
              <div className="step-num">1</div>
              <div>
                <h3>Catch it at the moment, not from memory</h3>
                <p>We capture within a day or two of a milestone or a close, while the number is still exact and the client&apos;s reaction is still fresh. Waiting is what makes proof decay, so we don&apos;t wait.</p>
              </div>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <div>
                <h3>Ask the questions that make proof convincing</h3>
                <p>Not &ldquo;how did it go.&rdquo; What changed in a number, what the client actually said, which moment they reacted to, and what&apos;s safe to name. A structured async interview your team answers on their own schedule, with our follow-up filling the gaps one call never covers.</p>
              </div>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <div>
                <h3>Keep delivery on delivery</h3>
                <p>The person who catches the proof is never your engineer. Documentation never lands on the team doing the work. Someone whose whole job is proof does the catching, and hands you a finished story, a proposal snippet, and a post.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What Vowwl is / is not */}
      <section className="not">
        <div className="wrap">
          <h2 className="section-title">Not a writer. Not a content agency. A capture system.</h2>
          <div className="not-row">
            <div className="not-col">
              <h4>What everyone else does</h4>
              <p>Turns proof you already have into a case study. If the proof was never captured, there&apos;s nothing to turn.</p>
            </div>
            <div className="not-col is-vowwl">
              <h4>What Vowwl does</h4>
              <p>Catches the proof at the moment it exists, before it leaks away. The capture is the hard part. That&apos;s the part we own.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA — the only outbound actions on the site */}
      <section className="cta" id="contact">
        <div className="wrap">
          <h2>If your work is stronger than your case studies, that&apos;s the gap we close.</h2>
          <p>Tell me about a project you&apos;re proud of. If there&apos;s a fit, we&apos;ll run one story end to end and you&apos;ll see exactly what your proof looks like when someone catches it in time.</p>
          <div className="cta-actions">
            {/* Opens Calendly in a new tab, like the LinkedIn link, so the site stays open */}
            <a href={BOOK_CALL_URL} className="btn-primary" target="_blank" rel="noopener">Book a 15-minute call</a>
            <a href={LINKEDIN_URL} className="btn-text" target="_blank" rel="noopener">Connect on LinkedIn</a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="wrap">
          <span>Vowwl — Proof capture for technical services firms</span>
          <span>Built by <a href={LINKEDIN_URL} target="_blank" rel="noopener">Sapana Sonee</a></span>
        </div>
      </footer>
    </>
  );
}
