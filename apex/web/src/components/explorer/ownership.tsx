// Group structure: direct legal shareholdings (ownership relations as recorded) and effective economic interest
// (TypeDB's recursive group_members), with every route behind each effective figure.
import { useEffect, useMemo, useState } from 'react'
import { MarkerType, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, Building2, GitFork, Handshake, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useOwnership, type Schemas } from '@/api/client'
import { PanelError } from '@/components/panel'
import { TypeQLDrawer } from '@/components/typeql'
import { layoutTree, type Layout, type Relation } from '@/lib/graph-layout'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { edgeTypes, nodeTypes } from './canvas'

type Own = Schemas['Ownership']
const W = 224, H = 62

function Tree({ data, selected, setSelected, route }: { data: Own; selected?: string; setSelected: (c: string) => void; route?: Schemas['Route'] }) {
  const { fitView } = useReactFlow()
  const [layout, setLayout] = useState<Layout>()
  const effective = useMemo(() => Object.fromEntries(data.companies.map((c) => [c.code, c])), [data])
  const outside = useMemo(() => new Set(data.outside_shareholders.map((o) => o.code)), [data])
  useEffect(() => {
    const codes = [data.parent, ...data.companies.map((c) => c.code), ...data.outside_shareholders.map((o) => o.code)]
    layoutTree(codes.map((code) => ({ code, cluster: 'group', width: W, height: H })),
      data.direct.map((d) => ({ id: `${d.owner}>${d.owned}`, source: d.owner, target: d.owned })))
      .then(setLayout)
  }, [data])
  // Fit only once React Flow has measured the boxes: fitting earlier divides by zero sizes.
  const measured = useNodesInitialized()
  useEffect(() => {
    if (layout && measured) fitView({ padding: 0.08 })
  }, [layout, measured, fitView])
  if (!layout) return <Skeleton className="h-full w-full" />

  const onRoute = new Set((route?.steps ?? []).map((s) => `${s.owner}>${s.owned}`))
  const routeNodes = new Set((route?.steps ?? []).flatMap((s) => [s.owner, s.owned]))
  const nodes: Node[] = Object.entries(layout.nodes).map(([code, box]) => {
    const c = effective[code]
    const state = route ? (routeNodes.has(code) ? (code === selected ? 'selected' : 'neighbour') : 'dim') : code === selected ? 'selected' : 'normal'
    return {
      id: code, type: 'org', position: { x: box.x, y: box.y }, style: { width: box.width, height: box.height },
      data: { name: data.names[code] ?? code, family: 'company', vertical: true, outside: outside.has(code), state,
              subtitle: code === data.parent ? 'Parent: target of the deal' : outside.has(code) ? 'Outside shareholder'
                : `Effective · ${c.routes} ${c.routes === 1 ? 'route' : 'routes'}`,
              badge: c ? formatPercent(c.stake) : undefined },
    }
  })
  const edges: Edge[] = data.direct.map((d) => {
    const id = `${d.owner}>${d.owned}`
    const relation: Relation = { key: id, type: 'ownership', attributes: { stake: d.stake },
      players: [{ role: 'owner', code: d.owner, type: 'company', kind: 'entity' }, { role: 'owned', code: d.owned, type: 'company', kind: 'entity' }] }
    const state = route ? (onRoute.has(id) ? 'highlight' : 'dim') : 'normal'
    return { id, source: d.owner, target: d.owned, type: 'relation', zIndex: state === 'highlight' ? 5 : 1,
      markerEnd: { type: MarkerType.ArrowClosed, color: d.inside_group ? '#138a7e' : '#94a3b8', width: 16, height: 16 },
      data: { relation, context: [], state, showLabel: true, outside: !d.inside_group, points: layout.routes?.[id] } }
  })
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false}
      minZoom={0.3} maxZoom={1.5} fitView proOptions={{ hideAttribution: true }} panOnScroll={false}
      onNodeClick={(_, n) => effective[n.id] && setSelected(n.id)} />
  )
}

