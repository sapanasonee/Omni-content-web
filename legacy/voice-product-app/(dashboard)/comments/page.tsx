'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { COMMENT_GOALS } from '@/lib/comment-goals'

interface CommentOption {
  text: string
  flags: string[]
}

export default function CommentsPage() {
  const [postText, setPostText] = useState('')
  const [goal, setGoal] = useState(COMMENT_GOALS[0].value)
  const [angle, setAngle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<CommentOption[] | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const selectedGoal = COMMENT_GOALS.find(g => g.value === goal)!

  async function handleGenerate() {
    if (!postText.trim() || loading) return
    setLoading(true)
    setError(null)
    setOptions(null)
    setCopiedIdx(null)
    try {
      const meta = await (await fetch('/api/me')).json()
      const res = await fetch('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: meta.workspace_id,
          persona_id: meta.persona_id,
          post_text: postText,
          goal,
          angle: angle.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Comment generation failed')
      setOptions(data.options || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy(idx: number) {
    const text = options?.[idx]?.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  return (
    <div className="flex h-full">

      {/* Left panel — the post + intent */}
      <div className="w-96 flex-shrink-0 border-r border-gray-100 flex flex-col">

        <div className="p-4 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">Comment on a post</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Someone posted in your niche. Say something worth reading — in your voice.
          </p>
        </div>

        {/* Post paste */}
        <div className="flex-1 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1.5">The post</p>
          <textarea
            value={postText}
            onChange={e => setPostText(e.target.value)}
            placeholder="Paste the post you want to comment on…"
            className="w-full h-full min-h-40 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none"
          />
        </div>

        {/* Goal */}
        <div className="px-4 pb-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Why are you commenting?</p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {COMMENT_GOALS.map(g => (
              <button
                key={g.value}
                onClick={() => setGoal(g.value)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  goal === g.value
                    ? 'bg-[#534AB7] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">{selectedGoal.hint}</p>
        </div>

        {/* Angle */}
        <div className="px-4 pb-3">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Your angle (optional)</p>
          <textarea
            value={angle}
            onChange={e => setAngle(e.target.value)}
            placeholder="e.g. we tried this exact thing and it backfired"
            rows={2}
            maxLength={500}
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
          />
        </div>

        {/* Generate */}
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleGenerate}
            disabled={!postText.trim() || loading}
            className="w-full py-2.5 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Writing your options…' : 'Write my comment'}
          </button>
        </div>

      </div>

      {/* Right panel — options */}
      <div className="flex-1 p-8 overflow-auto">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {!options && !loading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-sm">
              <div className="w-12 h-12 bg-gray-100 rounded-xl mx-auto mb-3" />
              <p className="text-sm text-gray-400 mb-1">Their post, your take</p>
              <p className="text-xs text-gray-400">
                Paste a post, pick why you&apos;re commenting, and get three options in your
                voice — each taking a different angle. Comments on big posts are the
                cheapest visibility you&apos;ll ever get.
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Reading the post, drafting your take…</p>
            </div>
          </div>
        )}

        {options && !loading && (
          <div className="max-w-2xl space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Three ways to say it</h2>
              <p className="text-xs text-gray-400">Copy the one that sounds most like you — or edit it after pasting.</p>
            </div>
            {options.map((opt, idx) => (
              <div key={idx} className="p-4 border border-gray-100 rounded-xl hover:border-[#534AB7]/30 transition-colors">
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed mb-3">{opt.text}</p>
                {opt.flags.length > 0 && (
                  <div className="mb-3 text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                    ⚠ {opt.flags.slice(0, 2).join('; ')}
                  </div>
                )}
                <button
                  onClick={() => handleCopy(idx)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    copiedIdx === idx
                      ? 'bg-green-500 text-white'
                      : 'bg-[#EEEDFE] text-[#534AB7] hover:bg-[#534AB7] hover:text-white'
                  )}
                >
                  {copiedIdx === idx ? '✓ Copied' : 'Copy comment'}
                </button>
              </div>
            ))}
            <button
              onClick={handleGenerate}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              ↻ Three different takes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
