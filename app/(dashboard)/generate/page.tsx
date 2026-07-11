'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils' 

type Format = 'linkedin' | 'twitter' | 'newsletter' | 'blog' | 'exec_brief'
type Mode = 'brief' | 'raw' | 'describe'

interface Campaign {
  id: string
  name: string
  content: string
  status: string
}

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
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Context state
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [oneTimeContext, setOneTimeContext] = useState('')
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignContent, setNewCampaignContent] = useState('')
  const [savingCampaign, setSavingCampaign] = useState(false)
  const [hardRules, setHardRules] = useState<{ id: string; content: string }[]>([])
  const [showHardRules, setShowHardRules] = useState(false)

  // Approve state
  const [contentPieceId, setContentPieceId] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeRagCount, setActiveRagCount] = useState<number | null>(null)
  const [violations, setViolations] = useState<string[]>([])
  const [showViolationsModal, setShowViolationsModal] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const currentMode = MODES.find(m => m.value === mode)!
  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId) || null

  // ─── Load active campaigns ────────────────────────────────────

  useEffect(() => {
  async function loadContexts() {
    try {
      const meta = await (await fetch('/api/me')).json()
      const [campRes, rulesRes] = await Promise.all([
        fetch(`/api/contexts?workspace_id=${meta.workspace_id}&persona_id=${meta.persona_id}&scope=campaign&status=active`),
        fetch(`/api/contexts?workspace_id=${meta.workspace_id}&persona_id=${meta.persona_id}&scope=permanent&status=active`),
      ])
      if (campRes.ok) {
        const data = await campRes.json()
        setCampaigns(data.contexts || [])
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json()
        setHardRules((data.contexts || []).filter((c: { tier: string }) => c.tier === 'hard_rule'))
      }
    } catch (err) {
      console.error('Failed to load contexts:', err)
    }
  }
  loadContexts()
}, [])
  // ─── Create campaign ──────────────────────────────────────────

  async function createCampaign() {
    if (!newCampaignName.trim() || !newCampaignContent.trim() || savingCampaign) return
    setSavingCampaign(true)
    try {
      const meta = await (await fetch('/api/me')).json()
      const res = await fetch('/api/contexts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: meta.workspace_id,
          persona_id: meta.persona_id,
          scope: 'campaign',
          name: newCampaignName.trim(),
          content: newCampaignContent.trim(),
        }),
      })
      if (res.ok) {
        const { context } = await res.json()
        setCampaigns(prev => [...prev, context])
        setSelectedCampaignId(context.id)
        setNewCampaignName('')
        setNewCampaignContent('')
        setShowNewCampaign(false)
      }
    } catch (err) {
      console.error('Failed to create campaign:', err)
    } finally {
      setSavingCampaign(false)
    }
  }

  // ─── Generate ─────────────────────────────────────────────────

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
          generation_mode: 'standard',
          topic: mode === 'brief' ? input : undefined,
          raw_input: mode === 'raw' ? input : undefined,
          description: mode === 'describe' ? input : undefined,
          campaign_context_id: selectedCampaignId || undefined,
          one_time_context: oneTimeContext.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let raw = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        raw += decoder.decode(value, { stream: true })
        const metaIdx = raw.indexOf('__META__')
        setOutput(metaIdx === -1 ? raw : raw.slice(0, metaIdx))
      }

      const metaIdx = raw.indexOf('__META__')
      if (metaIdx !== -1) {
        setOutput(raw.slice(0, metaIdx))
        try {
          const metaData = JSON.parse(raw.slice(metaIdx + '__META__'.length))
          if (metaData?.content_piece_id) {
            setContentPieceId(metaData.content_piece_id)
          }
        } catch {}
      }

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

  // ─── Save edit ────────────────────────────────────────────────

  async function saveEdit(): Promise<boolean> {
    if (!contentPieceId || !isDirty) return true
    setSaving(true)
    try {
      const meta = await (await fetch('/api/me')).json()
      const res = await fetch('/api/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_piece_id: contentPieceId,
          workspace_id: meta.workspace_id,
          body: output,
        }),
      })
      if (!res.ok) {
        setApproveError('Could not save your edit. Try again before approving.')
        return false
      }
      setIsDirty(false)
      return true
    } catch {
      setApproveError('Could not save your edit. Try again before approving.')
      return false
    } finally {
      setSaving(false)
    }
  }

  // ─── Approve ──────────────────────────────────────────────────

  async function handleApprove(confirmed = false) {
    if (!contentPieceId) return
    const saved = await saveEdit()
    if (!saved) return
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

      if (data.requires_confirmation) {
        setViolations(data.violations)
        setShowViolationsModal(true)
        return
      }

      setApproved(true)
      setActiveRagCount(data.active_rag_count)
      setShowViolationsModal(false)

    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  // ─── Copy ─────────────────────────────────────────────────────

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
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

  // ─── Reset ────────────────────────────────────────────────────

  function handleNewPiece() {
    setInput('')
    setOutput('')
    setApproved(false)
    setContentPieceId(null)
    setActiveRagCount(null)
    setApproveError(null)
    setOneTimeContext('')
    setIsDirty(false)
  }

  // ─── Render ───────────────────────────────────────────────────

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

        {/* Input */}
        <div className="flex-1 p-4">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={currentMode.placeholder}
            className="w-full h-full min-h-40 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none"
          />
        </div>

        {/* Context section */}
        <div className="px-4 pb-3 space-y-3 border-t border-gray-100 pt-3">

          {/* Campaign picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-gray-500">Campaign</p>
              {!showNewCampaign && (
                <button
                  onClick={() => setShowNewCampaign(true)}
                  className="flex items-center gap-0.5 text-xs text-[#534AB7] hover:opacity-80 transition-opacity"
                >
                  +New
                </button>
              )}
            </div>

            {showNewCampaign ? (
              <div className="space-y-2 p-3 border border-[#534AB7]/20 rounded-lg bg-[#FAFAFF]">
                <input
                  type="text"
                  value={newCampaignName}
                  onChange={e => setNewCampaignName(e.target.value)}
                  placeholder="Campaign name (e.g. Launch Week)"
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
                  autoFocus
                />
                <textarea
                  value={newCampaignContent}
                  onChange={e => setNewCampaignContent(e.target.value)}
                  placeholder="What should every piece in this campaign know?"
                  rows={2}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowNewCampaign(false); setNewCampaignName(''); setNewCampaignContent('') }}
                    className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createCampaign}
                    disabled={!newCampaignName.trim() || !newCampaignContent.trim() || savingCampaign}
                    className="px-2.5 py-1 bg-[#534AB7] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    {savingCampaign ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <select
                  value={selectedCampaignId}
                  onChange={e => setSelectedCampaignId(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] bg-white"
                >
                  <option value="">No campaign</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {selectedCampaign && (
                  <p className="mt-1.5 text-xs text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5 leading-relaxed">
                    {selectedCampaign.content}
                  </p>
                )}
              </>
            )}
          </div>

          {/* One-time context */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">One-time instruction</p>
            <textarea
              value={oneTimeContext}
              onChange={e => setOneTimeContext(e.target.value)}
              placeholder="Guidance for this piece only (e.g. more vulnerable tone, mention a specific event)"
              rows={2}
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
            />
          </div>

        </div>
        {/* Hard rules reminder */}
{hardRules.length > 0 && (
  <div className="px-4 pb-2">
    <button
      onClick={() => setShowHardRules(!showHardRules)}
      className="w-full flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 hover:bg-amber-100/60 transition-colors"
    >
      <span className="font-medium">
        {hardRules.length} hard rule{hardRules.length > 1 ? 's' : ''} active
      </span>
      <span className="text-amber-500">{showHardRules ? '−' : '+'}</span>
    </button>
    {showHardRules && (
      <ul className="mt-1.5 space-y-1 px-3 py-2 bg-amber-50/50 rounded-lg">
        {hardRules.map(r => (
          <li key={r.id} className="text-xs text-amber-800 flex items-start gap-1.5">
            <span className="mt-0.5">·</span>
            <span>{r.content}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
)}    
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
              {loading ? (
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {output}
                  <span className="inline-block w-1 h-4 bg-[#534AB7] animate-pulse ml-0.5 align-middle" />
                </div>
              ) : (
                <textarea
                  value={output}
                  onChange={e => { setOutput(e.target.value); setIsDirty(true); setApproved(false) }}
                  onBlur={saveEdit}
                  disabled={approved}
                  className="w-full min-h-[50vh] text-sm text-gray-800 whitespace-pre-wrap leading-relaxed resize-none focus:outline-none bg-transparent disabled:opacity-100"
                />
              )}
              {!approved && (
                <p className="mt-2 text-xs text-gray-400">
                  {saving ? 'Saving…' : isDirty ? 'You have unsaved changes' : 'All changes saved'}
                </p>
              )}
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
              onClick={saveEdit}
              disabled={!isDirty || saving || approved}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save edit'}
            </button>
            <button
              onClick={handleNewPiece}
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
