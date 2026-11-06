import { useEffect, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NavLink } from 'react-router'
import { Bot, DatabaseZap, FlaskConical, LayoutDashboard, ListChecks, Network, Users, Waypoints } from 'lucide-react'
import { Link } from 'react-router'
import { Advantage } from '@/components/advantage'
import { useDeal, useHealth } from '@/api/client'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Deal Overview', short: 'Overview', icon: LayoutDashboard, soon: false },
  { to: '/workstreams', label: 'Workstreams', short: 'Workstreams', icon: ListChecks, soon: false },
  { to: '/parties', label: 'Parties', short: 'Parties', icon: Users, soon: false },
  { to: '/explorer', label: 'Relationship Explorer', short: 'Relationships', icon: Network, soon: false },
  { to: '/impact', label: 'Impact Explorer', short: 'Impact', icon: Waypoints, soon: false },
  { to: '/analyst', label: 'AI Analyst', short: 'AI Analyst', icon: Bot, soon: false, concept: true },
]

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
      <rect width="32" height="32" rx="8" fill="currentColor" className="text-white/10" />
      <path d="M9 23 16 8l7 15h-4.2L16 16.6 13.2 23z" fill="#5eead4" />
    </svg>
  )
}

/** One banner while TypeDB is unreachable; when it answers again, every panel reloads by itself. */
function ConnectionBanner() {
  const health = useHealth()
  const client = useQueryClient()
  const wasDown = useRef(false)
  const ok = health.data?.ok
  useEffect(() => {
    if (ok === false) wasDown.current = true
    if (ok && wasDown.current) { wasDown.current = false; client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'health' }) }
  }, [ok, client])
  if (ok !== false) return null
  return (
    <div className="border-b border-risk/20 bg-risk-soft">
      <div className="mx-auto flex max-w-[1440px] items-center gap-2.5 px-4 py-2.5 text-[13px] text-risk sm:px-6 lg:px-8">
        <DatabaseZap className="size-4 shrink-0" />
        <span className="font-medium">{health.data?.detail}</span>
        <span className="text-risk/75">Retrying automatically; the screens will refresh when it is back.</span>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const deal = useDeal()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-ink text-white shadow-[0_1px_0_rgba(255,255,255,0.06)]">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="leading-tight whitespace-nowrap">
              <div className="text-[15px] font-semibold tracking-tight">{deal.data?.data.name ?? 'Deal workspace'}</div>
              <div className="flex items-center gap-1 text-[11px] text-amber-200/75" title="All companies, people and events are fictional">
                <FlaskConical className="size-3" aria-hidden />Fictional demonstration data
              </div>
            </div>
          </div>
          <nav className="ml-2 hidden items-center gap-0.5 md:flex">
            {NAV.map(({ to, label, short, icon: Icon, soon, concept }) => (
              <NavLink key={to} to={to} end={to === "/"} title={label} className={({ isActive }) => cn(
                'inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors min-[1400px]:px-3',
                isActive ? 'bg-white/12 text-white' : 'text-white/65 hover:bg-white/6 hover:text-white')}>
                <Icon className="hidden size-4 shrink-0 min-[1400px]:block" aria-hidden /><span className="min-[1600px]:hidden">{short}</span><span className="hidden min-[1600px]:inline">{label}</span>
                {soon && <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-medium text-white/60">Soon</span>}
                {concept && <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-medium text-white/70" title="Concept preview: no AI model runs">Concept</span>}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-[12px]">
            {deal.data && (
              <span className="hidden whitespace-nowrap text-white/60 lg:inline" title="The scenario date stored in TypeDB; the app never uses today's date">
                <span className="hidden min-[1400px]:inline">Scenario date </span><span className="font-medium text-white/85">{formatDate(deal.data.data.as_of)}</span>
              </span>
            )}
            <Advantage />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {NAV.map(({ to, label, soon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cn('whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
              isActive ? 'bg-white/12 text-white' : 'text-white/65')}>{label}{soon ? ' · Soon' : ''}</NavLink>
          ))}
        </nav>
      </header>
      <ConnectionBanner />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      <footer className="border-t border-border bg-white/60">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>All companies, people and events are fictional. Real public authorities appear only in an invented scenario.</span>
          <span><Link to="/guide" className="font-medium text-foreground hover:underline">Guided demonstration</Link> · Every figure is read live from <span className="font-medium text-foreground">TypeDB</span> · Open source (Apache-2.0)</span>
        </div>
      </footer>
    </div>
  )
}
