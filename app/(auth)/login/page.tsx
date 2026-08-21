 'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { evaluateSignupEmail } from '@/lib/signup-policy'

const CALENDLY_URL = 'https://calendly.com/sonisapna45/30min'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the email is a disposable/temporary inbox — we stop before sending
  // a magic link and explain why, with a way to reach out anyway.
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams.get('error') === 'auth_failed') {
      setError('The sign-in link expired or is invalid. Please request a new one.')
    }
  }, [searchParams])

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setBlockedReason(null)

    // Disposable/temporary inboxes are stopped HERE with a clear message,
    // rather than silently getting a magic link that dead-ends at onboarding.
    // evaluateSignupEmail only rejects burner domains + malformed addresses —
    // Gmail and every work/personal domain still pass — so this does not
    // reintroduce the grandfathered-account concern (those are on real
    // domains). The server-side policy at /api/onboarding + /api/voice-extract
    // remains the authoritative gate; this is the friendlier front door.
    const verdict = evaluateSignupEmail(email)
    if (!verdict.allowed) {
      setBlockedReason(verdict.reason || 'Please use a valid work or personal email.')
      setLoading(false)
      return
    }

    // Best-effort founder alert (early-access engagement tracking). Fire and
    // forget — it must never delay or block the magic link, and the requester
    // learns nothing from it either way.
    fetch('/api/notify-signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {})

    const supabase = createClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      }
    })
    if (otpError) {
      setError(otpError.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-full max-w-sm space-y-4 px-4 text-center">
          <img src="/icon.svg" alt="Vowwl" className="w-10 h-10 rounded-xl mx-auto" />
          <h1 className="text-xl font-bold text-gray-900">Check your email</h1>
          <p className="text-sm text-gray-500">
            We sent a sign-in link to <strong>{email}</strong>. Click it to continue.
          </p>
          <button
            onClick={() => setSent(false)}
            className="text-sm text-[#534AB7] hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm space-y-8 px-4">
        <div className="text-center space-y-2">
          <img src="/icon.svg" alt="Vowwl" className="w-10 h-10 rounded-xl mx-auto mb-4" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Vowwl</h1>
          <p className="text-sm text-gray-500">Enter your email to sign in</p>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {blockedReason && (
          <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2.5">
            <p className="text-sm text-amber-800">{blockedReason}</p>
            <p className="text-xs text-amber-700">
              Don&apos;t have a work email but want Vowwl? Grab a slot and we&apos;ll get you set up.
            </p>
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-3 py-1.5 bg-[#534AB7] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
            >
              Book a quick call →
            </a>
          </div>
        )}

        <form onSubmit={handleSendLink} className="space-y-4">
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send sign-in link'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
