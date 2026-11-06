// A workstream's activity history from the typed event model: requests (with their reply-by date and
// any recorded responses), responses, meetings, deliveries, decisions, notices and status changes.
import { useMemo, useState } from 'react'
import { ArrowDownUp, ArrowRight, Bell, CalendarCheck, CornerDownRight, FileCheck, Gavel, RefreshCw, Send, Users } from 'lucide-react'
import type { Schemas } from '@/api/client'
import { ScrollArea } from '@/components/scroll-area'
import { StatusBadge } from '@/components/status'
import { formatDate, formatDateTime, humanise, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Event = Schemas['WorkstreamEvent']

const TYPES: Record<string, { label: string; icon: typeof Send }> = {
  request: { label: 'Requests', icon: Send }, response: { label: 'Responses', icon: CornerDownRight },
  meeting: { label: 'Meetings', icon: Users }, delivery: { label: 'Deliveries', icon: FileCheck },
  decision: { label: 'Decisions', icon: Gavel }, notice: { label: 'Notices', icon: Bell },
  'status-change': { label: 'Status changes', icon: RefreshCw },
}

export function ActivityFeed({ events, onSelect, asOf }: { events: Event[]; onSelect: (item: string) => void; asOf: string }) {
  const [type, setType] = useState<string>('all')
  const [oldestFirst, setOldestFirst] = useState(false)
  const byCode = useMemo(() => new Map(events.map((e) => [e.code, e])), [events])
  const counts = useMemo(() => events.reduce<Record<string, number>>((n, e) => ({ ...n, [e.type]: (n[e.type] ?? 0) + 1 }), {}), [events])
  const shown = events.filter((e) => type === 'all' || e.type === type)
  const ordered = oldestFirst ? [...shown].reverse() : shown

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 px-6 pb-3" role="group" aria-label="Filter events by type">
        <Chip active={type === 'all'} onClick={() => setType('all')}>All · {events.length}</Chip>
        {Object.entries(TYPES).filter(([t]) => counts[t]).map(([t, { label }]) => (
          <Chip key={t} active={type === t} onClick={() => setType(t)}>{label} · {counts[t]}</Chip>
        ))}
        <button type="button" onClick={() => setOldestFirst(!oldestFirst)} aria-pressed={oldestFirst}
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
          <ArrowDownUp className="size-3.5" />{oldestFirst ? 'Oldest first' : 'Newest first'}
        </button>
      </div>
      <ScrollArea label="Activity history" className="max-h-[720px] border-t" innerClassName="px-6 py-4"
        more="Scroll for more events" done={`End of ${plural(ordered.length, 'event')}`}>
        <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
          {ordered.map((e, n) => {
            const { icon: Icon } = TYPES[e.type] ?? TYPES.delivery
            const day = e.when.slice(0, 10)
            const showDay = n === 0 || ordered[n - 1].when.slice(0, 10) !== day
            return (
              <li key={e.code} className="relative flex gap-3">
                <div className="z-10 flex size-[31px] shrink-0 items-center justify-center rounded-full border bg-card text-brand"><Icon className="size-3.5" aria-hidden /></div>
                <div className="min-w-0 flex-1 pt-0.5">
                  {showDay && <div className="mb-0.5 text-[10.5px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{formatDate(day)}</div>}
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] leading-snug text-ink">{e.summary}</span>
                    <span className="rounded bg-muted px-1.5 text-[10.5px] font-medium text-muted-foreground">{humanise(e.type)}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {e.actor.name}{e.actor.employer ? `, ${e.actor.employer}` : ''} · {formatDateTime(e.when).split(', ')[1]} · on{' '}
                    <button type="button" onClick={() => onSelect(e.item.code)} className="cursor-pointer font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand">{e.item.name}</button>
                  </div>
                  <Details e={e} byCode={byCode} asOf={asOf} onSelect={onSelect} />
                </div>
              </li>
            )
          })}
        </ol>
      </ScrollArea>
    </div>
  )
}

function Details({ e, byCode, asOf, onSelect }: { e: Event; byCode: Map<string, Event>; asOf: string; onSelect: (item: string) => void }) {
  const lines: React.ReactNode[] = []
  if (e.agenda.length) {
    lines.push(<>Discussed: {e.agenda.map((a, n) => (
      <span key={a.code}>{n > 0 && ', '}<button type="button" onClick={() => onSelect(a.code)}
        className="cursor-pointer font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand">{a.name}</button></span>
    ))}</>)
  }
  if (e.recipients.length) lines.push(<>To {e.recipients.map((r) => r.name).join(', ')}</>)
  if (e.attendees.length) lines.push(<>Attended by {e.attendees.map((r) => r.name).join(', ')}</>)
  if (e.type === 'request' && e.response_due) {
    const answers = e.answered_by
    lines.push(answers.length
      ? <><CalendarCheck className="inline size-3.5 text-ok" aria-hidden /> Reply by {formatDate(e.response_due)} · answered {answers.map((a) => formatDate(a.when.slice(0, 10))).join(', ')}</>
      : <span className={cn(e.response_due < asOf && 'font-medium text-warn')}>Reply by {formatDate(e.response_due)} · no response recorded{e.response_due < asOf ? ', and the date has passed' : ''}</span>)
  }
  for (const q of e.replies_to) {
    const original = byCode.get(q)
    lines.push(<>Replies to: {original ? `“${original.summary}” (${formatDate(original.when.slice(0, 10))})` : q}</>)
  }
  if (e.type === 'status-change' && e.new_status) {
    lines.push(<span className="inline-flex items-center gap-1.5"><StatusBadge status={e.previous_status} /><ArrowRight className="size-3" aria-hidden /><StatusBadge status={e.new_status} /></span>)
  }
  if (e.automated) lines.push(<>Sent automatically</>)
  if (!lines.length) return null
  return <div className="mt-1 space-y-0.5 text-[11.5px] text-ink-soft">{lines.map((l, i) => <div key={i}>{l}</div>)}</div>
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('cursor-pointer rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand',
        active ? 'border-ink bg-ink text-white' : 'bg-white text-muted-foreground hover:text-ink')}>
      {children}
    </button>
  )
}
