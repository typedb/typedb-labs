// "How are these two connected?" Paths come from /api/connections: entity → relation → entity, through
// people, organisations, work items and risks only (never the transaction itself), best first, with every
// step stated in words. The page only lays them out; choices live in the URL so a search can be linked.
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeftRight, Building2, CircleAlert, ClipboardList, ListChecks, Route, ShieldAlert, User } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useConnectables, useConnections, useDeal, type Schemas } from '@/api/client'
import { ItemDetail } from '@/components/gantt/item-detail'
import { Segmented } from '@/components/page'
import { PanelError } from '@/components/panel'
import { TypeQLDrawer } from '@/components/typeql'
import { humanise, plural } from '@/lib/format'
import { useSelectedItem } from '@/lib/selection'
import { cn } from '@/lib/utils'

type Node = Schemas['PathNode']
type Path = Schemas['Path_']

const KIND: Record<string, { label: string; icon: typeof User }> = {
  person: { label: 'Person', icon: User }, organisation: { label: 'Organisation', icon: Building2 },
  item: { label: 'Work item', icon: ClipboardList }, workstream: { label: 'Workstream', icon: ListChecks }, risk: { label: 'Risk', icon: ShieldAlert },
}

export function PathsView() {
  const [params, setParams] = useSearchParams()
  const from = params.get('from') ?? undefined
  const to = params.get('to') ?? undefined
  const hops = Number(params.get('hops') ?? 3) || 3
  const results = Number(params.get('n') ?? 20) || 20
  const activity = params.get('activity') !== 'false'
  const workstreams = params.get('ws') === 'true'
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }
  const things = useConnectables()
  const q = useConnections(from, to, { hops, results, activity, workstreams })
  const [selected, select] = useSelectedItem()
  const navigate = useNavigate()
  const asOf = useDeal().data?.data.as_of
  const byCode = useMemo(() => new Map((things.data?.data ?? []).map((n) => [n.code, n])), [things.data])

  return (
    <div className="space-y-5">
      <Card className="gap-0 overflow-hidden py-0 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]">
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Route className="size-4" /></div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">How are these two connected?</h2>
              <p className="text-[13px] text-muted-foreground">
                Every route of recorded relationships between two people, organisations, work items or risks, best first. Each step is a single
                record, stated in words. The transaction itself is never a step, so “both are on the deal” is never offered as a connection.
              </p>
            </div>
          </div>
          {things.isError ? <PanelError message={things.error.message} /> : (
            <div className="grid items-end gap-3 lg:grid-cols-[1fr_auto_1fr]">
              <Picker label="From" value={from} things={things.data?.data} onChange={(c) => set({ from: c })} />
              <button type="button" onClick={() => set({ from: to ?? null, to: from ?? null })} disabled={!from && !to}
                className="mb-0.5 inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-white px-3 text-[12.5px] font-medium text-ink-soft shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
                aria-label="Swap the two">
                <ArrowLeftRight className="size-4" aria-hidden />Swap
              </button>
              <Picker label="To" value={to} things={things.data?.data} onChange={(c) => set({ to: c })} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-ink-soft">
            <span className="inline-flex items-center gap-2">At most
              <Segmented label="Maximum steps" value={String(hops)} onChange={(k) => set({ hops: k === '3' ? null : k })}
                options={[{ key: '1', label: '1 step' }, { key: '2', label: '2 steps' }, { key: '3', label: '3 steps' }]} /></span>
            <span className="inline-flex items-center gap-2">Show
              <Segmented label="Number of paths" value={String(results)} onChange={(k) => set({ n: k === '20' ? null : k })}
                options={[{ key: '10', label: '10' }, { key: '20', label: '20' }, { key: '50', label: '50' }]} /></span>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={activity} onChange={(e) => set({ activity: e.target.checked ? null : 'false' })} className="size-3.5 accent-[#0f2a44]" />
              Include activity records (meetings, requests), in paths of up to 2 steps
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={workstreams} onChange={(e) => set({ ws: e.target.checked ? 'true' : null })} className="size-3.5 accent-[#0f2a44]" />
              Include shared workstreams (a weak link)
            </label>
          </div>
        </div>
        {q.data && <TypeQLDrawer envelope={q.data}
          note="Met in the middle: one query finds everything linked to each end (role-less matching over every relation type, entities only through the kind statement `entity $t;`), a third finds the relations joining the two sets; then each relation on the best paths is re-read by its iid with every player and role." />}
      </Card>

      {!from || !to ? <Hint /> : from === to ? <p className="text-[13px] text-muted-foreground">Choose two different things.</p>
        : q.isPending ? <Skeleton className="h-64 w-full rounded-xl" />
        : q.isError ? <PanelError message={q.error.message} />
        : <Results data={q.data.data} stale={q.isPlaceholderData} onItem={select} onMore={() => set({ n: '50' })} byCode={byCode} />}

      {selected && asOf && (
        <ItemDetail code={selected} asOf={asOf} onClose={() => select(undefined)} onSelect={select} onShowWorkstream={(w) => navigate(`/workstreams/${w}`)} />
      )}
    </div>
  )
}

function Hint() {
  return (
    <div className="rounded-xl border border-dashed bg-white/60 px-5 py-8 text-center text-[13px] text-muted-foreground">
      Choose two things to see how the records connect them, for example a person and an authority, or a risk and a lender.
    </div>
  )
}

function Picker({ label, value, things, onChange }: { label: string; value?: string; things?: Node[]; onChange: (code: string | null) => void }) {
  const current = things?.find((t) => t.code === value)
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (current ? optionText(current) : '')
  const id = `picker-${label}`
  return (
    <label className="block text-[12px] font-medium text-muted-foreground">
      {label}
      <input list={id} value={shown} placeholder="Search people, organisations, work items, risks"
        onChange={(e) => {
          setText(e.target.value)
          const hit = things?.find((t) => optionText(t) === e.target.value)
          if (hit) { onChange(hit.code); setText(null) }
        }}
        onBlur={() => setText(null)}
        className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-[13px] text-ink shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand" />
      <datalist id={id}>
        {things?.map((t) => <option key={t.code} value={optionText(t)} />)}
      </datalist>
    </label>
  )
}

function optionText(n: Node) {
  return `${n.name} · ${KIND[n.kind]?.label ?? n.kind}`
}

function Results({ data, stale, onItem, onMore, byCode }: {
  data: Schemas['Connections']; stale: boolean; onItem: (code: string) => void; onMore: () => void; byCode: Map<string, Node>
}) {
  const direct = data.paths.filter((p) => p.direct).length
  const steps = data.depths.map((d) => `${plural(d.paths, 'path')} of ${plural(d.hops, 'step')}`).join(', ')
  return (
    <div className={cn('space-y-4 transition-opacity', stale && 'opacity-60')}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-[13.5px] text-ink">
          <span className="font-semibold">{plural(data.total, 'path')}</span> from <NodeLink n={data.from} onItem={onItem} /> to <NodeLink n={data.to} onItem={onItem} />
          {data.total > 0 && <span className="text-muted-foreground"> · {steps}{direct ? ` · ${direct} direct` : ''}</span>}
        </p>
        <p className="text-[12px] text-muted-foreground tabular">{data.elapsed_ms} ms</p>
      </div>
      {data.depths.filter((d) => d.capped || d.skipped).map((d) => (
        <p key={d.hops} className="flex items-center gap-1.5 text-[12.5px] text-warn"><CircleAlert className="size-4" aria-hidden />
          {d.skipped ? d.note : `Paths of ${d.hops} steps hit the row cap: the list may be incomplete.`}</p>
      ))}
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">{data.disclaimer}</p>
      {data.paths.length === 0 ? (
        <div className="rounded-xl border bg-white px-5 py-8 text-center text-[13px] text-muted-foreground">
          No connection within {plural(data.max_hops, 'step')}{!data.activity ? ' without activity records' : ''}. Try more steps
          {data.activity ? '' : ', include activity records'}{data.workstreams ? '' : ', or include shared workstreams'}.
        </div>
      ) : (
        <ol className="space-y-3">{data.paths.map((p) => <PathCard key={p.rank} p={p} onItem={onItem} byCode={byCode} />)}</ol>
      )}
      {data.more.length > 0 && (
        <div className="rounded-xl border bg-white px-5 py-4 text-[12.5px]">
          <div className="mb-1.5 font-medium text-ink">{plural(data.more.reduce((n, g) => n + g.count, 0), 'more path')}, by what they go through</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ink-soft">
            {data.more.map((g) => <li key={g.through?.code ?? 'direct'}>{g.count} {g.through ? <>through {g.through.name}</> : 'direct'}</li>)}
          </ul>
          {data.paths.length < 50 && <button type="button" onClick={onMore} className="mt-2 cursor-pointer font-medium text-brand hover:underline">Show up to 50 paths</button>}
        </div>
      )}
    </div>
  )
}

function PathCard({ p, onItem, byCode }: { p: Path; onItem: (code: string) => void; byCode: Map<string, Node> }) {
  return (
    <li className="rounded-xl border bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-muted-foreground tabular">#{p.rank}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset',
          p.direct ? 'bg-ok-soft text-ok ring-ok/20' : 'bg-info-soft text-info ring-info/20')}>
          {p.direct ? 'Direct relationship' : `Indirect · ${p.hops} steps`}
        </span>
        <span className="text-[11.5px] text-muted-foreground" title="Ranking cost (config/connection-policy.yaml): lower is more specific">cost {p.cost}</span>
      </div>
      {/* The route as a chain: thing — relation — thing. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {p.nodes.map((n, i) => (
          <span key={`${n.code}-${i}`} className="contents">
            <NodeChip n={n} onItem={onItem} />
            {i < p.steps.length && (
              <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                <span aria-hidden>—</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-ink-soft" title={`${p.steps[i].from_role} → ${p.steps[i].to_role}`}>{humanise(p.steps[i].type)}</span>
                <span aria-hidden>—</span>
              </span>
            )}
          </span>
        ))}
      </div>
      <ol className="mt-3 space-y-1.5 border-t pt-3 text-[13px]">
        {p.steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-ink-soft">{i + 1}</span>
            <span className="min-w-0">
              <span className="text-ink">{capitalise(s.sentence)}.</span>
              <span className="block text-[11.5px] text-muted-foreground">
                {humanise(s.type)} record{s.code ? ` ${s.code}` : ''}: {byCode.get(s.from)?.name ?? s.from} as {humanise(s.from_role)}, {byCode.get(s.to)?.name ?? s.to} as {humanise(s.to_role)}
                {s.others.length > 0 && <> · also in this record: {s.others.map((o) => `${o.name} (${humanise(o.role)})`).join(', ')}</>}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {p.notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
          {p.notes.map((n) => <li key={n} className="flex gap-1.5"><CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />{n}</li>)}
        </ul>
      )}
    </li>
  )
}

function NodeChip({ n, onItem }: { n: Node; onItem: (code: string) => void }) {
  const { icon: Icon, label } = KIND[n.kind] ?? KIND.organisation
  const cls = 'inline-flex max-w-72 items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[12.5px] font-medium text-ink shadow-sm hover:border-brand/40 hover:bg-brand-soft/50 focus-visible:outline-2 focus-visible:outline-brand'
  const body = <><Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label={label} /><span className="truncate" title={`${n.name} (${label})`}>{n.name}</span></>
  if (n.kind === 'person' || n.kind === 'organisation') return <Link to={`/parties/${n.code}`} className={cls}>{body}</Link>
  if (n.kind === 'workstream') return <Link to={`/workstreams/${n.code}`} className={cls}>{body}</Link>
  if (n.kind === 'item') return <button type="button" onClick={() => onItem(n.code)} className={cn(cls, 'cursor-pointer')}>{body}</button>
  return <span className={cls.replace(/hover:\S+/g, '')}>{body}</span>
}

function NodeLink({ n, onItem }: { n: Node; onItem: (code: string) => void }) {
  if (n.kind === 'person' || n.kind === 'organisation') return <Link to={`/parties/${n.code}`} className="font-medium text-brand hover:underline">{n.name}</Link>
  if (n.kind === 'workstream') return <Link to={`/workstreams/${n.code}`} className="font-medium text-brand hover:underline">{n.name}</Link>
  if (n.kind === 'item') return <button type="button" onClick={() => onItem(n.code)} className="cursor-pointer font-medium text-brand hover:underline">{n.name}</button>
  return <span className="font-medium">{n.name}</span>
}

function capitalise(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
