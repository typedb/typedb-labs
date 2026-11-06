// Engagement, shown so that a reader can see exactly why: a level always comes with its category in words,
// and every finding with its reason and the records behind it. Everything comes from the API.
import { useState } from 'react'
import { CalendarClock, CircleHelp, Clock, FileText, Flag, Lock, MessageSquareWarning, ShieldAlert, X } from 'lucide-react'
import type { Schemas } from '@/api/client'
import { formatDate, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Assessment = Schemas['Assessment']

export const LEVEL: Record<string, { label: string; cls: string; dot: string }> = {
  red: { label: 'Red', cls: 'bg-risk-soft text-risk ring-risk/25', dot: 'bg-risk' },
  amber: { label: 'Amber', cls: 'bg-warn-soft text-warn ring-warn/25', dot: 'bg-warn' },
  green: { label: 'Green', cls: 'bg-ok-soft text-ok ring-ok/20', dot: 'bg-ok' },
  unknown: { label: 'Unknown', cls: 'bg-muted text-muted-foreground ring-border', dot: 'bg-idle' },
  'not-yet-active': { label: 'Not yet active', cls: 'bg-muted text-muted-foreground ring-border', dot: 'bg-idle/60' },
  'not-assessed': { label: 'Not assessed', cls: 'bg-muted text-muted-foreground ring-border', dot: 'bg-idle/60' },
  none: { label: 'Nothing to assess', cls: 'bg-muted text-muted-foreground ring-border', dot: 'bg-border' },
}

export const CATEGORY: Record<string, string> = {
  'overdue-response': 'Overdue response', 'response-due': 'Response due soon', 'response-awaited': 'Response awaited',
  inactivity: 'Inactive on an assigned item', 'deal-risk': 'Deal risk', engaged: 'Engaged',
  'insufficient-information': 'Insufficient information', 'not-yet-active': 'Not yet active',
  'statutory-timetable': 'Statutory timetable', 'decision-recorded': 'Decision recorded',
  'requests-only': 'Assessed on requests only', deadline: 'Deadline: a limit, not work', authority: 'Not assessed: authority', none: '',
}

/** "Red · Overdue response". Never colour alone. */
export function EngagementBadge({ level, category, className }: { level: string; category?: string; className?: string }) {
  const l = LEVEL[level] ?? LEVEL.none
  const c = category ? CATEGORY[category] : ''
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset', l.cls, className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', l.dot)} aria-hidden />
      {l.label}{c && c !== l.label && <span className="truncate font-normal opacity-90">· {c}</span>}
    </span>
  )
}

const FLAG_LABEL: [keyof Schemas['Flags'], string, typeof Flag][] = [
  ['overdue-response' as never, 'Overdue responses', MessageSquareWarning],
  ['deal-risk' as never, 'Deal risk', ShieldAlert],
  ['inactivity' as never, 'Inactive on an item', Clock],
  ['response-due' as never, 'Responses due soon', CalendarClock],
  ['insufficient-information' as never, 'Insufficient information', CircleHelp],
  ['not-yet-active' as never, 'Not yet active', Flag],
]

/** The four distinctions the owner asked for, counted separately, never merged. */
export function Flags({ flags }: { flags: Schemas['Flags'] }) {
  const f = flags as unknown as Record<string, number>
  return (
    <div className="flex flex-wrap gap-1.5">
      {FLAG_LABEL.map(([k, label, Icon]) => (
        <span key={k} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]',
          f[k] ? 'border-border bg-white text-ink' : 'border-dashed text-muted-foreground/70')}>
          <Icon className="size-3.5" aria-hidden />{label}<span className="font-semibold tabular">{f[k] ?? 0}</span>
        </span>
      ))}
    </div>
  )
}

