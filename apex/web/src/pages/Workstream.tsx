import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowRight, Activity, Route, CalendarClock, FlaskConical, GitBranch, Hourglass, LayoutDashboard, Network, Scale, ShieldAlert } from 'lucide-react'
import { useWorkstream, type Schemas } from '@/api/client'
import { Gantt } from '@/components/gantt/gantt'
import { RaciMatrix } from '@/components/overview/workstreams'
import { Panel, PanelError } from '@/components/panel'
import { RowChevron, rowClass } from '@/components/row'
import { StatusBadge, StatusDot } from '@/components/status'
import { TypeQLDrawer } from '@/components/typeql'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ActivityFeed } from '@/components/workstreams/feed'
import { inDays, Measures, RiskBadge } from '@/components/workstreams/parts'
import { formatDate, humanise, plural } from '@/lib/format'
import { useSelectedItem } from '@/lib/selection'

type Detail = Schemas['WorkstreamDetail']

// Which of the page's queries each section uses, so its "Show TypeQL" lists (and labels) only those.
const isEvents = (q: string) => q.includes('deal-event') && q.includes('work-breakdown')
const isDependencies = (q: string) => q.includes('isa dependency (prerequisite') || q.includes('sub hard-dependency')
const isUpstream = (q: string) => q.includes('upstream(')
const isObligations = (q: string) => q.includes('isa obligation')
const isRisks = (q: string) => q.includes('risk-exposure')

/** One workstream in detail. Items open the shared item panel (?item=CODE), as on the Overview. */
export function Workstream() {
  const { code } = useParams()
  const q = useWorkstream(code)
  const [, select] = useSelectedItem()
  if (q.isPending) return <div className="space-y-5"><Skeleton className="h-10 w-80" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (q.isError) return <div className="space-y-4"><Back /><PanelError message={q.error.message} /></div>
  const d = q.data.data
  const w = d.summary
  const openConditions = d.open_conditions

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Link to="/" className="hover:text-ink hover:underline">Deal Overview</Link><span aria-hidden>/</span>
        <Link to="/workstreams" className="hover:text-ink hover:underline">Workstreams</Link><span aria-hidden>/</span>
        <span className="font-medium text-ink" aria-current="page">{w.name}</span>
      </nav>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="space-y-5 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">{w.name}</h1>
                <StatusBadge status={w.status} />
              </div>
              <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">{w.description}</p>
              <div className="mt-2 text-[13px] text-ink-soft">
                Led by <span className="font-medium text-ink">{w.lead?.name}</span> (Accountable) · {formatDate(w.planned_start)} → {formatDate(w.due)} ·{' '}
                {plural(w.items, 'item')}, {plural(w.activities, 'activity', 'activities')} · {plural(w.events, 'recorded event')}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <NavButton to="/" icon={LayoutDashboard}>Deal Overview</NavButton>
              <NavButton to="/explorer" icon={Network}>Relationship Explorer</NavButton>
              <NavButton to={`/explorer?view=paths&from=${encodeURIComponent(w.code)}`} icon={Route}>Find connections</NavButton>
              {openConditions[0]
                ? <NavButton to={`/impact?item=${encodeURIComponent(openConditions[0].code)}`} icon={FlaskConical}>Simulate a delay: {openConditions[0].name}</NavButton>
                : <NavButton to="/impact" icon={FlaskConical}>Impact Explorer</NavButton>}
            </div>
          </div>
          <Measures w={w} />
          <p className="text-[12px] text-muted-foreground">
            Activity progress and milestones describe this workstream's work; neither is readiness to close. Readiness to close is the
            conditions satisfied, shown here for this workstream and on the <Link to="/" className="font-medium text-brand hover:underline">Deal Overview</Link> for the whole deal.
          </p>
          <div className="grid gap-4 border-t pt-4 text-[12.5px] md:grid-cols-3">
            <Fact label="Next milestone">
              {w.next_milestone
                ? <ItemLink code={w.next_milestone.code} onSelect={select}>{w.next_milestone.name}</ItemLink>
                : <span className="text-muted-foreground">All milestones achieved</span>}
              {w.next_milestone && <span className="text-muted-foreground"> · {formatDate(w.next_milestone.due)} ({inDays(w.next_milestone.days_remaining)})</span>}
            </Fact>
            <Fact label="Contractual deadlines its open work can affect">
              {w.deadlines.length ? w.deadlines.map((x) => (
                <div key={x.code}><ItemLink code={x.code} onSelect={select}>{x.name}</ItemLink>
                  <span className="text-muted-foreground"> · {formatDate(x.due)} ({inDays(x.days_remaining)}){x.owned ? ' · held by this workstream' : ''}</span></div>
              )) : <span className="text-muted-foreground">None: no open item here leads to a contractual deadline</span>}
            </Fact>
            <Fact label={`Organisations involved (${w.organisations.length})`}>
              <span className="text-ink-soft">{w.organisations.map((o) => o.name).join(', ')}</span>
            </Fact>
          </div>
        </div>
        <TypeQLDrawer envelope={q.data}
          note="Everything on this page in one READ transaction: items and progress, the deadlines open work can reach (recursive downstream), open prerequisites (recursive upstream), obligations, risks and every event." />
      </Card>

      <Gantt workstream={w.code} title={`${w.name} schedule`}
        subtitle="This workstream's activities, milestones and obligations on the deal's timeline, with every contractual deadline. Select any item for its details." />

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-5 xl:col-span-7">
          <Dependencies d={d} onSelect={select} q={q} />
          <Waiting d={d} onSelect={select} q={q} />
          <Obligations d={d} onSelect={select} q={q} />
        </div>
        <div className="min-w-0 space-y-5 xl:col-span-5">
          <Risks d={d} onSelect={select} q={q} />
          <Panel title="Activity history" icon={<Activity />} query={q} select={isEvents} bodyClassName="px-0 pb-0"
            subtitle={`${plural(d.events.length, 'event')} on this workstream's items, from the typed event model`}
            note="Every event on the workstream's items through the parent type deal-event, with recipients, attendees and the request–response chain (reply relates two events).">
            {() => <ActivityFeed events={d.events} onSelect={select} asOf={d.as_of} />}
          </Panel>
        </div>
      </div>

      <RaciMatrix workstream={w.code} onSelect={select} />
      <div><Back /></div>
    </div>
  )
}

