'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
type Format = 'linkedin' | 'twitter' | 'newsletter' | 'blog' | 'exec_brief'
type Mode = 'brief' | 'raw' | 'describe'
type GenerationMode = 'standard' | 'one_time'

const FORMATS: { value: Format; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'blog', label: 'Blog' },
  { value: 'exec_brief', label: 'Exec Brief' },
]

const MODES: { value: Mode; label: string; placeholder: string }[] = [
  { value: 'brief', label: 'Brief', placeholder: 'What do you want to write about? Be specific — the more context you give, the better the output.' },
  { value: 'raw', label: 'Raw input', placeholder: 'Paste your rough notes, bullet points, or draft. The system will shape it into your voice.' },
  { value: 'describe', label: 'Describe', placeholder: 'Describe the feeling, situation, or idea you want to capture. Less structured than a brief.' },
]

export default function GeneratePage() {
  const [format, setFormat] = useState<Format>('linkedin')
  const [mode, setMode] = useState<Mode>('brief')
  const [generationMode, setGenerationMode] = useState<GenerationMode>('standard')
  const [input, setInput] = useState('')
  const [toneOverride, setToneOverride] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [copied, setCopied] = useState(false) 

  // Approve state
  const [contentPieceId, setContentPieceId] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [activeRagCount, setActiveRagCount] = useState<number | null>(null)
  const [violations, setViolations] = useState<string[]>([])
  const [showViolationsModal, setShowViolationsModal] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const currentMode = MODES.find(m => m.value === mode)!

  async function handleGenerate() {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    setOutput('')
    setApproved(false)
    setContentPieceId(null)
    setActiveRagCount(null)
    setApproveError(null)

    try {
      const metaRes = await fetch('/api/me')
      const meta = await metaRes.json()

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: meta.workspace_id,
          persona_id: meta.persona_id,
          format,
          mode,
          generation_mode: generationMode,
          topic: mode === 'brief' ? input : undefined,
          raw_input: mode === 'raw' ? input : undefined,
          description: mode === 'describe' ? input : undefined,
          tone_override: toneOverride || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }

      // Stream the response
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
         const { done, value } = await reader.read()
         if (done) break
          const chunk = decoder.decode(value, { stream: true })
         if (chunk.includes('__META__')) {
       const parts = chunk.split('__META__')
         if (parts[0]) setOutput(prev => prev + parts[0])
        try {
         const metaData = JSON.parse(parts[1])
         if (metaData?.content_piece_id) {
        setContentPieceId(metaData.content_piece_id)
      }
    } catch {}
  } else {
    setOutput(prev => prev + chunk)
  }
}

      // After streaming, fetch the latest draft ID
      const latestRes = await fetch(`/api/content?workspace_id=${meta.workspace_id}&persona_id=${meta.persona_id}&status=draft&limit=1`)
      if (latestRes.ok) {
        const latest = await latestRes.json()
        if (latest?.items?.[0]?.id) {
          setContentPieceId(latest.items[0].id)
        }
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(confirmed = false) {
    if (!contentPieceId) return
    setApproving(true)
    setApproveError(null)

    try {
      const metaRes = await fetch('/api/me')
      const meta = await metaRes.json()

      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_piece_id: contentPieceId,
          workspace_id: meta.workspace_id,
          persona_id: meta.persona_id,
          confirmed,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Approval failed')
      }

      // Violations found — show modal for confirmation
      if (data.requires_confirmation) {
        setViolations(data.violations)
        setShowViolationsModal(true)
        return
      }

      // Success
      setApproved(true)
      setActiveRagCount(data.active_rag_count)
      setShowViolationsModal(false)

    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }
async function handleCopy() {
  try {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  } catch {
    // fallback for clipboard permission issues
    const el = document.createElement('textarea')
    el.value = output
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
}
  return (
    <div className="flex h-full">

      {/* Violations modal */}
      {showViolationsModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Quality issues found</h3>
            <p className="text-sm text-gray-500 mb-4">The critic flagged these issues. Approve anyway?</p>
            <ul className="mb-5 space-y-1.5">
              {violations.map((v, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-amber-500 mt-0.5">⚠</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => setShowViolationsModal(false)}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:border-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleApprove(true)}
                disabled={approving}
                className="flex-1 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {approving ? 'Approving...' : 'Approve anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left panel — input */}
      <div className="w-96 flex-shrink-0 border-r border-gray-100 flex flex-col">

        {/* Format selector */}
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-2">Platform</p>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map(f => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  format === f.value
                    ? 'bg-[#534AB7] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode selector */}
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-2">Input mode</p>
          <div className="flex gap-1.5">
            {MODES.map(m => (
              <button
                key={m.value}
                onClick={() => { setMode(m.value); setInput('') }}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-medium transition-all',
                  mode === m.value
                    ? 'bg-[#534AB7] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Generation mode */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex gap-2">
            <button
              onClick={() => setGenerationMode('standard')}
              className={cn(
                'flex-1 py-2 rounded-lg text-xs font-medium transition-all border',
                generationMode === 'standard'
                  ? 'bg-[#EEEDFE] border-[#534AB7] text-[#534AB7]'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              )}
            >
              Standard
              <span className="block text-xs font-normal opacity-60">Learns from history</span>
            </button>
            <button
              onClick={() => setGenerationMode('one_time')}
              className={cn(
                'flex-1 py-2 rounded-lg text-xs font-medium transition-all border',
                generationMode === 'one_time'
                  ? 'bg-[#EEEDFE] border-[#534AB7] text-[#534AB7]'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              )}
            >
              Fresh start
              <span className="block text-xs font-normal opacity-60">Ignores history</span>
            </button>
          </div>
        </div>

        {/* Input */}
        <div className="flex-1 p-4">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={currentMode.placeholder}
            className="w-full h-full min-h-40 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none"
          />
        </div>

        {/* Advanced options */}
        <div className="px-4 pb-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showAdvanced ? '− Hide' : '+ Advanced options'}
          </button>
          {showAdvanced && (
            <div className="mt-2">
              <label className="block text-xs text-gray-500 mb-1">Tone override</label>
              <input
                type="text"
                value={toneOverride}
                onChange={e => setToneOverride(e.target.value)}
                placeholder="e.g. More vulnerable, less polished"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
              />
            </div>
          )}
        </div>

        {/* Generate button */}
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleGenerate}
            disabled={!input.trim() || loading}
            className="w-full py-2.5 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>

      </div>

      {/* Right panel — output */}
      <div className="flex-1 flex flex-col">

        {/* Output area */}
        <div className="flex-1 p-8 overflow-auto">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {approved && (
            <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
              <span>✓</span>
              <span>
                Approved and indexed into your brand memory.
                {activeRagCount !== null && (
                  <span className="ml-1 font-medium">{activeRagCount} pieces now in RAG store.</span>
                )}
              </span>
            </div>
          )}

          {approveError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {approveError}
            </div>
          )}

          {!output && !loading && (
            <div className="h-full flex items-center justify-center text-gray-300">
              <div className="text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-xl mx-auto mb-3" />
                <p className="text-sm">Your content will appear here</p>
              </div>
            </div>
          )}

          {(output || loading) && (
            <div className="max-w-2xl">
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {output}
                {loading && (
                  <span className="inline-block w-1 h-4 bg-[#534AB7] animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Output actions */}
        {output && !loading && (
          <div className="p-4 border-t border-gray-100 flex items-center gap-3">
            <button
  onClick={handleCopy}
  className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
>
  {copied ? '✓ Copied!' : 'Copy'}
</button>
<button
              onClick={() => {
                setInput('')
                setOutput('')
                setApproved(false)
                setContentPieceId(null)
                setActiveRagCount(null)
                setApproveError(null)
              }}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
            >
              New piece
            </button>
            <button
              onClick={() => handleApprove(false)}
              disabled={approving || approved || !contentPieceId}
              className={cn(
                'px-4 py-2 text-sm rounded-lg font-medium transition-all ml-auto',
                approved
                  ? 'bg-green-500 text-white cursor-default'
                  : 'bg-[#534AB7] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              {approved ? '✓ Approved' : approving ? 'Approving...' : 'Approve'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}