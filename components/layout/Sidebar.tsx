'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Workspace, Persona } from '@/lib/types'
import {
  PenLine,
  MessageSquare,
  Library,
  Dna,
  LayoutDashboard,
  ChevronDown,
  LogOut,
  Plus,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface SidebarProps {
  workspace: Workspace
  personas: Persona[]
  // Resolved server-side (active_persona_id, else oldest) so the highlighted
  // voice always matches the one /api/me hands to the generate page.
  activePersonaId: string | null
  canAddVoice: boolean
  userEmail: string
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/generate', label: 'Generate', icon: PenLine },
  { href: '/comments', label: 'Comments', icon: MessageSquare },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/dna', label: 'Brand DNA', icon: Dna },
]

export default function Sidebar({
  workspace, personas, activePersonaId, canAddVoice, userEmail,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [personaOpen, setPersonaOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)

  // Derived from the server prop, NOT local state. The previous version kept
  // the selection in useState, so switching updated the label and nothing
  // else — every generation still ran under the workspace's first persona.
  const activePersona =
    personas.find(p => p.id === activePersonaId) || personas[0]

  async function handleSwitchPersona(persona: Persona) {
    if (persona.id === activePersona?.id) {
      setPersonaOpen(false)
      return
    }
    setSwitching(persona.id)
    try {
      const res = await fetch('/api/personas/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, persona_id: persona.id }),
      })
      if (!res.ok) throw new Error('switch failed')
      setPersonaOpen(false)
      // Re-render server components so every page picks up the new voice.
      // refresh() alone is enough here because persona_id is resolved
      // server-side; client pages re-fetch /api/me on mount.
      router.refresh()
    } catch {
      // Leave the menu open on failure so the unchanged selection is visible
      // rather than silently reverting behind a closed dropdown.
    } finally {
      setSwitching(null)
    }
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="w-56 flex flex-col bg-white border-r border-gray-100 h-screen">

      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#534AB7] rounded-lg" />
          <span className="text-sm font-bold text-gray-900">Vowwl</span>
        </div>
      </div>

      {/* Persona switcher */}
      <div className="px-3 py-3 border-b border-gray-100">
        <button
          onClick={() => setPersonaOpen(!personaOpen)}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 bg-[#EEEDFE] rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-[#534AB7]">
                {activePersona?.display_name?.[0] || 'D'}
              </span>
            </div>
            <span className="text-xs font-medium text-gray-700 truncate">
              {activePersona?.display_name || 'Default'}
            </span>
          </div>
          <ChevronDown className={cn(
            'w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0',
            personaOpen && 'rotate-180'
          )} />
        </button>

        {/* Persona dropdown. Opens whenever there is anywhere to go — another
            voice to switch to, or room to add one. */}
        {personaOpen && (personas.length > 1 || canAddVoice) && (
          <div className="mt-1 space-y-0.5">
            {personas.map(persona => (
              <button
                key={persona.id}
                onClick={() => handleSwitchPersona(persona)}
                disabled={switching !== null}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50',
                  activePersona?.id === persona.id
                    ? 'bg-[#EEEDFE] text-[#534AB7]'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                <div className="w-5 h-5 bg-[#EEEDFE] rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-medium text-[#534AB7]">
                    {persona.display_name?.[0] || '?'}
                  </span>
                </div>
                <span className="truncate">{persona.display_name}</span>
                {switching === persona.id && (
                  <span className="ml-auto w-3 h-3 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
              </button>
            ))}

            {canAddVoice && (
              <Link
                href="/onboarding?mode=add-voice"
                onClick={() => setPersonaOpen(false)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
              >
                <div className="w-5 h-5 rounded-full border border-dashed border-gray-300 flex items-center justify-center flex-shrink-0">
                  <Plus className="w-3 h-3" />
                </div>
                Add a brand voice
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-[#EEEDFE] text-[#534AB7] font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Usage bar */}
      <div className="px-4 py-3 border-t border-gray-100">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Generations</span>
            <span className="text-xs text-gray-500">
              {workspace.generations_used}/30
            </span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#534AB7] rounded-full transition-all"
              style={{ width: `${Math.min((workspace.generations_used / 30) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* User + sign out */}
      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 truncate flex-1 mr-2">
            {userEmail}
          </span>
          <button
            onClick={handleSignOut}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-50"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

    </aside>
  )
}