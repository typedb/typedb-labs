import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Building2, Search, SlidersHorizontal, Users } from 'lucide-react'
import { useEngagementPolicy, useRegister, type Schemas } from '@/api/client'
import { PageHeader, Segmented } from '@/components/page'
import { Panel } from '@/components/panel'
import { RowChevron, rowClass } from '@/components/row'
import { CATEGORY, EngagementBadge, LEVEL } from '@/components/parties/engagement'
import { formatDate, humanise, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Person = Schemas['RegisterPerson']
type Org = Schemas['RegisterOrganisation']
type Row = Person | Org

const LEVEL_ORDER = ['red', 'amber', 'green', 'unknown', 'not-yet-active', 'none']
// Within a level, facts before inferences (the same order the API ranks findings in).
const CATEGORY_ORDER = ['overdue-response', 'statutory-timetable', 'deal-risk', 'response-due', 'inactivity']
const catRank = (r: Row) => { const i = CATEGORY_ORDER.indexOf(r.engagement.category); return i < 0 ? CATEGORY_ORDER.length : i }
const GRID = 'grid grid-cols-[minmax(220px,1.3fr)_minmax(300px,2.2fr)_80px_120px_minmax(120px,1fr)_100px_minmax(150px,1fr)_32px] items-center text-left'
const isPerson = (r: Row): r is Person => 'contact' in r

// Summary strip: the four distinctions, each a filter.
const STRIP: { key: string; label: string; test: (r: Row) => boolean }[] = [
  { key: 'overdue', label: 'Overdue responses', test: (r) => flag(r, 'overdue-response') > 0 },
  { key: 'deal-risk', label: 'Deal risk', test: (r) => flag(r, 'deal-risk') > 0 },
  { key: 'inactive', label: 'Inactive on an assigned item', test: (r) => flag(r, 'inactivity') > 0 },
  { key: 'unknown', label: 'Insufficient information', test: (r) => r.engagement.level === 'unknown' || r.engagement.no_engagement_recorded },
  { key: 'statutory', label: 'Authorities (statutory timetable)', test: (r) => r.engagement.profile === 'Statutory timetable' },
]

function flag(r: Row, key: string) {
  return (r.engagement.flags as unknown as Record<string, number>)[key] ?? 0
}

/** The Parties register: who is involved, what they owe, and how engagement looks, with the reason. */
export function Parties() {
  const q = useRegister()
  const policy = useEngagementPolicy()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'organisations' ? 'organisations' : 'people'
  const text = params.get('q') ?? ''
  const show = params.get('show') ?? ''
  const org = params.get('org') ?? 'all'
  const ws = params.get('ws') ?? 'all'
  const sort = params.get('sort') ?? 'level'
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (!v) next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
  }
  const data = q.data?.data
  const rows: Row[] = useMemo(() => (tab === 'people' ? data?.people : data?.organisations) ?? [], [data, tab])
  const employers = useMemo(() => [...new Map((data?.people ?? []).filter((p) => p.employer).map((p) => [p.employer!.code, p.employer!.name ?? ''])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [data])
  const shown = rows
    .filter((r) => !text || `${r.name} ${isPerson(r) ? `${r.title} ${r.employer?.name}` : r.type}`.toLowerCase().includes(text.toLowerCase()))
    .filter((r) => !show || STRIP.find((s) => s.key === show)?.test(r))
    .filter((r) => org === 'all' || (isPerson(r) ? r.employer?.code === org : r.code === org))
    .filter((r) => ws === 'all' || r.workstreams.includes(ws))
    .sort((a, b) => sort === 'name' ? (a.name ?? '').localeCompare(b.name ?? '')
      : sort === 'outstanding' ? b.outstanding - a.outstanding || (a.name ?? '').localeCompare(b.name ?? '')
      : sort === 'activity' ? (b.last_activity ?? '').localeCompare(a.last_activity ?? '')
      : LEVEL_ORDER.indexOf(a.engagement.level) - LEVEL_ORDER.indexOf(b.engagement.level) || catRank(a) - catRank(b) || b.outstanding - a.outstanding || (a.name ?? '').localeCompare(b.name ?? ''))

  return (
    <div className="space-y-5">
      <PageHeader title="Parties"
        description="Everyone on the deal: their roles, what they owe, whether requests to them are answered, and how engagement looks against their responsibilities, with the records behind every finding."
        actions={<Segmented label="Show" value={tab} onChange={(k) => set('tab', k === 'people' ? null : k)}
          options={[{ key: 'people', label: `People${data ? ` · ${data.people.length}` : ''}`, icon: Users },
                    { key: 'organisations', label: `Organisations${data ? ` · ${data.organisations.length}` : ''}`, icon: Building2 }]} />} />

      {data && (
        <div className={cn('grid gap-2 sm:grid-cols-2', tab === 'people' ? 'xl:grid-cols-4' : 'xl:grid-cols-5')} role="group" aria-label="Filter by finding">
          {STRIP.filter((s) => tab === 'organisations' || s.key !== 'statutory').map((s) => {
            const n = rows.filter(s.test).length
            const active = show === s.key
            return (
              <button key={s.key} type="button" onClick={() => set('show', active ? null : s.key)} aria-pressed={active}
                className={cn('cursor-pointer rounded-xl border bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-brand',
                  active && 'border-brand bg-brand-soft/60 hover:bg-brand-soft')}>
                <div className="text-[22px] leading-none font-semibold text-ink tabular">{n}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">{s.label}</div>
              </button>
            )
          })}
        </div>
      )}

      <Panel title={tab === 'people' ? 'People' : 'Organisations'} icon={tab === 'people' ? <Users /> : <Building2 />} query={q} skeletonRows={8} bodyClassName="px-0 pb-0"
        subtitle={data ? `${shown.length} of ${plural(rows.length, tab === 'people' ? 'person' : 'organisation', tab === 'people' ? 'people' : 'organisations')} · engagement is measured against each person's own responsibilities and requests, from the scenario date ${formatDate(data.as_of)}` : undefined}
        note="People and their employers, RACI assignments with the letter from the relation's type, every event (engagement subtypes and outreach read from the schema), authority reviews and the dependency data for schedule float. Contacts are read separately and masked before leaving the server."
        action={() => (
          <div className="flex flex-wrap items-center justify-end gap-2 text-[12.5px]">
            <label className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-brand">
              <Search className="size-3.5 text-muted-foreground" aria-hidden />
              <input value={text} onChange={(e) => set('q', e.target.value)} placeholder="Search names, titles, organisations" aria-label="Search"
                className="w-56 bg-transparent py-0.5 text-ink outline-none placeholder:text-muted-foreground" />
            </label>
            {tab === 'people' && <Select label="Organisation" value={org} onChange={(v) => set('org', v === 'all' ? null : v)} options={[['all', 'All organisations'], ...employers]} />}
            <Select label="Workstream" value={ws} onChange={(v) => set('ws', v === 'all' ? null : v)}
              options={[['all', 'All workstreams'], ...Object.entries(data?.workstream_names ?? {}).map(([k, v]) => [k, v ?? k] as [string, string])]} />
            <Select label="Sort" value={sort} onChange={(v) => set('sort', v === 'level' ? null : v)}
              options={[['level', 'Engagement (red first)'], ['outstanding', 'Most outstanding work'], ['activity', 'Most recent activity'], ['name', 'Name']]} />
          </div>
        )}>
        {() => (
          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className={cn(GRID, 'border-y bg-muted/50 py-2.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase')} role="row">
                <span className="px-6">{tab === 'people' ? 'Person' : 'Organisation'}</span>
                <span className="px-3">Engagement · why</span>
                <span className="px-3" title="Open items they are Accountable or Responsible for">Open A/R</span>
                <span className="px-3">Open letters</span>
                <span className="px-3">Delivery risk</span>
                <span className="px-3">Last activity</span>
                <span className="px-3">{tab === 'people' ? 'Contact (masked)' : 'People'}</span>
                <span />
              </div>
              <ul>{shown.map((r) => <RowView key={r.code} r={r} />)}</ul>
            </div>
            {!shown.length && <p className="py-10 text-center text-[13px] text-muted-foreground">Nobody matches these filters.</p>}
          </div>
        )}
      </Panel>

      {policy.data && <PolicyNote policy={policy.data.data} source={policy.data.source} />}
    </div>
  )
}

function RowView({ r }: { r: Row }) {
  const person = isPerson(r)
  return (
    <li className="border-b last:border-0">
        <Link to={`/parties/${r.code}`} className={rowClass(false, cn(GRID, 'w-full rounded-none px-0 py-2.5'))}
          aria-label={`${r.name}: ${LEVEL[r.engagement.level]?.label}, ${CATEGORY[r.engagement.category] ?? ''}. Open profile`}>
          <span className="min-w-0 px-6">
            <span className="block truncate text-[13px] font-medium text-ink" title={r.name ?? undefined}>{r.name}</span>
            <span className="block truncate text-[11.5px] text-muted-foreground">
              {person ? [r.title, r.employer?.name].filter(Boolean).join(', ') : humanise(r.type)}{r.authority ? ' · authority' : ''}
            </span>
          </span>
          <span className="min-w-0 px-3">
            <EngagementBadge level={r.engagement.level} category={r.engagement.category} />
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground" title={r.engagement.headline}>{r.engagement.headline}</span>
          </span>
          <span className="px-3 text-[13px] font-semibold text-ink tabular">{r.outstanding}</span>
          <span className="flex gap-1 px-3">
            {(['A', 'R', 'C', 'I'] as const).map((l) => (
              <span key={l} title={`${r.letters[l] ?? 0} open as ${l}`}
                className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10.5px] font-semibold tabular',
                  (r.letters[l] ?? 0) ? 'bg-muted text-ink' : 'text-border')}>{l}{r.letters[l] ? r.letters[l] : ''}</span>
            ))}
          </span>
          <span className="min-w-0 px-3 text-[12px]">
            {r.delivery_risk.length
              ? <span className="truncate text-warn" title={r.delivery_risk.map((d) => d.name).join(', ')}>{plural(r.delivery_risk.length, 'item')} {r.delivery_risk.every((d) => d.reason === 'at-risk') ? 'at risk' : 'at risk or late'}</span>
              : <span className="text-muted-foreground">None</span>}
          </span>
          <span className="px-3 text-[12px] text-muted-foreground">{r.last_activity ? formatDate(r.last_activity.slice(0, 10)) : 'None recorded'}</span>
          <span className="min-w-0 px-3 font-mono text-[11.5px] text-muted-foreground">
            {person ? <span className="block truncate" title="Masked on the server">{r.contact.email}</span>
              : <span className="font-sans">{r.people ? plural(r.people, 'person', 'people') : r.authority ? 'None recorded (authority)' : 'None'}</span>}
          </span>
          <RowChevron />
        </Link>
    </li>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="inline-flex items-center rounded-md border bg-white px-2 py-1 shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-brand">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="max-w-52 cursor-pointer bg-transparent py-0.5 text-ink outline-none">
        {options.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
    </label>
  )
}