type SectionProps = { d: Detail; onSelect: (code: string) => void; q: ReturnType<typeof useWorkstream> }

function Dependencies({ d, onSelect, q }: SectionProps) {
  const code = d.summary.code
  const incoming = d.dependencies.filter((x) => x.crosses && x.to_workstream.code === code)
  const outgoing = d.dependencies.filter((x) => x.crosses && x.from_workstream.code === code)
  const internal = d.dependencies.length - incoming.length - outgoing.length
  return (
    <Panel title="Dependencies with other workstreams" icon={<GitBranch />} query={q} select={isDependencies}
      subtitle={`${plural(incoming.length, 'link')} in, ${plural(outgoing.length, 'link')} out, and ${plural(internal, 'link')} inside this workstream`}
      note="Every dependency touching this workstream's items, with its exact kind: sequencing and gating move dates, informing passes information only.">
      {() => (
        <div className="grid gap-5 md:grid-cols-2">
          <DepList title="Waits for work elsewhere" icon={ArrowLeft} empty="Nothing in other workstreams">
            {incoming.map((x) => <DepRow key={x.from + x.to} d={x} other={x.from_workstream.name} otherItem={x.from} otherName={x.from_name} ownName={x.to_name} onSelect={onSelect} arrow="from" />)}
          </DepList>
          <DepList title="Other workstreams wait for it" icon={ArrowRight} empty="Nothing in other workstreams">
            {outgoing.map((x) => <DepRow key={x.from + x.to} d={x} other={x.to_workstream.name} otherItem={x.to} otherName={x.to_name} ownName={x.from_name} onSelect={onSelect} arrow="to" />)}
          </DepList>
        </div>
      )}
    </Panel>
  )
}

function DepList({ title, icon: Icon, empty, children }: { title: string; icon: typeof ArrowLeft; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Icon className="size-3.5" aria-hidden />{title}</div>
      {children.length ? <ul className="space-y-1">{children}</ul> : <p className="text-[12.5px] text-muted-foreground">{empty}</p>}
    </div>
  )
}

function DepRow({ d, other, otherItem, otherName, ownName, onSelect, arrow }: {
  d: Schemas['WorkstreamDependency']; other?: string | null; otherItem: string; otherName?: string | null; ownName?: string | null
  onSelect: (code: string) => void; arrow: 'from' | 'to'
}) {
  return (
    <li>
      <button type="button" onClick={() => onSelect(otherItem)} className={rowClass(false, 'flex w-full items-start gap-2 px-2 py-1.5')}
        aria-label={`${otherName} (${other}) ${arrow === 'from' ? 'before' : 'after'} ${ownName}: ${humanise(d.kind)}. Open details`}>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] leading-snug text-ink">
            {arrow === 'from'
              ? <><span className="font-medium">{otherName}</span> <span className="text-muted-foreground">→</span> {ownName}</>
              : <>{ownName} <span className="text-muted-foreground">→</span> <span className="font-medium">{otherName}</span></>}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {other} · {humanise(d.kind)}{d.lag ? ` · ${plural(d.lag, 'day')} lag` : ''}
          </span>
        </span>
        <RowChevron className="mt-0.5" />
      </button>
    </li>
  )
}

