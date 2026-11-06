import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CalendarClock, Flag, ListChecks } from 'lucide-react'
import { useWorkstreams, type Schemas } from '@/api/client'
import { PageHeader } from '@/components/page'
import { Panel } from '@/components/panel'
import { RowChevron, rowClass } from '@/components/row'
import { StatusBadge, STATUS_ORDER } from '@/components/status'
import { inDays, Measures, openRisks, RiskBadge } from '@/components/workstreams/parts'
import { formatDate, formatDateTime, humanise, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Summary = Schemas['WorkstreamSummary']

const SORTS: Record<string, { label: string; key: (w: Summary) => number | string }> = {
  plan: { label: 'Plan order', key: () => 0 },
  progress: { label: 'Activity progress (lowest first)', key: (w) => w.progress ?? 0 },
  deadline: { label: 'Nearest deadline in reach', key: (w) => w.deadlines[0]?.days_remaining ?? Infinity },
  milestone: { label: 'Next milestone', key: (w) => w.next_milestone?.days_remaining ?? Infinity },
  risks: { label: 'Most open risks', key: (w) => -openRisks(w).length },
  activity: { label: 'Most recent activity', key: (w) => -(Date.parse(w.latest_event?.when ?? '1970-01-01') || 0) },
}

/** Workstreams: one card per workstream, filtered and sorted in the browser over one API answer.
 *  Filters live in the URL, so a filtered view can be linked to. */
export function Workstreams() {
  const q = useWorkstreams()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'all'
  const org = params.get('org') ?? 'all'
  const risky = params.get('risks') === 'open'
  const sort = SORTS[params.get('sort') ?? 'plan'] ? params.get('sort') ?? 'plan' : 'plan'
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const all = q.data?.data.workstreams ?? []
  const orgs = useMemo(() => [...new Map(all.flatMap((w) => w.organisations.map((o) => [o.code, o.name ?? o.code]))).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [all])
  const statuses = STATUS_ORDER.filter((s) => all.some((w) => w.status === s))
  const shown = all
    .filter((w) => status === 'all' || w.status === status)
    .filter((w) => org === 'all' || w.organisations.some((o) => o.code === org))
    .filter((w) => !risky || openRisks(w).length > 0)
    .map((w, n) => ({ w, n }))
    .sort((a, b) => {
      const ka = SORTS[sort].key(a.w), kb = SORTS[sort].key(b.w)
      return ka < kb ? -1 : ka > kb ? 1 : a.n - b.n
    })
    .map(({ w }) => w)

  return (
    <div className="space-y-5">
      <PageHeader title="Workstreams"
        description="How each part of the deal is doing: activity progress, milestones and conditions shown apart, who leads it, the deadlines its open work can affect, and its risks." />
      <Panel title="All workstreams" icon={<ListChecks />} query={q} skeletonRows={6}
        note="Workstream items through work-breakdown and their dates, the deadlines each open item can still reach (the recursive downstream function), risks through risk-exposure, organisations through RACI and employment, and the latest event of every kind."
        subtitle={q.data ? `${shown.length} of ${plural(all.length, 'workstream')} · activity progress is weighted by planned duration; it is not readiness to close` : undefined}
        action={() => (
          <div className="flex flex-wrap items-center justify-end gap-2 text-[12.5px]">
            <Select label="Status" value={status} onChange={(v) => set('status', v === 'all' ? null : v)}
              options={[['all', 'All statuses'], ...statuses.map((s) => [s, humanise(s)] as [string, string])]} />
            <Select label="Organisation" value={org} onChange={(v) => set('org', v === 'all' ? null : v)}
              options={[['all', 'All organisations'], ...orgs]} />
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 font-medium text-muted-foreground shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-brand">
              <input type="checkbox" checked={risky} onChange={(e) => set('risks', e.target.checked ? 'open' : null)} className="size-3.5 accent-[#0f2a44]" />
              With open risks
            </label>
            <Select label="Sort" value={sort} onChange={(v) => set('sort', v === 'plan' ? null : v)}
              options={Object.entries(SORTS).map(([k, s]) => [k, s.label])} />
          </div>
        )}>
        {() => shown.length
          ? <div className="grid gap-4 xl:grid-cols-2">{shown.map((w) => <Card key={w.code} w={w} />)}</div>
          : <p className="py-10 text-center text-[13px] text-muted-foreground">No workstream matches these filters.</p>}
      </Panel>
    </div>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 font-medium text-muted-foreground shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-brand">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="max-w-52 cursor-pointer bg-transparent py-0.5 text-ink outline-none">
        {options.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
      </select>
    </label>
  )
}

function Card({ w }: { w: Summary }) {
  const risks = openRisks(w)
  const closedRisks = w.risks.length - risks.length
  return (
    <Link to={`/workstreams/${w.code}`} className={rowClass(false, 'relative flex flex-col gap-4 border bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]')}
      aria-label={`${w.name}: ${humanise(w.status)}, ${w.progress ?? 0}% activity progress. Open the workstream`}>
      <RowChevron className="absolute top-5 right-4" />
      <div className="pr-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{w.name}</h3>
          <StatusBadge status={w.status} />
        </div>
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground" title={w.description ?? undefined}>{w.description}</p>
        <div className="mt-1.5 text-[12px] text-ink-soft">
          Led by <span className="font-medium text-ink">{w.lead?.name}</span> · {formatDate(w.planned_start)} → {formatDate(w.due)} · {plural(w.items, 'item')}
        </div>
      </div>

      <Measures w={w} />

      <div className="grid gap-3 text-[12.5px] sm:grid-cols-2">
        <Fact icon={Flag} label="Next milestone">
          {w.next_milestone
            ? <><span className="font-medium text-ink">{w.next_milestone.name}</span> · {formatDate(w.next_milestone.due)} ({inDays(w.next_milestone.days_remaining)})</>
            : <span className="text-muted-foreground">All milestones achieved</span>}
        </Fact>
        <Fact icon={CalendarClock} label="Contractual deadlines its open work can affect">
          {w.deadlines.length
            ? w.deadlines.map((d) => <div key={d.code}><span className="font-medium text-ink">{d.name}</span> · {formatDate(d.due)} ({inDays(d.days_remaining)})</div>)
            : <span className="text-muted-foreground">None</span>}
        </Fact>
      </div>

      <div className="space-y-1.5">
        <div className="text-[11.5px] font-medium text-muted-foreground">Risks</div>
        {risks.length
          ? <div className="flex flex-col items-start gap-1">{risks.map((r) => <RiskBadge key={r.code} risk={r} />)}</div>
          : <div className="text-[12.5px] text-muted-foreground">No open risks recorded</div>}
        {closedRisks > 0 && <div className="text-[11.5px] text-muted-foreground">and {plural(closedRisks, 'closed risk')}</div>}
      </div>

      <div className="mt-auto grid gap-3 border-t pt-3 text-[12px] sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium text-muted-foreground">Organisations involved ({w.organisations.length})</div>
          <div className="truncate text-ink-soft" title={w.organisations.map((o) => o.name).join(', ')}>{w.organisations.map((o) => o.name).join(', ')}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium text-muted-foreground">Latest activity · {plural(w.events, 'event')} recorded</div>
          {w.latest_event
            ? <div className="truncate text-ink-soft" title={w.latest_event.summary ?? undefined}>
                {formatDateTime(w.latest_event.when)}: {w.latest_event.summary}</div>
            : <div className="text-muted-foreground">None recorded</div>}
        </div>
      </div>
    </Link>
  )
}

function Fact({ icon: Icon, label, children }: { icon: typeof Flag; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={cn('mb-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground')}><Icon className="size-3.5" aria-hidden />{label}</div>
      <div className="text-ink-soft">{children}</div>
    </div>
  )
}