function PolicyNote({ policy, source }: { policy: Schemas['EngagementPolicy']; source: string }) {
  return (
    <details className="rounded-xl border bg-white px-5 py-3 text-[12.5px] text-ink-soft shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink"><SlidersHorizontal className="size-4 text-brand" aria-hidden />How engagement is assessed (the policy in force)</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <ul className="list-disc space-y-1 pl-5">
          <li><span className="font-medium text-ink">Overdue response</span> (a fact, always first): a request to the person, or to their organisation about an item they are assigned to, whose reply-by date has passed with no response recorded. Amber when due within {plural(policy.response_warning_days, 'day')}.</li>
          <li><span className="font-medium text-ink">Inactive on an assigned item</span>: days since the person last engaged on <em>that item</em> (or since it became active), for Accountable and Responsible letters:{' '}
            {Object.entries(policy.inactivity).map(([l, t]) => `${l} amber from ${t.amber_from}, red from ${t.red_from}`).join('; ')} days. Activity elsewhere is context, never credit.</li>
          <li><span className="font-medium text-ink">Deal risk</span>: inactivity (amber) escalated to red when the item is schedule-critical (float of {policy.critical_float_days} days or less) or recorded as critical, <em>and</em> due within {plural(policy.urgent_window_days, 'day')} or at risk.</li>
        </ul>
        <ul className="list-disc space-y-1 pl-5">
          <li><span className="font-medium text-ink">Insufficient information</span>: no engagement recorded for the person anywhere. Shown as Unknown, never red.</li>
          <li><span className="font-medium text-ink">Consulted and Informed</span> people are assessed on the requests sent to them, not on silence.</li>
          <li><span className="font-medium text-ink">Authorities</span> follow their statutory timetable: amber within {plural(policy.statutory_warning_days, 'day')} of a decision date with none recorded, red once it passes. No individuals at real authorities are recorded.</li>
          <li>Engagement is what the schema calls <code>engagement</code> (responses, meetings, deliveries, decisions), plus requests and notices for their sender only. Point milestones become active {plural(policy.milestone_active_window_days, 'day')} before they are due.</li>
        </ul>
      </div>
      <p className="mt-3 text-[11.5px] text-muted-foreground">Source: {source} (configuration, not business data). All days are counted from the scenario date stored in TypeDB.</p>
    </details>
  )
}