function Waiting({ d, onSelect, q }: SectionProps) {
  const waiting = d.items.filter((i) => i.status !== 'complete' && i.open_prerequisites.length)
  return (
    <Panel title="Waiting on open work" icon={<Hourglass />} query={q} select={isUpstream}
      subtitle="Items whose prerequisites, at any depth, are not yet complete"
      note="The recursive upstream function walks every hard dependency back from each item, to any depth; negation keeps only the prerequisites not yet complete.">
      {() => waiting.length ? (
        <ul className="space-y-2">
          {waiting.map((i) => {
            const elsewhere = i.open_prerequisites.filter((u) => u.workstream !== d.summary.code)
            return (
              <li key={i.code}>
                <button type="button" onClick={() => onSelect(i.code)} className={rowClass(false, 'flex w-full items-start gap-2 px-2 py-2')}
                  aria-label={`${i.name}: waits on ${plural(i.open_prerequisites.length, 'open item')}. Open details`}>
                  <StatusDot status={i.status} className="mt-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink" title={i.name ?? undefined}>{i.name}</span>
                    <span className="block text-[11.5px] text-muted-foreground">
                      Waits on {plural(i.open_prerequisites.length, 'open item')}{elsewhere.length ? `, ${elsewhere.length} in other workstreams` : ''}:{' '}
                      {i.open_prerequisites.map((u) => u.name).join(', ')}
                    </span>
                  </span>
                  <RowChevron className="mt-0.5" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : <p className="text-[13px] text-muted-foreground">Nothing in this workstream is waiting on open work.</p>}
    </Panel>
  )
}

function Obligations({ d, onSelect, q }: SectionProps) {
  return (
    <Panel title="Obligations" icon={<Scale />} query={q} select={isObligations}
      subtitle="Conditions, covenants and contractual deadlines held by this workstream"
      note="One pattern on the abstract parent type obligation finds conditions, covenants and deadlines, each with who is bound, whose consent is needed and what a deadline limits.">
      {() => d.obligations.length ? (
        <ul className="divide-y rounded-lg border">
          {d.obligations.map((o) => (
            <li key={o.code}>
              <button type="button" onClick={() => onSelect(o.code)} className={rowClass(false, 'flex w-full items-start gap-3 rounded-none px-3 py-2.5')}
                aria-label={`${o.name}: ${humanise(o.type)}, ${humanise(o.status)}. Open details`}>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{o.name}</span>
                    <StatusBadge status={o.status} />
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {humanise(o.type)} · {o.type === 'deadline' ? 'by' : 'due'} {formatDate(o.due)}{o.legal_basis ? ` · ${o.legal_basis}` : ''}
                  </span>
                  {(o.bound.length > 0 || o.consent_from.length > 0 || o.limits.length > 0) && (
                    <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                      {o.bound.length > 0 && <>Binds {o.bound.map((b) => b.name).join(', ')}. </>}
                      {o.consent_from.length > 0 && <>Consent from {o.consent_from.map((b) => b.name).join(', ')}. </>}
                      {o.limits.length > 0 && <>Limits {o.limits.map((b) => b.name).join(', ')}.</>}
                    </span>
                  )}
                  {o.consequence && <span className="mt-1 block text-[11.5px] leading-snug text-ink-soft"><span className="font-semibold text-risk">If missed: </span>{o.consequence}</span>}
                </span>
                <RowChevron className="mt-0.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted-foreground">This workstream holds no conditions, covenants or deadlines.</p>}
    </Panel>
  )
}

function Risks({ d, onSelect, q }: SectionProps) {
  const risks = d.summary.risks
  return (
    <Panel title="Risks" icon={<ShieldAlert />} query={q} select={isRisks}
      subtitle="From the risk register: risks that threaten this workstream's items"
      note="Risks reached through risk-exposure to this workstream's items, each with its one owner (risk-ownership), likelihood, severity, status and mitigation.">
      {() => risks.length ? (
        <ul className="space-y-3">
          {risks.map((r) => (
            <li key={r.code} className="rounded-lg border p-3">
              <RiskBadge risk={r} />
              {r.description && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">{r.description}</p>}
              {r.mitigation && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground"><span className="font-medium text-ink-soft">Mitigation: </span>{r.mitigation}</p>}
              <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                Owner: <span className="font-medium text-ink-soft">{r.owner?.name}</span> · {humanise(r.likelihood)} likelihood · threatens{' '}
                {r.items.map((c, n) => {
                  const it = d.items.find((i) => i.code === c)
                  return <span key={c}>{n > 0 && ', '}<ItemLink code={c} onSelect={onSelect}>{it?.name ?? c}</ItemLink></span>
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted-foreground">No risks in the register threaten this workstream's items.</p>}
    </Panel>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden />{label}</div>
      <div>{children}</div>
    </div>
  )
}

function ItemLink({ code, onSelect, children }: { code: string; onSelect: (code: string) => void; children: React.ReactNode }) {
  return <button type="button" onClick={() => onSelect(code)} className="cursor-pointer text-left font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand">{children}</button>
}

function NavButton({ to, icon: Icon, children }: { to: string; icon: typeof Network; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft shadow-sm hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
      <Icon className="size-3.5" aria-hidden />{children}
    </Link>
  )
}

function Back() {
  return (
    <Link to="/workstreams" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
      <ArrowLeft className="size-4" aria-hidden />All workstreams
    </Link>
  )
}
