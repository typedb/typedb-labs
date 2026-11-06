// The dependency chain from the delayed approval: items (planned -> projected), the hard and soft
// dependencies between them and the deadlines they run into, all from /api/impact.
import { memo, useEffect, useMemo, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Flag } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import type { Schemas } from '@/api/client'
import { layoutTree, type Layout } from '@/lib/graph-layout'
import { formatDate, humanise } from '@/lib/format'
import { cn } from '@/lib/utils'

type Impact = Schemas['Impact']
type Item = Schemas['ImpactItem'] | Schemas['ImpactDeadline']
const W = 192, H = 58
const hidden = '!size-1 !min-w-0 !border-0 !bg-transparent'

type ItemNodeData = { item: Item; state: 'normal' | 'focus' | 'path' | 'dim' }

const ItemNode = memo(function ItemNode({ data }: NodeProps & { data: ItemNodeData }) {
  const it = data.item
  const isDeadline = it.role === 'deadline'
  const dl = it as Schemas['ImpactDeadline']
  const moved = it.shift_days > 0
  return (
    <div className={cn('flex h-full w-full cursor-pointer flex-col justify-center rounded-xl border bg-white px-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-all',
      it.role === 'start' && 'border-2 border-ink',
      it.role === 'context' && 'border-dashed bg-slate-50',
      isDeadline && (dl.breached ? 'border-2 border-risk bg-risk-soft' : 'border-risk/40'),
      !isDeadline && moved && it.role !== 'start' && 'border-warn/60 bg-warn-soft/50',
      data.state === 'focus' && 'shadow-[0_0_0_3px_rgba(15,42,68,0.18),0_6px_16px_rgba(15,42,68,0.12)]',
      data.state === 'dim' && 'opacity-30')}>
      <Handle type="target" position={Position.Left} className={hidden} isConnectable={false} />
      <div className="flex items-center gap-1.5">
        {isDeadline && <Flag className={cn('size-3 shrink-0', dl.breached ? 'text-risk' : 'text-risk/60')} />}
        <span className="line-clamp-2 text-[11.5px] leading-tight font-semibold text-ink">{it.name}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1 text-[10.5px]">
        <span className="truncate text-muted-foreground">{isDeadline ? `Deadline ${formatDate(dl.due, { year: false })}` : humanise(it.type)}</span>
        {isDeadline
          ? <span className={cn('shrink-0 font-semibold tabular', dl.breached ? 'text-risk' : 'text-ok')}>{dl.breached ? `+${dl.days_over}d over` : `${dl.headroom_days}d left`}</span>
          : moved ? <span className="shrink-0 font-semibold text-warn tabular">+{it.shift_days}d</span>
            : <span className="shrink-0 text-muted-foreground">{it.role === 'context' ? 'soft link' : 'on plan'}</span>}
      </div>
      <Handle type="source" position={Position.Right} className={hidden} isConnectable={false} />
    </div>
  )
})

type DepEdgeData = { kind: string; lag?: number | null; hard: boolean; moved: boolean; state: 'normal' | 'path' | 'dim'; points?: { x: number; y: number }[] }

function DepEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd }: EdgeProps & { data: DepEdgeData }) {
  const pts = data.points && data.points.length > 1 ? data.points : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }]
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`
  const mid = pts[Math.floor((pts.length - 1) / 2)], mid2 = pts[Math.floor((pts.length - 1) / 2) + 1] ?? mid
  const isLimit = data.kind === 'deadline-limit'
  const colour = isLimit ? '#dc2626' : !data.hard ? '#94a3b8' : data.moved ? '#c7811c' : '#64748b'
  const width = data.state === 'path' ? 2.75 : data.hard && data.moved ? 2 : 1.25
  return (
    <>
      <BaseEdge id={id} path={d} markerEnd={markerEnd}
        style={{ stroke: colour, strokeWidth: width, strokeDasharray: !data.hard ? (isLimit ? '5 4' : '2 4') : undefined, opacity: data.state === 'dim' ? 0.12 : 0.95 }} />
      {data.hard && !!data.lag && data.state !== 'dim' && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan absolute rounded bg-white px-1 text-[9.5px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200"
            style={{ transform: `translate(-50%, -50%) translate(${(mid.x + mid2.x) / 2}px, ${(mid.y + mid2.y) / 2}px)` }}>+{data.lag}d</div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { item: ItemNode }
const edgeTypes = { dep: DepEdge }

/** The deadline routes: every item on a route from the delayed approval to a deadline-limited item. */
export function criticalPath(data: Impact): Set<string> {
  const byCode = new Map(data.items.map((i) => [i.code, i]))
  const keep = new Set<string>([data.start.code])
  for (const d of data.deadlines) for (const l of d.limits) for (const c of byCode.get(l.code)?.path ?? [l.code]) keep.add(c)
  return keep
}

function Canvas({ data, showSoft, showAll, selected, onSelect }: { data: Impact; showSoft: boolean; showAll: boolean; selected?: string; onSelect: (c?: string) => void }) {
  const { fitView } = useReactFlow()
  const [layout, setLayout] = useState<Layout>()
  const all = useMemo(() => {
    const critical = criticalPath(data)
    const m = new Map<string, Item>()
    for (const i of data.items) if (showAll || critical.has(i.code) || i.code === selected) m.set(i.code, i)
    for (const d of data.deadlines) m.set(d.code, d)
    if (showSoft) for (const c of data.context) m.set(c.code, c)
    return m
  }, [data, showSoft, showAll, selected])
  const edges = useMemo(() => data.edges.filter((e) => all.has(e.from) && all.has(e.to)), [data.edges, all])
  // The structure doesn't change with the delay, so the layout only re-runs when the set of boxes does.
  const structure = [...all.keys()].sort().join(',') + '|' + edges.map((e) => `${e.from}>${e.to}`).sort().join(',')
  useEffect(() => {
    let live = true
    layoutTree([...all.keys()].map((code) => ({ code, cluster: 'g', width: W, height: H })),
      edges.map((e) => ({ id: `${e.from}>${e.to}`, source: e.from, target: e.to })), 'RIGHT').then((l) => { if (live) setLayout(l) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure])
  const measured = useNodesInitialized()
  useEffect(() => { if (layout && measured) fitView({ padding: 0.05 }) }, [layout, measured, fitView])
  if (!layout) return <Skeleton className="h-full w-full" />

  const focus = selected ? all.get(selected) : undefined
  const onPath = new Set<string>(focus ? focus.path : [])
  if (focus && focus.role === 'deadline') for (const l of (focus as Schemas['ImpactDeadline']).limits) for (const c of data.items.find((i) => i.code === l.code)?.path ?? []) onPath.add(c)
  if (focus) onPath.add(focus.code)
  const pathEdges = new Set<string>()
  for (const c of onPath) {
    const it = all.get(c)
    if (it) it.path.forEach((x, i) => { if (i > 0) pathEdges.add(`${it.path[i - 1]}>${x}`) })
  }
  if (focus?.role === 'deadline') for (const l of (focus as Schemas['ImpactDeadline']).limits) pathEdges.add(`${l.code}>${focus.code}`)

  const nodes: Node[] = [...all.values()].filter((i) => layout.nodes[i.code]).map((i) => ({
    id: i.code, type: 'item', position: { x: layout.nodes[i.code].x, y: layout.nodes[i.code].y }, style: { width: W, height: H },
    data: { item: i, state: !focus ? 'normal' : i.code === focus.code ? 'focus' : onPath.has(i.code) ? 'path' : 'dim' },
  }))
  const rfEdges: Edge[] = edges.map((e) => {
    const id = `${e.from}>${e.to}`
    const state = !focus ? 'normal' : pathEdges.has(id) ? 'path' : 'dim'
    const colour = e.kind === 'deadline-limit' ? '#dc2626' : !e.hard ? '#94a3b8' : e.moved ? '#c7811c' : '#64748b'
    return { id, source: e.from, target: e.to, type: 'dep', zIndex: state === 'path' ? 5 : 1,
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 14, height: 14 },
      data: { kind: e.kind, lag: e.lag, hard: e.hard, moved: e.moved, state, points: layout.routes?.[id] } }
  })
  return (
    <ReactFlow nodes={nodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false}
      minZoom={0.25} maxZoom={1.6} fitView proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => onSelect(n.id === selected ? undefined : n.id)} onPaneClick={() => onSelect(undefined)} />
  )
}

export function DependencyGraph(props: { data: Impact; showSoft: boolean; showAll: boolean; selected?: string; onSelect: (c?: string) => void }) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}

export function GraphLegend({ data }: { data: Impact }) {
  const hard = data.hard_kinds.filter((k) => k !== 'hard-dependency')
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#c7811c" strokeWidth="2.5" /></svg>Hard dependency that moved a date ({hard.map(humanise).join(', ')})</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#64748b" strokeWidth="1.5" /></svg>Hard dependency, slack absorbed</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="2 4" /></svg>Soft dependency (informing: dates don't move)</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#dc2626" strokeWidth="1.5" strokeDasharray="5 4" /></svg>Limited by a contractual deadline</span>
    </div>
  )
}
