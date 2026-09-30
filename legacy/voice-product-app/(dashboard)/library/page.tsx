'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type Format = 'linkedin' | 'twitter' | 'newsletter' | 'blog' | 'exec_brief'

interface ContentPiece {
  id: string
  format: Format
  body: string
  topic: string
  status: string
  mode: string
  generation_mode: string
  quality_score: number | null
  critique_passed: boolean | null
  rag_excluded: boolean
  approved_at: string | null
  created_at: string
}

const FORMAT_LABELS: Record<Format, string> = {
  linkedin: 'LinkedIn',
  twitter: 'Twitter',
  newsletter: 'Newsletter',
  blog: 'Blog',
  exec_brief: 'Exec Brief',
}

const FORMAT_COLORS: Record<Format, string> = {
  linkedin: 'bg-blue-50 text-blue-700 border-blue-200',
  twitter: 'bg-sky-50 text-sky-700 border-sky-200',
  newsletter: 'bg-amber-50 text-amber-700 border-amber-200',
  blog: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  exec_brief: 'bg-violet-50 text-violet-700 border-violet-200',
}

const QUALITY_LABELS: Record<number, { label: string; color: string }> = {
  3: { label: 'High', color: 'bg-green-100 text-green-700' },
  2: { label: 'Medium', color: 'bg-amber-100 text-amber-700' },
  1: { label: 'Low', color: 'bg-red-100 text-red-700' },
}

export default function LibraryPage() {
  const [items, setItems] = useState<ContentPiece[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFormat, setActiveFormat] = useState<Format | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    loadLibrary()
  }, [])

  async function loadLibrary() {
    try {
      setLoading(true)
      const metaRes = await fetch('/api/me')
      const meta = await metaRes.json()

      const params = new URLSearchParams({
        workspace_id: meta.workspace_id,
        persona_id: meta.persona_id,
        status: 'approved',
        limit: '50',
      })

      const res = await fetch(`/api/library?${params}`)
      if (!res.ok) throw new Error('Failed to load library')
      const data = await res.json()
      setItems(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy(piece: ContentPiece) {
    await navigator.clipboard.writeText(piece.body)
    setCopied(piece.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const filtered = activeFormat === 'all'
    ? items
    : items.filter(i => i.format === activeFormat)

  const formatCounts = items.reduce((acc, item) => {
    acc[item.format] = (acc[item.format] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  }

  function truncate(text: string, chars = 180) {
    return text.length > chars ? text.slice(0, chars) + '...' : text
  }

  return (
    <div className="flex h-full flex-col">

      {/* Header */}
      <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Content Library</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {items.length} approved {items.length === 1 ? 'piece' : 'pieces'} in your brand memory
          </p>
        </div>
        <button
          onClick={loadLibrary}
          className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Format filter tabs */}
      <div className="px-8 py-3 border-b border-gray-100 flex items-center gap-2">
        <button
          onClick={() => setActiveFormat('all')}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
            activeFormat === 'all'
              ? 'bg-[#534AB7] text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          All ({items.length})
        </button>
        {(Object.keys(FORMAT_LABELS) as Format[]).map(f => {
          const count = formatCounts[f] || 0
          if (count === 0) return null
          return (
            <button
              key={f}
              onClick={() => setActiveFormat(f)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                activeFormat === f
                  ? 'bg-[#534AB7] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {FORMAT_LABELS[f]} ({count})
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">

        {loading && (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            Loading library...
          </div>
        )}

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-xl mx-auto mb-3" />
            <p className="text-sm text-gray-500">No approved content yet.</p>
            <p className="text-xs text-gray-400 mt-1">Generate and approve posts to build your library.</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-4 max-w-4xl">
            {filtered.map(piece => (
              <div
                key={piece.id}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-all"
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'px-2 py-0.5 rounded-md text-xs font-medium border',
                      FORMAT_COLORS[piece.format]
                    )}>
                      {FORMAT_LABELS[piece.format]}
                    </span>
                    {piece.quality_score && (
                      <span className={cn(
                        'px-2 py-0.5 rounded-md text-xs font-medium',
                        QUALITY_LABELS[piece.quality_score].color
                      )}>
                        {QUALITY_LABELS[piece.quality_score].label} quality
                      </span>
                    )}
                    {piece.rag_excluded && (
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-500">
                        Not in RAG
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatDate(piece.approved_at || piece.created_at)}
                  </span>
                </div>

                {/* Topic */}
                {piece.topic && (
                  <p className="text-xs font-medium text-gray-500 mb-2">{piece.topic}</p>
                )}

                {/* Body preview */}
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {expandedId === piece.id ? piece.body : truncate(piece.body)}
                </p>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-4">
                  {piece.body.length > 180 && (
                    <button
                      onClick={() => setExpandedId(expandedId === piece.id ? null : piece.id)}
                      className="text-xs text-[#534AB7] hover:underline"
                    >
                      {expandedId === piece.id ? 'Show less' : 'Read more'}
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(piece)}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-lg border transition-all',
                        copied === piece.id
                          ? 'bg-green-50 border-green-200 text-green-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {copied === piece.id ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
