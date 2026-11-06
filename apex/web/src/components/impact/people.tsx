// "Who needs to act, and why?": the selected item's chain and dependencies, and everyone with a RACI
// letter on an affected item or deadline. All from /api/impact (RACI read from TypeDB).
import { useState } from 'react'
import { ArrowRight, Building2, ChevronDown, Flag, X } from 'lucide-react'
import type { Schemas } from '@/api/client'
import { StatusDot } from '@/components/status'
import { formatDate, humanise, initials, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Impact = Schemas['Impact']
const WORD: Record<string, string> = { A: 'Accountable', R: 'Responsible', C: 'Consulted', I: 'Informed' }
const CHIP: Record<string, string> = { A: 'bg-ink text-white', R: 'bg-brand text-white', C: 'bg-info-soft text-info', I: 'bg-muted text-muted-foreground' }

function Letter({ l }: { l: string }) {
  return <span className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold', CHIP[l])} title={WORD[l]}>{l}</span>
}

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{children}</h4>
}

/** The selected item: why it moves (the chain TypeDB's recursion found), its dependencies, its people. */
export function ItemPanel({ data, code, onSelect, onClose }: { data: Impact; code: string; onSelect: (c: string) => void; onClose: () => void }) {
  const [more, setMore] = useState(false)
  const item = [...data.items, ...data.deadlines, ...data.context].find((i) => i.code === code)
  if (!item) return null
  const dl = item.role === 'deadline' ? (item as Schemas['ImpactDeadline']) : undefined
  const byCode = new Map([...data.items, ...data.deadlines, ...data.context].map((i) => [i.code, i]))
  const name = (c: string) => byCode.get(c)?.name ?? data.names[c] ?? c
  const incoming = data.dependencies.filter((d) => d.to === code)
  const outgoing = data.dependencies.filter((d) => d.from === code)
  const isHard = (k: string) => data.hard_kinds.includes(k)
  const actors = item.raci.filter((r) => r.letter === 'A' || r.letter === 'R')
  const others = item.raci.filter((r) => r.letter === 'C' || r.letter === 'I')
  const chain = dl ? data.items.find((i) => i.code === [...dl.limits].sort((a, b) => b.days_over - a.days_over)[0]?.code)?.path ?? [] : item.path
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {item.role === 'start' ? 'The delayed approval' : dl ? 'Contractual deadline' : item.role === 'context' ? 'Linked by a soft dependency' : humanise(item.type)}
          </div>
          <h3 className="mt-0.5 text-[16px] leading-snug font-semibold text-ink">{item.name}</h3>
          <div className="mt-1 text-[12px] text-muted-foreground">{item.workstream?.name}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-ink"><X className="size-4" /></button>
      </div>

      {dl ? (
        <div className={cn('rounded-lg px-3 py-2.5 text-[12.5px]', dl.breached ? 'bg-risk-soft text-risk' : 'bg-ok-soft text-ok')}>
          <div className="font-semibold">{dl.breached ? `Breached by ${plural(dl.days_over, 'day')}` : `${dl.headroom_days} days of headroom`}</div>
          <div className="text-foreground/70">Due {formatDate(dl.due)} · {dl.breach_from_days != null ? `breached from ${dl.breach_from_days} days of delay` : 'not reached'}</div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Planned {formatDate(item.planned)}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <span className={cn('font-semibold', item.shift_days > 0 ? 'text-warn' : 'text-ink')}>Projected {formatDate(item.projected)}</span>
          {item.shift_days > 0 && <span className="rounded bg-warn-soft px-1.5 text-[11px] font-semibold text-warn">+{item.shift_days} days</span>}
        </div>
      )}

      {chain.length > 1 && (
        <div>
          <H>{dl ? 'How the delay reaches it' : 'Why it moves'}</H>
          <ol className="space-y-1">
            {chain.map((c, i) => {
              const step = byCode.get(c)
              const cause = step?.caused_by.find((x) => x.code === chain[i - 1])
              return (
                <li key={c} className="flex items-start gap-2 text-[12.5px]">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', i === 0 ? 'bg-ink' : 'bg-warn')} />
                  <span className="min-w-0">
                    <button type="button" onClick={() => onSelect(c)} className="font-medium text-ink hover:underline">{name(c)}</button>
                    {cause && <span className="text-muted-foreground"> · {humanise(cause.kind)}{cause.lag ? `, at least ${cause.lag} days after` : ', straight after'}</span>}
                    {step && step.shift_days > 0 && <span className="text-warn"> · +{step.shift_days}d</span>}
                  </span>
                </li>
              )
            })}
            {dl && <li className="flex items-start gap-2 text-[12.5px]"><Flag className="mt-0.5 size-3 shrink-0 text-risk" /><span className="font-medium text-ink">{dl.name}</span></li>}
          </ol>
        </div>
      )}

      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {[['Depends on', incoming, 'from'] as const, ['Feeds into', outgoing, 'to'] as const].map(([title, list, end]) => list.length > 0 && (
            <div key={title}>
              <H>{title}</H>
              <ul className="space-y-1">
                {list.map((d) => {
                  const other = d[end]
                  return (
                    <li key={`${d.from}>${d.to}`} className="flex items-center gap-1.5 text-[12px]">
                      <StatusDot status={data.statuses[other]} />
                      <button type="button" onClick={() => byCode.has(other) && onSelect(other)} className={cn('min-w-0 truncate text-left', byCode.has(other) ? 'text-ink hover:underline' : 'text-foreground/70')}>{name(other)}</button>
                      <span className={cn('ml-auto shrink-0 rounded px-1 text-[10px] font-medium', isHard(d.kind) ? 'bg-slate-100 text-slate-600' : 'border border-dashed border-slate-300 text-slate-500')}>
                        {humanise(d.kind)}{d.lag ? ` +${d.lag}d` : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div>
        <H>Who needs to act</H>
        <ul className="space-y-2">
          {actors.map((r) => <Holder key={r.letter + r.code} r={r} />)}
        </ul>
        {others.length > 0 && (
          <>
            <button type="button" onClick={() => setMore(!more)} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-ink hover:underline">
              <ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} />{more ? 'Hide' : 'Show'} {plural(others.length, 'person', 'people')} to consult or inform
            </button>
            {more && <ul className="mt-2 space-y-2">{others.map((r) => <Holder key={r.letter + r.code} r={r} />)}</ul>}
          </>
        )}
      </div>

      {dl && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5">
          <H>{dl.breached ? 'Potential exposure · needs legal judgement' : 'If missed'}</H>
          <p className="text-[12.5px] leading-relaxed text-foreground/80">{dl.consequence}</p>
          <div className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
            {dl.bound.length > 0 && <div>Legally bound: <span className="text-foreground/80">{dl.bound.map((b) => b.name).join(', ')}</span></div>}
            {dl.consent_from.length > 0 && <div>Consent right held by: <span className="text-foreground/80">{dl.consent_from.map((b) => b.name).join(', ')}</span></div>}
            {dl.legal_basis && <div>Source: {dl.legal_basis}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function Holder({ r }: { r: Schemas['ImpactHolder'] }) {
  return (
    <li className="flex items-start gap-2.5">
      <Letter l={r.letter} />
      <div className="min-w-0 text-[12.5px]">
        <div><span className="font-medium text-ink">{r.name}</span> <span className="text-muted-foreground">· {WORD[r.letter]}</span></div>
        <div className="text-[11.5px] text-muted-foreground">
          {r.type === 'person' ? [r.title, r.employer?.name].filter(Boolean).join(', ') : humanise(r.type)}
          {r.via?.type ? ` · under the ${r.via.type.toLowerCase()} mandate` : ''}
        </div>
      </div>
    </li>
  )
}

/** Everyone the scenario touches, strongest responsibility first, with the organisations behind them. */
export function PeopleSummary({ data, onSelect }: { data: Impact; onSelect: (c: string) => void }) {
  const [all, setAll] = useState(false)
  const act = data.summary.people.filter((p) => p.items.some((i) => i.letter === 'A' || i.letter === 'R'))
  const rest = data.summary.people.filter((p) => !act.includes(p))
  const orgs = new Map<string, { name: string; people: number; reasons: Set<string> }>()
  for (const p of data.summary.people) {
    const key = p.employer?.code ?? p.code
    const o = orgs.get(key) ?? { name: p.employer?.name ?? p.name ?? key, people: 0, reasons: new Set<string>() }
    o.people += p.type === 'person' ? 1 : 0
    orgs.set(key, o)
  }
  for (const d of data.deadlines.filter((x) => x.breached)) {
    for (const b of d.bound) { const o = orgs.get(b.code) ?? { name: b.name ?? b.code, people: 0, reasons: new Set() }; o.reasons.add(`bound by ${d.name}`); orgs.set(b.code, o) }
    for (const c of d.consent_from) { const o = orgs.get(c.code) ?? { name: c.name ?? c.code, people: 0, reasons: new Set() }; o.reasons.add(`holds a consent right over ${d.name}`); orgs.set(c.code, o) }
  }
  const shown = all ? [...act, ...rest] : act
  if (!data.summary.people.length) {
    return <p className="rounded-lg bg-ok-soft px-4 py-3 text-[13px] text-ok">Nothing moves in this scenario, so no one needs to act. Choose a delay to see who would.</p>
  }
  return (
    <div className="space-y-5">
      <ul className="divide-y rounded-lg border">
        {shown.map((p) => {
          const owns = p.items.filter((i) => i.letter === 'A' || i.letter === 'R')
          const breached = p.items.filter((i) => i.breached)
          return (
            <li key={p.code} className="px-3.5 py-2.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/70">{initials(p.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-medium text-ink">{p.name}</span>
                    <span className="text-[11.5px] text-muted-foreground">{p.type === 'person' ? [p.title, p.employer?.name].filter(Boolean).join(', ') : humanise(p.type)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(owns.length ? owns : p.items).slice(0, 6).map((i) => (
                      <button key={i.letter + i.code} type="button" onClick={() => onSelect(i.code)}
                        className={cn('inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand', i.breached && 'border-risk/40 bg-risk-soft/60')}>
                        <Letter l={i.letter} /><span className="max-w-44 truncate" title={i.name ?? undefined}>{i.name}</span>
                        {i.kind === 'deadline' ? <Flag className={cn('size-3', i.breached ? 'text-risk' : 'text-muted-foreground')} /> : i.shift_days > 0 ? <span className="font-semibold text-warn">+{i.shift_days}d</span> : null}
                      </button>
                    ))}
                    {(owns.length ? owns : p.items).length > 6 && <span className="px-1 text-[11px] text-muted-foreground">+{(owns.length ? owns : p.items).length - 6} more</span>}
                  </div>
                  {breached.length > 0 && <div className="mt-1 text-[11px] font-medium text-risk">Has a role on {plural(breached.length, 'breached deadline')}</div>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {rest.length > 0 && (
        <button type="button" onClick={() => setAll(!all)} className="-mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-ink hover:underline">
          <ChevronDown className={cn('size-3.5 transition-transform', all && 'rotate-180')} />{all ? 'Show only people who act' : `Also show ${plural(rest.length, 'person', 'people')} to consult or inform`}
        </button>
      )}
      <div>
        <H>Organisations involved</H>
        <ul className="space-y-1.5">
          {[...orgs.entries()].sort((a, b) => b[1].reasons.size - a[1].reasons.size || b[1].people - a[1].people).map(([code, o]) => (
            <li key={code} className="flex items-start gap-2 text-[12.5px]">
              <Building2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span><span className="font-medium text-ink">{o.name}</span>
                <span className="text-muted-foreground">{o.people ? ` · ${plural(o.people, 'person', 'people')}` : ''}{o.reasons.size ? ` · ${[...o.reasons].join('; ')}` : ''}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