function Chain({ route, names }: { route: Schemas['Route']; names: Own['names'] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[12px]">
      <span className="font-medium text-ink">{names[route.steps[0].owner]}</span>
      {route.steps.map((s) => (
        <span key={`${s.owner}>${s.owned}`} className="inline-flex items-center gap-1">
          <span className="inline-flex items-center gap-0.5 rounded bg-[#e3f5f2] px-1 text-[11px] font-semibold text-[#0d6e64] tabular">
            <ArrowRight className="size-3" />{formatPercent(s.stake)}
          </span>
          <span className="font-medium text-ink">{names[s.owned]}</span>
        </span>
      ))}
    </div>
  )
}

function CompanyPanel({ data, code, onHover }: { data: Own; code: string; onHover: (r?: Schemas['Route']) => void }) {
  const c = data.companies.find((x) => x.code === code)!
  const holders = data.direct.filter((d) => d.owned === code)
  const consents = data.consents.filter((x) => x.owed_by === code)
  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{data.parent_name}'s effective economic interest in</div>
        <h3 className="mt-1 text-[16px] font-semibold text-ink">{c.name}</h3>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight text-ink tabular">{formatPercent(c.stake)}</span>
          <span className="text-[12.5px] text-muted-foreground">over {c.routes} {c.routes === 1 ? 'route' : 'routes'}</span>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">How it is calculated</h4>
        <ol className="space-y-2">
          {c.paths.map((r, i) => (
            <li key={i} onMouseEnter={() => onHover(r)} onMouseLeave={() => onHover(undefined)} onClick={() => onHover(r)}
              className="cursor-default rounded-lg border bg-white px-3 py-2.5 transition-colors hover:border-[#138a7e]/50 hover:bg-[#e3f5f2]/40">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                <span>Route {i + 1}</span>
                <span className="text-[13px] text-ink tabular">{r.steps.map((s) => formatPercent(s.stake)).join(' × ')} = {formatPercent(r.stake)}</span>
              </div>
              <Chain route={r} names={data.names} />
            </li>
          ))}
        </ol>
        {c.paths.length > 1 && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-ink px-3 py-2 text-[12.5px] font-semibold text-white">
            <span>Effective economic interest</span>
            <span className="tabular">{c.paths.map((r) => formatPercent(r.stake)).join(' + ')} = {formatPercent(c.stake)}</span>
          </div>
        )}
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          The total and the number of routes come from TypeDB's recursive <code className="rounded bg-muted px-1">group_members</code> function.
          The routes are listed from the direct holdings, and the API refuses to answer unless they add up to TypeDB's figure exactly.
        </p>
      </div>
      <div>
        <h4 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Direct shareholdings (legal)</h4>
        <ul className="space-y-2">
          {holders.map((h) => (
            <li key={h.owner} className="text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className={cn('font-medium text-ink', !h.inside_group && 'text-foreground/70')}>{data.names[h.owner]}{!h.inside_group && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">outside</span>}</span>
                <span className="font-semibold text-ink tabular">{formatPercent(h.stake)}</span>
              </div>
              {h.description && <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{h.description}</p>}
            </li>
          ))}
        </ul>
      </div>
      {consents.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Change-of-control consents it owes</h4>
          <ul className="space-y-1.5">{consents.map((x) => <li key={x.obligation} className="text-[12.5px]"><span className="font-medium text-ink">{x.obligation_name}</span><span className="text-muted-foreground"> · consent from {data.names[x.consent_from] ?? x.consent_from}</span></li>)}</ul>
        </div>
      )}
    </div>
  )
}

