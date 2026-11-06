// The shared item panel (Gantt now; Workstreams, Parties and Impact later). Everything in it comes
// from /api/items/{code}; "due in" and "ago" are counted from the scenario date, never the real date.
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, FlaskConical, Route, ShieldAlert, X } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useItem, type Schemas } from '@/api/client'
import { PanelError } from '@/components/panel'
import { ScrollArea } from '@/components/scroll-area'
import { ProgressBar, StatusBadge } from '@/components/status'
import { TypeQLDrawer } from '@/components/typeql'
import { dayDiff, formatDate, formatDateTime, humanise, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Detail = Schemas['ItemDetail']

const LETTER_WORD: Record<string, string> = { A: 'Accountable', R: 'Responsible', C: 'Consulted', I: 'Informed' }

export function ItemDetail({ code, asOf, onClose, onSelect, onShowWorkstream }: {
  code: string; asOf: string; onClose: () => void; onSelect: (code: string) => void; onShowWorkstream: (code: string) => void
}) {
  const q = useItem(code)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [code])

  return (
    <aside ref={panel} tabIndex={-1} role="dialog" aria-label="Item details"
      className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col border-l bg-card shadow-[-12px_0_32px_rgba(16,24,40,0.12)] outline-none">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <span className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Item details</span>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-ink" aria-label="Close item details">
          <X className="size-4" />
        </button>
      </div>
      <ScrollArea key={code} label="Item details" className="flex-1" more="Scroll for more details" done="End of the details">
        {q.isPending && <div className="space-y-3 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
        {q.isError && <div className="p-5"><PanelError message={q.error.message} /></div>}
        {q.data && <Body d={q.data.data} asOf={asOf} onSelect={onSelect} onShowWorkstream={onShowWorkstream} stale={q.isPlaceholderData} />}
      </ScrollArea>
      {q.data && !q.isPlaceholderData && <TypeQLDrawer envelope={q.data} label="TypeQL for this item"
        note="The item in one query with nested subqueries (its workstream, RACI with each letter a relation type, dependencies both ways, deadlines, consents, events, risks); a second checks whether it is an open condition that can be simulated." />}
    </aside>
  )
}

function relative(due: string, asOf: string, complete: boolean) {
  const days = dayDiff(due, asOf)
  if (days === 0) return 'on the scenario date'
  if (days > 0) return `in ${plural(days, 'day')}`
  return complete ? `${plural(-days, 'day')} before the scenario date` : `${plural(-days, 'day')} overdue`
}

function Body({ d, asOf, onSelect, onShowWorkstream, stale }: {
  d: Detail; asOf: string; onSelect: (code: string) => void; onShowWorkstream: (code: string) => void; stale: boolean
}) {
  const complete = d.status === 'complete'
  const [latest, ...earlier] = d.events
  return (
    <div className={cn('space-y-5 p-5 transition-opacity', stale && 'opacity-60')}>
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">{humanise(d.type)}{d.criticality && <> · {humanise(d.criticality)} criticality</>}</div>
        <h2 className="mt-1 text-[18px] leading-snug font-semibold tracking-tight text-ink">{d.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={d.status} />
          {d.workstream && (
            <button type="button" onClick={() => onShowWorkstream(d.workstream!.code)} className="text-[12.5px] font-medium text-brand hover:underline">
              {d.workstream.name} workstream
            </button>
          )}
        </div>
        {d.description && <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">{d.description}</p>}
      </div>

      <Section title="Dates">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {d.planned_start && <><dt className="text-muted-foreground">Planned start</dt><dd className="text-ink">{formatDate(d.planned_start)}</dd></>}
          {d.actual_start && <><dt className="text-muted-foreground">Actual start</dt><dd className="text-ink">{formatDate(d.actual_start)}</dd></>}
          <dt className="text-muted-foreground">{d.type === 'deadline' ? 'Deadline' : 'Due'}</dt>
          <dd className="text-ink">{formatDate(d.due)} <span className="text-muted-foreground">({relative(d.due!, asOf, complete)})</span></dd>
          {d.baseline_due && d.baseline_due !== d.due && <><dt className="text-muted-foreground">Originally due</dt><dd className="text-ink">{formatDate(d.baseline_due)}</dd></>}
          {d.planned_start && <><dt className="text-muted-foreground">Planned length</dt><dd className="text-ink">{plural(dayDiff(d.due!, d.planned_start) + 1, 'day')}</dd></>}
          {d.status !== 'complete' && d.type !== 'deadline' && <><dt className="text-muted-foreground">Schedule float</dt>
            <dd className="text-ink">{d.float != null ? <>{plural(d.float, 'day')} before a contractual deadline breaks{d.critical_for.length ? <span className="font-medium text-risk"> · on a deadline-critical chain</span> : ''}</> : 'No contractual deadline within reach of a delay'}</dd></>}
        </dl>
        {d.type !== 'deadline' && d.progress != null && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[12px]"><span className="text-muted-foreground">Reported progress</span><span className="font-semibold text-ink tabular">{complete ? 100 : d.progress}%</span></div>
            <ProgressBar value={complete ? 100 : d.progress} status={d.status} />
          </div>
        )}
      </Section>

      <Section title="Who">
        <ul className="space-y-2">
          {(['A', 'R', 'C', 'I'] as const).flatMap((letter) => (d.raci[letter] ?? []).map((h) => (
            <li key={`${letter}-${h.code}`} className="flex items-start gap-2.5 text-[13px]">
              <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold',
                letter === 'A' ? 'bg-ink text-white' : letter === 'R' ? 'bg-brand text-white' : 'bg-muted text-ink-soft')}
                title={LETTER_WORD[letter]}>{letter}</span>
              <span className="min-w-0">
                <Link to={`/parties/${h.code}`} className="font-medium text-ink hover:text-brand hover:underline">{h.name}</Link>
                <span className="block text-[12px] text-muted-foreground">
                  {LETTER_WORD[letter]}{h.employer && <> · {h.employer}</>}{h.via && <> · under their firm's mandate</>}
                </span>
              </span>
            </li>
          )))}
        </ul>
      </Section>

      {(d.depends_on.length > 0 || d.needed_by.length > 0) && (
        <Section title="Dependencies">
          <Links title="Waits for" icon={<ArrowLeft className="size-3.5" />} links={d.depends_on} onSelect={onSelect} />
          <Links title="Holds up" icon={<ArrowRight className="size-3.5" />} links={d.needed_by} onSelect={onSelect} />
          <p className="mt-2 text-[11.5px] text-muted-foreground">Sequencing and gating move dates; informing passes information only.</p>
        </Section>
      )}

      {(d.limited_by.length > 0 || d.limits.length > 0 || d.bound.length > 0 || d.consent_from.length > 0 || d.consequence || d.legal_basis) && (
        <Section title="Obligations and deadlines">
          <div className="space-y-2 text-[13px]">
            {d.legal_basis && <Fact label="Legal basis">{d.legal_basis}</Fact>}
            {d.limited_by.length > 0 && <Fact label="Must happen before">{d.limited_by.map((l, i) => <span key={l.code}>{i > 0 && ', '}<ItemButton code={l.code} onSelect={onSelect}>{l.name}</ItemButton> ({formatDate(l.due)})</span>)}</Fact>}
            {d.limits.length > 0 && <Fact label="Limits">{d.limits.map((l, i) => <span key={l.code}>{i > 0 && ', '}<ItemButton code={l.code} onSelect={onSelect}>{l.name}</ItemButton></span>)}</Fact>}
            {d.bound.length > 0 && <Fact label="Binds">{d.bound.map((b) => b.name).join(', ')}</Fact>}
            {d.consent_from.length > 0 && <Fact label="Consent from">{d.consent_from.map((b) => b.name).join(', ')}</Fact>}
            {d.consequence && <div className="rounded-lg bg-risk-soft/70 px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft"><span className="font-semibold text-risk">If missed: </span>{d.consequence}</div>}
          </div>
        </Section>
      )}

      {d.risks.length > 0 && (
        <Section title="Risks to this item">
          <ul className="space-y-1.5">
            {d.risks.map((r) => (
              <li key={r.code} className="flex items-start gap-2 text-[13px]">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                <span><span className="font-medium text-ink">{r.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{humanise(r.likelihood)} likelihood · {humanise(r.severity)} severity · {humanise(r.status)}</span></span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Latest activity">
        {latest ? (
          <div className="text-[13px]">
            <div className="text-ink">{latest.summary}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">{humanise(latest.type)} · {latest.actor.name} · {formatDateTime(latest.when)}</div>
            {earlier.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12.5px] font-medium text-brand">{plural(earlier.length, 'earlier event')}</summary>
                <ul className="mt-2 space-y-2 border-l pl-3">
                  {earlier.map((e) => (
                    <li key={e.code}><div className="text-ink-soft">{e.summary}</div>
                      <div className="text-[12px] text-muted-foreground">{humanise(e.type)} · {e.actor.name} · {formatDateTime(e.when)}</div></li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : <p className="text-[13px] text-muted-foreground">No activity recorded on this item.</p>}
      </Section>

      {d.discussed_at.length > 0 && (
        <Section title="Discussed at">
          <ul className="space-y-1.5 text-[13px]">
            {d.discussed_at.map((m) => (
              <li key={m.code}>
                <div className="text-ink">{m.summary}</div>
                <div className="text-[12px] text-muted-foreground">{m.subject.name} meeting · {m.actor.name} · {formatDateTime(m.when)}</div>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11.5px] text-muted-foreground">Attending one of these counts as engagement on this item; a meeting that did not discuss it does not.</p>
        </Section>
      )}

      <Link to={`/explorer?view=paths&from=${encodeURIComponent(d.code)}`}
        className="flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium text-ink-soft hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand">
        <Route className="size-4" />How is this connected to…?
      </Link>

      {d.simulate && (
        <Link to={`/impact?item=${encodeURIComponent(d.code)}`}
          className="flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-white hover:bg-ink/90">
          <FlaskConical className="size-4" />Simulate a delay in the Impact Explorer
        </Link>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><span className="text-muted-foreground">{label}: </span><span className="text-ink">{children}</span></div>
}

function ItemButton({ code, onSelect, children }: { code: string; onSelect: (code: string) => void; children: ReactNode }) {
  return <button type="button" onClick={() => onSelect(code)} className="text-left font-medium text-brand hover:underline">{children}</button>
}

function Links({ title, icon, links, onSelect }: { title: string; icon: ReactNode; links: Schemas['ItemLink'][]; onSelect: (code: string) => void }) {
  if (!links.length) return null
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">{icon}{title}</div>
      <ul className="space-y-1">
        {links.map((l) => (
          <li key={l.code} className="flex items-baseline justify-between gap-3 text-[13px]">
            <ItemButton code={l.code} onSelect={onSelect}>{l.name}</ItemButton>
            <span className="shrink-0 text-[11.5px] text-muted-foreground">{humanise(l.kind)}{l.lag ? ` · ${plural(l.lag, 'day')} lag` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
