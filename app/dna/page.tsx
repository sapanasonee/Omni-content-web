'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Plus, X, Pencil, Shield, BookOpen } from 'lucide-react'
import type { OnboardingData } from '@/lib/types'

// ─── Types ──────────────────────────────────────────────────────

interface Rule {
  id: string
  tier: 'default' | 'hard_rule'
  content: string
  created_at: string
}

const FORMALITY = ['Very casual', 'Casual', 'Balanced', 'Formal', 'Very formal']
const PACE = ['Very slow', 'Slow', 'Moderate', 'Fast', 'Very fast']
const TONES = ['Direct', 'Warm', 'Witty', 'Formal', 'Casual', 'Empathetic', 'Bold', 'Thoughtful']
const FORMAT_OPTIONS = ['LinkedIn', 'Twitter', 'Newsletter', 'Blog', 'Executive Brief']
const CADENCES = ['Daily', '3-5x per week', '2x per week', 'Weekly', 'Bi-weekly']
const TOPIC_SUGGESTIONS = [
  'Product thinking', 'AI for creators', 'Building in public',
  'Content strategy', 'Founder life', 'Career transitions',
  'Leadership', 'Marketing', 'Fundraising', 'Hiring',
]

// ─── Main page ──────────────────────────────────────────────────

export default function DNAPage() {
  const [loading, setLoading] = useState(true)
  const [brandDNA, setBrandDNA] = useState<OnboardingData | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [personaId, setPersonaId] = useState('')

  // DNA edit state
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<OnboardingData | null>(null)
  const [savingDNA, setSavingDNA] = useState(false)
  const [dnaError, setDnaError] = useState<string | null>(null)

  // Standing rules
  const [rules, setRules] = useState<Rule[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newTier, setNewTier] = useState<'default' | 'hard_rule'>('default')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editTier, setEditTier] = useState<'default' | 'hard_rule'>('default')
  const [closingId, setClosingId] = useState<string | null>(null)

  // ─── Load data ────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const meta = await (await fetch('/api/me')).json()
        setWorkspaceId(meta.workspace_id)
        setPersonaId(meta.persona_id)

        const [dnaRes, rulesRes] = await Promise.all([
          fetch(`/api/brand-dna?workspace_id=${meta.workspace_id}&persona_id=${meta.persona_id}`),
          fetch(`/api/contexts?workspace_id=${meta.workspace_id}&persona_id=${meta.persona_id}&scope=permanent&status=active`),
        ])

        if (dnaRes.ok) {
          const d = await dnaRes.json()
          setBrandDNA(d.brand_dna)
          setDisplayName(d.display_name || '')
        }

        if (rulesRes.ok) {
          const r = await rulesRes.json()
          setRules(r.contexts || [])
        }
      } catch (err) {
        console.error('Failed to load Brand DNA:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ─── DNA editing ──────────────────────────────────────────────

  function startEditing() {
    if (!brandDNA) return
    setDraft({
      ...brandDNA,
      identity: { ...brandDNA.identity },
      audience: { ...brandDNA.audience, segments: [...brandDNA.audience.segments] },
      voice: { ...brandDNA.voice, tones: [...brandDNA.voice.tones] },
      examples: { ...brandDNA.examples },
      topics: [...(brandDNA.topics || [])],
      avoid: [...brandDNA.avoid],
      formats: { ...brandDNA.formats, preferred: [...brandDNA.formats.preferred] },
    })
    setDnaError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setDraft(null)
    setDnaError(null)
  }

  async function saveDNA() {
    if (!draft || savingDNA) return
    if (!draft.identity.full_name.trim() || !draft.identity.role.trim() || !draft.identity.industry.trim()) {
      setDnaError('Name, role and industry are required.')
      return
    }
    setSavingDNA(true)
    setDnaError(null)
    try {
      const res = await fetch('/api/brand-dna', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          persona_id: personaId,
          sections: draft,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setBrandDNA(data.brand_dna)
      setEditing(false)
      setDraft(null)
    } catch (err) {
      setDnaError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingDNA(false)
    }
  }

  function patchDraft(updates: Partial<OnboardingData>) {
    setDraft(prev => (prev ? { ...prev, ...updates } : prev))
  }

  // ─── Rules CRUD ───────────────────────────────────────────────

  async function addRule() {
    if (!newContent.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/contexts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          persona_id: personaId,
          scope: 'permanent',
          tier: newTier,
          content: newContent.trim(),
        }),
      })
      if (res.ok) {
        const { context } = await res.json()
        setRules(prev => [...prev, context])
        setNewContent('')
        setNewTier('default')
        setShowAdd(false)
      }
    } catch (err) {
      console.error('Failed to add rule:', err)
    } finally {
      setSaving(false)
    }
  }

  async function updateRule(id: string) {
    if (!editContent.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/contexts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          workspace_id: workspaceId,
          content: editContent.trim(),
          tier: editTier,
        }),
      })
      if (res.ok) {
        const { context } = await res.json()
        setRules(prev => prev.map(r => r.id === id ? { ...r, ...context } : r))
        setEditingId(null)
      }
    } catch (err) {
      console.error('Failed to update rule:', err)
    } finally {
      setSaving(false)
    }
  }

  async function closeRule(id: string) {
    setClosingId(id)
    try {
      const res = await fetch('/api/contexts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          workspace_id: workspaceId,
          status: 'closed',
        }),
      })
      if (res.ok) {
        setRules(prev => prev.filter(r => r.id !== id))
      }
    } catch (err) {
      console.error('Failed to close rule:', err)
    } finally {
      setClosingId(null)
    }
  }

  function startEdit(rule: Rule) {
    setEditingId(rule.id)
    setEditContent(rule.content)
    setEditTier(rule.tier)
  }

  // ─── Loading state ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">

      {/* Page header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Brand DNA</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {displayName ? `${displayName}'s voice profile and generation rules` : 'Your voice profile and generation rules'}
          </p>
        </div>
        {brandDNA && !editing && (
          <button
            onClick={startEditing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#534AB7] border border-[#534AB7]/30 rounded-lg hover:bg-[#EEEDFE] transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit profile
          </button>
        )}
      </div>

      {/* ─── Voice Profile ─────────────────────────────────────── */}

      {editing && draft ? (
        <div className="space-y-4 mb-10">

          {/* Identity */}
          <section className="border border-[#534AB7]/20 rounded-xl p-5 bg-[#FAFAFF]">
            <p className="text-xs font-medium text-gray-400 mb-3">Identity</p>
            <div className="space-y-3">
              <EditField label="Full name" value={draft.identity.full_name}
                onChange={v => patchDraft({ identity: { ...draft.identity, full_name: v } })} />
              <EditField label="Role" value={draft.identity.role}
                onChange={v => patchDraft({ identity: { ...draft.identity, role: v } })} />
              <EditField label="Industry or niche" value={draft.identity.industry}
                onChange={v => patchDraft({ identity: { ...draft.identity, industry: v } })} />
            </div>
          </section>

          {/* Audience */}
          <section className="border border-[#534AB7]/20 rounded-xl p-5 bg-[#FAFAFF]">
            <p className="text-xs font-medium text-gray-400 mb-3">Audience</p>
            <EditTextarea label="Who reads your content?" value={draft.audience.description} rows={3}
              onChange={v => patchDraft({ audience: { ...draft.audience, description: v } })} />
            <div className="mt-3">
              <ChipEditor
                label="Segments"
                values={draft.audience.segments}
                onChange={segments => patchDraft({ audience: { ...draft.audience, segments } })}
              />
            </div>
          </section>

          {/* Voice */}
          <section className="border border-[#534AB7]/20 rounded-xl p-5 bg-[#FAFAFF]">
            <p className="text-xs font-medium text-gray-400 mb-3">Voice</p>
            <EditTextarea label="Describe your voice" value={draft.voice.description} rows={4}
              onChange={v => patchDraft({ voice: { ...draft.voice, description: v } })} />
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1.5">Tones</p>
              <div className="flex flex-wrap gap-1.5">
                {TONES.map(tone => (
                  <button
                    key={tone}
                    type="button"
                    onClick={() => {
                      const tones = draft.voice.tones.includes(tone)
                        ? draft.voice.tones.filter(t => t !== tone)
                        : [...draft.voice.tones, tone]
                      patchDraft({ voice: { ...draft.voice, tones } })
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                      draft.voice.tones.includes(tone)
                        ? 'bg-[#534AB7] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    )}
                  >
                    {tone}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">
                  Formality: {FORMALITY[draft.voice.formality - 1]}
                </label>
                <input type="range" min={1} max={5} value={draft.voice.formality}
                  onChange={e => patchDraft({ voice: { ...draft.voice, formality: parseInt(e.target.value) } })}
                  className="w-full accent-[#534AB7]" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">
                  Pace: {PACE[draft.voice.pace - 1]}
                </label>
                <input type="range" min={1} max={5} value={draft.voice.pace}
                  onChange={e => patchDraft({ voice: { ...draft.voice, pace: parseInt(e.target.value) } })}
                  className="w-full accent-[#534AB7]" />
              </div>
            </div>
          </section>

          {/* Topics */}
          <section className="border border-[#534AB7]/20 rounded-xl p-5 bg-[#FAFAFF]">
            <p className="text-xs font-medium text-gray-400 mb-1">Topics you write about</p>
            <p className="text-xs text-gray-400 mb-3">Powers trending topic suggestions and keeps generations on your beat.</p>
            <ChipEditor
              values={draft.topics || []}
              onChange={topics => patchDraft({ topics })}
              suggestions={TOPIC_SUGGESTIONS}
            />
          </section>

          {/* Examples */}
          <section className="border border-[#534AB7]/20 rounded-xl p-5 bg-[#FAFAFF]">
            <p className="text-xs font-medium text-gray-400 mb-3">Writing examples</p>
            <EditTextarea label="Best piece (the single strongest voice signal)" value={draft.examples.good} rows={6} mono
              onChange={v => patchDraft({ examples: { ...draft.examples, good: v } })} />
            <div className="mt-3">
              <EditTextarea label="Content you dislike (optional)" value={draft.examples.bad} rows={3}
                onChange={v => patchDraft({ examples: { ...draft.examples, bad: v } })} />
            </div>
          </section>

          {/* Avoid */}
          <section className="border border-[#534AB7]/20 rounded-xl p-5 bg-[#FAFAFF]">
            <p className="text-xs font-medium text-gray-400 mb-1">Avoid list</p>
            <p className="text-xs text-gray-400 mb-3">One per line — these become hard stops in every generation.</p>
            <textarea
              value={draft.avoid.join('\n')}
              onChange={e => patchDraft({ avoid: e.target.value.split('\n').filter(a => a.trim() !== '') })}
              rows={5}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none bg-white"
            />
          </section>

          {/* Formats */}
          <section className="border border-[#534AB7]/20 rounded-xl p-5 bg-[#FAFAFF]">
            <p className="text-xs font-medium text-gray-400 mb-3">Platforms & cadence</p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {FORMAT_OPTIONS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    const preferred = draft.formats.preferred.includes(f)
                      ? draft.formats.preferred.filter(p => p !== f)
                      : [...draft.formats.preferred, f]
                    patchDraft({ formats: { ...draft.formats, preferred } })
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                    draft.formats.preferred.includes(f)
                      ? 'bg-[#534AB7] text-white border-[#534AB7]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CADENCES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => patchDraft({ formats: { ...draft.formats, cadence: c } })}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                    draft.formats.cadence === c
                      ? 'bg-[#534AB7] text-white border-[#534AB7]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </section>

          {/* Save bar */}
          {dnaError && (
            <p className="text-xs text-red-600">{dnaError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={cancelEditing}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveDNA}
              disabled={savingDNA}
              className="px-4 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {savingDNA ? 'Saving…' : 'Save profile'}
            </button>
          </div>

        </div>
      ) : brandDNA ? (
        <div className="space-y-4 mb-10">

          {/* Identity */}
          <section className="border border-gray-100 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-400 mb-2">Identity</p>
            <p className="text-sm font-medium text-gray-900">{brandDNA.identity.full_name}</p>
            <p className="text-sm text-gray-600 mt-0.5">
              {brandDNA.identity.role} · {brandDNA.identity.industry}
            </p>
          </section>

          {/* Audience */}
          <section className="border border-gray-100 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-400 mb-2">Audience</p>
            {brandDNA.audience.description && (
              <p className="text-sm text-gray-700 mb-3">{brandDNA.audience.description}</p>
            )}
            {brandDNA.audience.segments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {brandDNA.audience.segments.map(seg => (
                  <span key={seg} className="px-2.5 py-1 bg-gray-100 rounded-full text-xs text-gray-600">{seg}</span>
                ))}
              </div>
            )}
          </section>

          {/* Voice */}
          <section className="border border-gray-100 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-400 mb-2">Voice</p>
            {brandDNA.voice.description && (
              <p className="text-sm text-gray-700 mb-3">{brandDNA.voice.description}</p>
            )}
            {brandDNA.voice.tones.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {brandDNA.voice.tones.map(tone => (
                  <span key={tone} className="px-2.5 py-1 bg-[#EEEDFE] rounded-full text-xs font-medium text-[#534AB7]">{tone}</span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500">
              {FORMALITY[brandDNA.voice.formality - 1]} · {PACE[brandDNA.voice.pace - 1]}
            </p>
          </section>

          {/* Topics */}
          <section className="border border-gray-100 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-400 mb-2">Topics</p>
            {(brandDNA.topics || []).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {(brandDNA.topics || []).map(topic => (
                  <span key={topic} className="px-2.5 py-1 bg-[#EEEDFE] rounded-full text-xs font-medium text-[#534AB7]">{topic}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                No topics set yet — add them to sharpen trending topic suggestions.
              </p>
            )}
          </section>

          {/* Examples */}
          {(brandDNA.examples.good || brandDNA.examples.bad) && (
            <section className="border border-gray-100 rounded-xl p-5">
              <p className="text-xs font-medium text-gray-400 mb-2">Writing examples</p>
              {brandDNA.examples.good && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1">Best piece</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">{brandDNA.examples.good}</p>
                </div>
              )}
              {brandDNA.examples.bad && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">What to avoid</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">{brandDNA.examples.bad}</p>
                </div>
              )}
            </section>
          )}

          {/* Avoid list */}
          {brandDNA.avoid.length > 0 && (
            <section className="border border-gray-100 rounded-xl p-5">
              <p className="text-xs font-medium text-gray-400 mb-2">Avoid list</p>
              <ul className="space-y-1.5">
                {brandDNA.avoid.map((item, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-gray-300 mt-0.5">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Formats */}
          {brandDNA.formats.preferred.length > 0 && (
            <section className="border border-gray-100 rounded-xl p-5">
              <p className="text-xs font-medium text-gray-400 mb-2">Platforms & cadence</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {brandDNA.formats.preferred.map(f => (
                  <span key={f} className="px-2.5 py-1 bg-gray-100 rounded-full text-xs text-gray-600">{f}</span>
                ))}
              </div>
              {brandDNA.formats.cadence && (
                <p className="text-xs text-gray-500">{brandDNA.formats.cadence}</p>
              )}
            </section>
          )}

        </div>
      ) : (
        /* No brand DNA yet */
        <div className="border border-gray-100 rounded-xl p-8 text-center mb-10">
          <div className="w-10 h-10 bg-gray-100 rounded-xl mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-1">Voice profile not found</p>
          <p className="text-xs text-gray-400">
            Complete onboarding to set up your voice, or backfill from your existing data.
          </p>
        </div>
      )}

      {/* ─── Standing Rules ────────────────────────────────────── */}

      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-900">Standing rules</h2>
          {!showAdd && rules.length > 0 && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 text-xs text-[#534AB7] hover:opacity-80 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Add rule
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Instructions that apply to every piece you generate. Hard rules require confirmation to override.
        </p>

        {/* Rules list */}
        {rules.length > 0 ? (
          <div className="space-y-2 mb-4">
            {rules.map(rule => (
              <div key={rule.id} className="border border-gray-100 rounded-lg px-4 py-3">

                {editingId === rule.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      rows={2}
                      className="w-full text-sm text-gray-800 resize-none focus:outline-none bg-transparent"
                      autoFocus
                    />
                    <div className="flex items-center justify-between">
                      <TierToggle value={editTier} onChange={setEditTier} />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => updateRule(rule.id)}
                          disabled={!editContent.trim() || saving}
                          className="px-3 py-1.5 bg-[#534AB7] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-start gap-3">
                    <TierBadge tier={rule.tier} />
                    <p className="flex-1 text-sm text-gray-700 pt-0.5">{rule.content}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEdit(rule)}
                        className="p-1.5 text-gray-300 hover:text-gray-500 transition-colors rounded-md hover:bg-gray-50"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => closeRule(rule.id)}
                        disabled={closingId === rule.id}
                        className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded-md hover:bg-gray-50 disabled:opacity-40"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

              </div>
            ))}
          </div>
        ) : !showAdd ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center mb-4">
            <p className="text-sm text-gray-400 mb-3">
              No standing rules yet. Rules you add here will guide every piece Vowwl generates.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#534AB7] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Add your first rule
            </button>
          </div>
        ) : null}

        {/* Add form */}
        {showAdd && (
          <div className="border border-[#534AB7]/20 rounded-lg p-4 space-y-3 bg-[#FAFAFF]">
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder='e.g. "Never use em dashes" or "Always mention the product by name"'
              rows={2}
              className="w-full text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none bg-transparent"
              autoFocus
            />
            <div className="flex items-center justify-between">
              <TierToggle value={newTier} onChange={setNewTier} />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowAdd(false); setNewContent(''); setNewTier('default') }}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addRule}
                  disabled={!newContent.trim() || saving}
                  className="px-3 py-1.5 bg-[#534AB7] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save rule'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────

function EditField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] bg-white"
      />
    </div>
  )
}

function EditTextarea({
  label, value, rows, mono, onChange,
}: { label: string; value: string; rows: number; mono?: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className={cn(
          'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none bg-white',
          mono && 'font-mono'
        )}
      />
    </div>
  )
}

function ChipEditor({
  label, values, onChange, suggestions,
}: {
  label?: string
  values: string[]
  onChange: (values: string[]) => void
  suggestions?: string[]
}) {
  const [input, setInput] = useState('')

  function add(value: string) {
    const v = value.trim()
    if (v && !values.includes(v)) onChange([...values, v])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      add(input)
      setInput('')
    }
  }

  const remaining = (suggestions || []).filter(s => !values.includes(s))

  return (
    <div>
      {label && <p className="text-xs text-gray-500 mb-1.5">{label}</p>}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map(v => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#534AB7] text-white rounded-full text-xs font-medium"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter(x => x !== v))}
                className="hover:opacity-70 ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type and press Enter to add"
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] bg-white"
      />
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {remaining.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TierBadge({ tier }: { tier: 'default' | 'hard_rule' }) {
  if (tier === 'hard_rule') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-medium flex-shrink-0 mt-0.5">
        <Shield className="w-3 h-3" />
        Hard rule
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium flex-shrink-0 mt-0.5">
      <BookOpen className="w-3 h-3" />
      Guideline
    </span>
  )
}

function TierToggle({
  value,
  onChange,
}: {
  value: 'default' | 'hard_rule'
  onChange: (v: 'default' | 'hard_rule') => void
}) {
  return (
    <div className="flex gap-1">
      <button
        onClick={() => onChange('default')}
        className={cn(
          'px-2.5 py-1 rounded text-xs font-medium transition-all',
          value === 'default'
            ? 'bg-gray-200 text-gray-700'
            : 'text-gray-400 hover:text-gray-600'
        )}
      >
        Guideline
      </button>
      <button
        onClick={() => onChange('hard_rule')}
        className={cn(
          'px-2.5 py-1 rounded text-xs font-medium transition-all',
          value === 'hard_rule'
            ? 'bg-amber-100 text-amber-700'
            : 'text-gray-400 hover:text-gray-600'
        )}
      >
        Hard rule
      </button>
    </div>
  )
}