/** The target's group structure, with direct and effective ownership kept clearly apart. */
export function OwnershipView() {
  const q = useOwnership()
  const [chosen, setChosen] = useState<string>()
  const [route, setRoute] = useState<Schemas['Route']>()
  if (q.isPending) return <Skeleton className="h-[640px] w-full rounded-xl" />
  if (q.isError) return <Card className="p-5"><h2 className="mb-2 font-semibold text-ink">Group structure withheld</h2><PanelError message={q.error.message} /></Card>
  const data = q.data.data
  // Start on the company with the most routes: the one whose figure most needs explaining.
  const selected = chosen ?? [...data.companies].sort((a, b) => b.routes - a.routes)[0]?.code
  return (
    <div className="space-y-6">
      <Card className="gap-0 overflow-hidden py-0 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]">
        <div className="flex flex-col gap-3 border-b px-5 py-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand"><GitFork className="size-4" /></div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">{data.parent_name} group structure</h2>
              <p className="text-[13px] text-muted-foreground">What the acquirer is buying: {data.companies.length} companies below the target, and who else owns part of them.</p>
            </div>
          </div>
          <div className="grid gap-2 text-[12px] sm:grid-cols-2 lg:ml-auto lg:max-w-xl">
            <div className="flex items-start gap-2 rounded-lg bg-[#e3f5f2]/60 px-3 py-2">
              <span className="mt-0.5 inline-flex shrink-0 items-center rounded border border-[#138a7e]/30 bg-white px-1 text-[10.5px] font-semibold text-[#0d6e64]">70%</span>
              <span><span className="font-semibold text-ink">Direct shareholding (legal)</span>: recorded on each ownership relation (the line labels).</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-brand-soft/70 px-3 py-2">
              <span className="mt-0.5 inline-flex shrink-0 items-center rounded bg-white px-1 text-[10.5px] font-semibold text-brand">90%</span>
              <span><span className="font-semibold text-ink">Effective economic interest</span>: calculated by multiplying along every route from the parent and adding the routes up.</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col lg:flex-row">
          <div className="relative h-[440px] w-full min-w-0 bg-[#fbfcfd] sm:h-[520px] lg:h-[600px] lg:w-auto lg:flex-1">
            <ReactFlowProvider><Tree data={data} selected={selected} setSelected={(c) => { setChosen(c); setRoute(undefined) }} route={route} /></ReactFlowProvider>
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-white/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
              <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="1" y1="3" x2="17" y2="3" stroke="#138a7e" strokeWidth="2" /></svg>Inside the group</span>
              <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="1" y1="3" x2="17" y2="3" stroke="#138a7e" strokeWidth="2" strokeDasharray="5 4" /></svg>Outside shareholder</span>
            </div>
          </div>
          <aside className="min-w-0 border-t bg-white lg:w-[380px] lg:overflow-y-auto lg:border-t-0 lg:border-l" style={{ maxHeight: 600 }}>
            {selected && <CompanyPanel data={data} code={selected} onHover={setRoute} />}
          </aside>
        </div>
        <TypeQLDrawer envelope={q.data} note="Guard queries look for ownership cycles and holdings over 100% first; then a recursive function multiplies stakes down every route, and finds change-of-control consents inside the group." />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <div className="flex items-start gap-3 p-5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-ok-soft text-ok"><ShieldCheck className="size-4" /></div>
            <div>
              <h3 className="text-[14px] font-semibold text-ink">Ownership checks passed</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Before any percentage is calculated, TypeDB checks, in the same read transaction, that there are no ownership cycles
                and that no company is more than 100% owned. If either finds anything, no figures are shown at all.
                (Effective ownership assumes no cross-shareholdings: a deliberate simplification, not a claim about real groups.)
              </p>
            </div>
          </div>
        </Card>
        <Card className="gap-0 py-0">
          <div className="flex items-start gap-3 p-5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-warn-soft text-warn"><Handshake className="size-4" /></div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-ink">Change-of-control consents inside the group</h3>
              <ul className="mt-2 space-y-2">
                {data.consents.map((x) => (
                  <li key={x.obligation} className="flex items-start gap-2 text-[12.5px]">
                    <Building2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span><span className="font-medium text-ink">{x.obligation_name}</span>
                      <span className="block text-muted-foreground">Owed by {data.names[x.owed_by]} ({formatPercent(x.stake)} effective) · consent from {data.names[x.consent_from] ?? x.consent_from}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
