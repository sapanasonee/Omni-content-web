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

  const currentMode = MODES.find(m => m.value === mode)!

  async function handleGenerate() {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    setOutput('')

    try {
      // Get workspace and persona from localStorage or context
      // For now we'll get it from the API
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
        setOutput(prev => prev + chunk)
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="flex h-full">

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
              Copy
            </button>
            <button
              onClick={() => setInput('')}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
            >
              New piece
            </button>
            <button
              className="px-4 py-2 text-sm bg-[#534AB7] text-white rounded-lg hover:opacity-90 transition-opacity ml-auto"
            >
              Approve
            </button>
          </div>
        )}

      </div>
    </div>
  )
}