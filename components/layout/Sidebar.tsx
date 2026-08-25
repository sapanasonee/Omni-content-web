'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { WorkspaceVoice } from '@/lib/active-workspace'
import {
  PenLine,
  MessageSquare,
  Library,
  Dna,
  LayoutDashboard,
  ChevronDown,
  Plus,
  LogOut,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface SidebarProps {
  activeWorkspaceId: string
  generationsUsed: number
  voices: WorkspaceVoice[]
  userEmail: string
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/generate', label: 'Generate', icon: PenLine },
  { href: '/comments', label: 'Comments', icon: MessageSquare },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/dna', label: 'Brand DNA', icon: Dna },
]

function voiceLabelOf(v: WorkspaceVoice): string {
  return v.voice_label || v.persona_display_name || 'Untitled voice'
}

export default function Sidebar({ activeWorkspaceId, generationsUsed, voices, userEmail }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  const active = voices.find(v => v.id === activeWorkspaceId) ?? voices[0]
  const others = voices.filter(v => v.id !== active?.id)

  async function switchTo(workspaceId: string) {
    if (switching || workspaceId === active?.id) {
      setSwitcherOpen(false)
      return
    }
    setSwitching(true)
    try {
      const res = await fetch('/api/workspace/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      })
      if (res.ok) {
        setSwitcherOpen(false)
        // Every page resolves its workspace/persona via a fresh /api/me call —
        // a full reload is the simplest way to make all of them (and this
        // server-rendered layout) pick up the newly active workspace.
        window.location.reload()
      }
    } finally {
      setSwitching(false)
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
          <img src="/icon.svg" alt="Vowwl" className="w-7 h-7 rounded-lg" />
          <span className="text-sm font-bold text-gray-900">Vowwl</span>
        </div>
      </div>

      {/* Voice switcher */}
      <div className="px-3 py-3 border-b border-gray-100">
        <button
          onClick={() => setSwitcherOpen(!switcherOpen)}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 bg-[#EEEDFE] rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-[#534AB7]">
                {active ? voiceLabelOf(active)[0] : 'V'}
              </span>
            </div>
            <span className="text-xs font-medium text-gray-700 truncate">
              {active ? voiceLabelOf(active) : 'Voice'}
            </span>
          </div>
          <ChevronDown className={cn(
            'w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0',
            switcherOpen && 'rotate-180'
          )} />
        </button>

        {switcherOpen && (
          <div className="mt-1 space-y-0.5">
            {others.map(voice => (
              <button
                key={voice.id}
                disabled={switching}
                onClick={() => switchTo(voice.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <div className="w-5 h-5 bg-[#EEEDFE] rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-medium text-[#534AB7]">
                    {voiceLabelOf(voice)[0]}
                  </span>
                </div>
                <span className="truncate">{voiceLabelOf(voice)}</span>
              </button>
            ))}
            <Link
              href="/onboarding"
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-[#534AB7] hover:bg-[#EEEDFE] transition-colors"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              Add another voice
            </Link>
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
              {generationsUsed}/30
            </span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#534AB7] rounded-full transition-all"
              style={{ width: `${Math.min((generationsUsed / 30) * 100, 100)}%` }}
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