const GROUPS: [string, string[]][] = [
  ['Overdue responses: a request with a passed reply-by date and no response recorded', ['overdue-response']],
  ['Deal risk: inactivity on an item that matters now', ['deal-risk']],
  ['Inactive on an assigned item', ['inactivity']],
  ['Statutory timetable', ['statutory-timetable']],
  ['Responses due or awaited', ['response-due', 'response-awaited']],
  ['Insufficient information', ['insufficient-information']],
  ['Engaged', ['engaged']],
  ['Not yet active', ['not-yet-active']],
  ['Not assessed', ['requests-only', 'deadline', 'authority', 'decision-recorded']],
]

/** Every finding, grouped by category, with its reason and clickable evidence. */
export function Assessments({ assessments, onItem }: { assessments: Assessment[]; onItem: (code: string) => void }) {
  return (
    <div className="space-y-4">
      {GROUPS.map(([title, cats]) => {
        const rows = assessments.filter((a) => cats.includes(a.category))
        if (!rows.length) return null
        const quiet = title === 'Not assessed' || title === 'Not yet active' || title === 'Engaged'
        return (
          <section key={title}>
            <h3 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">{title} · {rows.length}</h3>
            <ul className={cn('space-y-1.5', quiet && 'text-muted-foreground')}>
              {rows.map((a, n) => <Finding key={`${a.item}-${a.letter}-${n}`} a={a} onItem={onItem} quiet={quiet} />)}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Finding({ a, onItem, quiet }: { a: Assessment; onItem: (code: string) => void; quiet: boolean }) {
  return (
    <li className={cn('rounded-lg border px-3 py-2', quiet ? 'border-dashed bg-transparent' : 'bg-white')}>
      <div className="flex items-start gap-2">
        <EngagementBadge level={a.level} className="mt-0.5 shrink-0" />
        <p className={cn('min-w-0 text-[12.5px] leading-snug', quiet ? 'text-muted-foreground' : 'text-ink-soft')}>{a.reason}</p>
      </div>
      {a.context && <p className="mt-1 pl-1 text-[11.5px] text-muted-foreground italic">{a.context}</p>}
      {!quiet && a.evidence.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">Records:</span>
          {a.evidence.map((e) => (
            <button key={e.kind + e.code} type="button" onClick={() => onItem(e.kind === 'event' || e.kind === 'request' ? a.item : e.code)}
              title={`${e.code}${e.date ? ` · ${formatDate(e.date)}` : ''}`}
              className="inline-flex max-w-72 cursor-pointer items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-ink-soft hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
              <FileText className="size-3 shrink-0" aria-hidden />
              <span className="shrink-0 font-mono text-[10.5px] whitespace-nowrap text-muted-foreground">{e.code}</span>
              <span className="truncate">{e.label}</span>
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

/** The access request is a demonstration only (decision D8): nothing is sent or stored. */
export function AccessRequestDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand">
        <Lock className="size-3.5" aria-hidden />Request full contact details
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="access-demo-title" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={() => setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 id="access-demo-title" className="text-[16px] font-semibold text-ink">Demonstration only: no request is sent or stored</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" autoFocus className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
            </div>
            <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-soft">
              <p>Contact details are stored in TypeDB but masked on the server: the browser never receives a full address or number. A real system would decide who may see them, at three levels:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li><span className="font-medium text-ink">Viewing participants</span>: names, roles and responsibilities.</li>
                <li><span className="font-medium text-ink">Viewing full contact details</span>: granted per person, for a reason.</li>
                <li><span className="font-medium text-ink">Administering access</span>: granting and revoking the levels above.</li>
              </ol>
              <p>That needs authenticated identities, authorisation checked on the server for every request, and an audit log. This demonstration has none of them, so it shows only masked values. Every contact here is fictional: <code>.example</code> addresses and Ofcom drama numbers reach no one.</p>
              <p className="text-[12px] text-muted-foreground">Masking in the browser would not be a security control; here the masking happens before the data leaves the API. Anyone with direct database access (TypeDB Studio) can read the fictional values.</p>
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" disabled aria-disabled="true" className="cursor-not-allowed rounded-md bg-ink/40 px-3 py-1.5 text-[13px] font-medium text-white">Request access (disabled in this demonstration)</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function daysText(n: number | null | undefined) {
  return n == null ? '' : plural(n, 'day')
}
