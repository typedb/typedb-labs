// The Relationship Explorer's detail panel: one party (organisation or person) or one relation.
import { Fragment } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Eye, EyeOff, Route, X } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useParty, type Schemas } from '@/api/client'
import { PanelError } from '@/components/panel'
import { StatusDot } from '@/components/status'
import { TypeQLDrawer } from '@/components/typeql'
import type { Player, Relation } from '@/lib/graph-layout'
import { formatDate, humanise, initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RowChevron, rowClass } from '@/components/row'
import { relationSummary } from './canvas'
import { familyOf, familyStyle, relationStyle } from './style'

const LETTER_WORD: Record<string, string> = { A: 'Accountable', R: 'Responsible', C: 'Consulted', I: 'Informed' }
const LETTER_CLS: Record<string, string> = {
  A: 'bg-ink text-white', R: 'bg-brand text-white', C: 'bg-info-soft text-info', I: 'bg-muted text-muted-foreground',
}

function Letter({ letter }: { letter: string }) {
  return <span className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold', LETTER_CLS[letter])} title={LETTER_WORD[letter]}>{letter}</span>
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-t px-5 py-4">
      <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}{count != null && <span className="rounded-full bg-muted px-1.5 text-[10px] text-foreground/70">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

function TypePath({ path }: { path: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      {path.map((t, i) => (
        <span key={t} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-border">›</span>}
          <span className={cn(i === 0 && 'rounded bg-muted px-1.5 py-0.5 font-medium text-foreground')}>{humanise(t)}</span>
        </span>
      ))}
    </div>
  )
}

function PlayerChip({ p, onSelect }: { p: { role: string; code?: string | null; name?: string | null; type: string; kind: string }; onSelect?: (code: string) => void }) {
  const clickable = onSelect && p.code && p.kind === 'entity' && /^(ORG|PER)-/.test(p.code)
  return (
    <div className="flex items-baseline gap-2 text-[12.5px]">
      <span className="w-24 shrink-0 text-right text-[11px] font-medium text-muted-foreground">{humanise(p.role)}</span>
      {clickable
        ? <button type="button" onClick={() => onSelect!(p.code!)} className="text-left font-medium text-ink hover:underline">{p.name}</button>
        : <span className="font-medium text-ink">{p.name}</span>}
      <span className="text-[11px] text-muted-foreground">{humanise(p.type)}</span>
    </div>
  )
}

/** Relations grouped by type, each with this party's role and every other player's role. */
function Relations({ relations, onSelect }: { relations: Schemas['Membership'][]; onSelect: (code: string) => void }) {
  const shown = relations.filter((r) => r.type !== 'employment')
  const types = [...new Set(shown.map((r) => r.type))]
  if (!shown.length) return <p className="text-[12.5px] text-muted-foreground">No other relationships recorded.</p>
  return (
    <div className="space-y-3">
      {types.map((t) => {
        const tone = relationStyle(t)
        return (
          <div key={t}>
            <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold" style={{ color: tone.text }}>
              <span className="h-0.5 w-4 rounded" style={{ background: tone.stroke }} />{humanise(t)}
            </div>
            <ul className="space-y-1.5">
              {shown.filter((r) => r.type === t).map((r) => (
                <li key={r.key} className="rounded-lg border bg-white px-3 py-2">
                  <div className="mb-1 text-[11.5px] text-muted-foreground">
                    As <span className="font-semibold text-foreground">{humanise(r.role)}</span>
                    {summaryText(r) && <> · {summaryText(r)}</>}
                  </div>
                  <div className="space-y-0.5">{r.others.map((o) => <PlayerChip key={`${o.role}-${o.code}`} p={o} onSelect={onSelect} />)}</div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function summaryText(r: Schemas['Membership']): string {
  const rel = { key: r.key, type: r.type, attributes: r.attributes, players: r.others } as Relation
  const s = relationSummary(rel, r.others as Player[])
  return s === humanise(r.type) ? '' : s
}

export function PartyPanel({ code, onSelect, onClose, peopleShown, onTogglePeople }: {
  code: string; onSelect: (code: string) => void; onClose: () => void; peopleShown?: boolean; onTogglePeople?: () => void
}) {
  const q = useParty(code)
  if (q.isPending) return <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
  if (q.isError) return <div className="p-5"><PanelError message={q.error.message} /></div>
  const d = q.data.data
  const isPerson = d.type === 'person'
  const employer = d.relations.find((r) => r.type === 'employment' && r.role === 'employee')
  const fam = familyStyle(isPerson ? 'person' : familyOf(pathFor(d.type)))
  const Icon = fam.icon
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', fam.chip)}><Icon className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] leading-snug font-semibold text-ink">{d.name}</h2>
          {isPerson && employer
            ? <p className="text-[12.5px] text-muted-foreground">{String(employer.attributes['job-title'] ?? '')} ·{' '}
                <button type="button" className="font-medium text-ink hover:underline" onClick={() => onSelect(employer.others[0].code!)}>{employer.others[0].name}</button></p>
            : <p className="text-[12.5px] text-muted-foreground">{[d.sector, d.jurisdiction].filter(Boolean).join(' · ')}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-ink"><X className="size-4" /></button>
      </div>
      <div className="px-5 pb-4">
        <TypePath path={TYPE_PATHS[d.type] ?? [d.type]} />
        {d.description && <p className="mt-2.5 text-[12.5px] leading-relaxed text-foreground/80">{d.description}</p>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {!isPerson && (
          <Section title="People on the deal" count={d.people.length}>
            {d.people.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No people recorded for this organisation.</p> : (
              <>
                {onTogglePeople && (
                  <button type="button" onClick={onTogglePeople}
                    className="mb-2.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium text-ink hover:bg-muted">
                    {peopleShown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{peopleShown ? 'Hide people on the graph' : 'Show people on the graph'}
                  </button>
                )}
                <ul className="space-y-2">
                  {d.people.map((p) => (
                    <li key={p.code}>
                      <button type="button" onClick={() => onSelect(p.code)} className={rowClass(false, 'flex w-full items-start gap-2.5 px-1 py-1')}>
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/70">{initials(p.name)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium text-ink">{p.name}</span>
                          <span className="block text-[11.5px] text-muted-foreground">{p.title}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {(['A', 'R', 'C', 'I'] as const).map((l) => {
                              const n = p.raci.filter((r) => r.letter === l).length
                              return n ? <span key={l} className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><Letter letter={l} />{n}</span> : null
                            })}
                          </span>
                        </span>
                        <ArrowRight className="mt-1.5 size-3.5 text-muted-foreground" />
                      <RowChevron className="mt-1.5" /></button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}
        <Section title="Relationships" count={d.relations.filter((r) => r.type !== 'employment').length}>
          <Relations relations={d.relations} onSelect={onSelect} />
        </Section>
        {d.raci.length > 0 && (
          <Section title={isPerson ? 'Responsibilities' : 'Responsibilities held by the organisation'} count={d.raci.length}>
            <ul className="space-y-1.5">
              {d.raci.map((r) => (
                <li key={`${r.letter}-${r.item.code}`} className="flex items-start gap-2 text-[12.5px]">
                  <Letter letter={r.letter} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium text-ink"><StatusDot status={r.item.status} />{r.item.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {LETTER_WORD[r.letter]} · {humanise(r.item_type)}{r.item.due ? ` · due ${formatDate(r.item.due)}` : ''}{r.via ? ` · under mandate ${r.via}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to={`/parties/${d.code}`} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand">Open profile</Link>
          <Link to={`/explorer?view=paths&from=${encodeURIComponent(d.code)}`} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"><Route className="size-3.5" />Find connections</Link>
        </div>
      </div>
      <TypeQLDrawer envelope={q.data} note="One party: its exact type, every relation it plays a role in (with that role and the other players), its people and its RACI letters." />
    </div>
  )
}

// Filled in by the Explorer from the schema hierarchy the API returns (see setTypePaths).
const TYPE_PATHS: Record<string, string[]> = {}
export function setTypePaths(parents: Record<string, string>) {
  for (const t of [...Object.keys(parents), 'party']) {
    const path = [t]
    while (parents[path[path.length - 1]]) path.push(parents[path[path.length - 1]])
    TYPE_PATHS[t] = path
  }
}
const pathFor = (t: string) => TYPE_PATHS[t] ?? [t]

/** One relation, with every player and its role: n-ary relations are shown whole. */
export function RelationPanel({ relation, roles, onSelect, onClose }: {
  relation: Relation; roles?: string[]; onSelect: (code: string) => void; onClose: () => void
}) {
  const tone = relationStyle(relation.type)
  const attrs = Object.entries(relation.attributes).filter(([k, v]) => v != null && k !== 'description')
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: tone.soft }}>
          <span className="h-1 w-5 rounded" style={{ background: tone.stroke }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: tone.text }}>{humanise(relation.type)} relation</div>
          <h2 className="text-[15px] leading-snug font-semibold text-ink">{relationSummary(relation, relation.players)}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-ink"><X className="size-4" /></button>
      </div>
      <Section title="Players and their roles" count={relation.players.length}>
        <div className="space-y-1">{relation.players.map((p) => <PlayerChip key={`${p.role}-${p.code}`} p={p} onSelect={onSelect} />)}</div>
        {roles && <p className="mt-3 text-[11.5px] text-muted-foreground">The schema defines this relation with the roles {roles.map(humanise).join(', ')}.</p>}
      </Section>
      {attrs.length > 0 && (
        <Section title="Attributes">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
            {attrs.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{humanise(k)}</dt><dd className="font-medium text-ink">{String(v)}</dd></Fragment>)}
          </dl>
        </Section>
      )}
    </div>
  )
}
