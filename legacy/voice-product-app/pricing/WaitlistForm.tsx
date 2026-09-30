'use client'

import { useState } from 'react'

// Inline email capture for a not-yet-live tier's "get on the list". Replaces a
// Calendly link with a one-field waitlist join — lower friction for a
// non-purchase intent. Success is terminal (the card shows a confirmation);
// errors let the user retry.
export default function WaitlistForm({ tier }: { tier: string }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || status === 'submitting') return
    setStatus('submitting')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), tier }),
      })
      if (!res.ok) throw new Error()
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <p className="text-center text-sm font-medium text-[#534AB7] py-2.5">
        ✓ You&apos;re on the list — we&apos;ll email you when it opens.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        type="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@work.com"
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
      />
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:border-gray-400 transition-colors disabled:opacity-50"
      >
        {status === 'submitting' ? 'Adding you…' : 'Get on the list'}
      </button>
      {status === 'error' && (
        <p className="text-xs text-red-600 text-center">Something went wrong — try again.</p>
      )}
    </form>
  )
}
