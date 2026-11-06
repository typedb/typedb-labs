// React Flow node and edge components for the Relationship Explorer and the group structure.
import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, Handle, Position, getBezierPath, type EdgeProps, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Users } from 'lucide-react'
import type { Player, Relation } from '@/lib/graph-layout'
import { formatMoney, formatPercent, humanise } from '@/lib/format'
import { cn } from '@/lib/utils'
import { familyStyle, relationStyle } from './style'

const hidden = '!size-1 !min-w-0 !border-0 !bg-transparent'

export type OrgNodeData = {
  name: string; subtitle: string; family: string; people?: number
  state: 'normal' | 'selected' | 'neighbour' | 'dim'; peopleShown?: boolean; badge?: string; outside?: boolean
  vertical?: boolean
}

export const OrgNode = memo(function OrgNode({ data }: NodeProps & { data: OrgNodeData }) {
  const fam = familyStyle(data.family)
  const Icon = fam.icon
  const [inPos, outPos] = data.vertical ? [Position.Top, Position.Bottom] : [Position.Left, Position.Right]
  return (
    <div className={cn('group flex h-full w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-white px-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-all',
      data.outside && 'border-dashed bg-slate-50',
      data.state === 'selected' && 'border-ink shadow-[0_0_0_3px_rgba(15,42,68,0.15),0_6px_16px_rgba(15,42,68,0.12)]',
      data.state === 'neighbour' && 'border-ink/40',
      data.state === 'dim' && 'opacity-30',
      data.state === 'normal' && 'hover:border-ink/40 hover:shadow-md')}>
      <Handle type="target" position={inPos} className={hidden} isConnectable={false} />
      <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', fam.chip)}><Icon className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[12.5px] leading-tight font-semibold text-ink">{data.name}</div>
        <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{data.subtitle}</div>
      </div>
      {data.badge && <div className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand tabular">{data.badge}</div>}
      {!data.badge && data.people ? (
        <div className={cn('flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium', data.peopleShown ? 'bg-ink text-white' : 'bg-muted text-muted-foreground')}>
          <Users className="size-3" />{data.people}
        </div>
      ) : null}
      <Handle type="source" position={outPos} className={hidden} isConnectable={false} />
    </div>
  )
})

export type PersonNodeData = { name: string; title: string; state: OrgNodeData['state'] }

export const PersonNode = memo(function PersonNode({ data }: NodeProps & { data: PersonNodeData }) {
  return (
    <div className={cn('flex h-full w-full cursor-pointer items-center gap-2 rounded-full border bg-white pr-3 pl-1.5 shadow-sm transition-all',
      data.state === 'selected' && 'border-ink shadow-[0_0_0_3px_rgba(15,42,68,0.15)]', data.state === 'dim' && 'opacity-30')}>
      <Handle type="target" position={Position.Left} className={hidden} isConnectable={false} />
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
        {data.name.split(' ').filter((w) => !/^(Dr|Mr|Ms)$/.test(w)).map((w) => w[0]).slice(0, 2).join('')}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11.5px] leading-tight font-semibold text-ink">{data.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">{data.title}</div>
      </div>
      <Handle type="source" position={Position.Right} className={hidden} isConnectable={false} />
    </div>
  )
})

export type SummaryNodeData = { label: string; count: number; state: OrgNodeData['state'] }

export const SummaryNode = memo(function SummaryNode({ data }: NodeProps & { data: SummaryNodeData }) {
  return (
    <div className={cn('flex h-full w-full cursor-pointer items-center gap-2.5 rounded-xl border-2 border-dashed border-ink/25 bg-white/90 px-3 transition-all hover:border-ink/50',
      data.state === 'dim' && 'opacity-30')}>
      <Handle type="target" position={Position.Left} className={hidden} isConnectable={false} />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[12px] font-semibold text-ink tabular">{data.count}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-ink">{data.label}</div>
        <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground"><ChevronRight className="size-3" />Collapsed · click to expand</div>
      </div>
      <Handle type="source" position={Position.Right} className={hidden} isConnectable={false} />
    </div>
  )
})

export type ClusterNodeData = { label: string; count: number; onCollapse?: () => void }

export const ClusterNode = memo(function ClusterNode({ data }: NodeProps & { data: ClusterNodeData }) {
  return (
    <div className="pointer-events-none h-full w-full rounded-2xl border border-slate-200/90 bg-slate-50/70">
      <div className="pointer-events-auto flex items-center gap-1 pt-2 pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold tracking-[0.06em] text-slate-500 uppercase" title={data.label}>{data.label}</span>
        {data.onCollapse && data.count > 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); data.onCollapse!() }} title={`Collapse ${data.label}`} aria-label={`Collapse ${data.label}`}
            className="nodrag inline-flex shrink-0 items-center rounded p-0.5 text-slate-400 hover:bg-white hover:text-ink">
            <ChevronDown className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
})

/** A short description of a relation for its line label, from its own attributes and players. */
export function relationSummary(r: Relation, context: Player[] = []): string {
  const a = r.attributes as Record<string, string | undefined>
  const subject = context.find((p) => p.role === 'subject')
  switch (r.type) {
    case 'acquisition': return `${a.name ?? 'Acquisition'} · ${a['deal-value'] ? formatMoney(a['deal-value'], a.currency) : ''}`
    case 'mandate': return a['mandate-type'] ?? 'Mandate'
    case 'financing': return a['deal-value'] ? `${formatMoney(a['deal-value'], a.currency)} facility` : (a.name ?? 'Financing')
    case 'authority-review': return subject?.name ?? 'Review'
    case 'ownership': return a.stake ? formatPercent(a.stake) : 'Ownership'
    case 'employment': return a['job-title'] ?? 'Employment'
    default: return humanise(r.type)
  }
}

export type RelationEdgeData = {
  relation: Relation; context: Player[]; count?: number
  state: 'normal' | 'highlight' | 'dim'; showLabel: boolean; vertical?: boolean; outside?: boolean
  /** A route from the layout engine; without one the line is a curve between the two boxes. */
  points?: { x: number; y: number }[]
}

/** A right-angled path through the points, with softly rounded corners; label at the middle of
 *  the longest segment, where it has the most room. */
function routedPath(pts: { x: number; y: number }[]): [string, number, number] {
  const r = 8
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const k1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2), k2 = Math.min(r, Math.hypot(c.x - b.x, c.y - b.y) / 2)
    const u = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }, v = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) }
    d += ` L ${b.x - u.x * k1} ${b.y - u.y * k1} Q ${b.x} ${b.y} ${b.x + v.x * k2} ${b.y + v.y * k2}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  let best = 0, at = { x: (pts[0].x + last.x) / 2, y: (pts[0].y + last.y) / 2 }
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (len > best) { best = len; at = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 } }
  }
  return [d, at.x, at.y]
}

export function RelationEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps & { data: RelationEdgeData }) {
  const tone = relationStyle(data.relation.type)
  const [path, lx, ly] = data.points && data.points.length > 1
    ? routedPath(data.points)
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 })
  const width = (tone.width ?? 1.75) + (data.state === 'highlight' ? 1 : 0)
  const label = data.count && data.count > 1 ? `${tone.label} ×${data.count}` : relationSummary(data.relation, data.context)
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd}
        style={{ stroke: tone.stroke, strokeWidth: width, strokeDasharray: data.outside ? '5 4' : tone.dash, opacity: data.state === 'dim' ? 0.12 : 0.9 }} />
      {data.showLabel && data.state !== 'dim' && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan pointer-events-auto absolute cursor-pointer rounded-md border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, color: tone.text, borderColor: tone.soft }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const nodeTypes = { org: OrgNode, person: PersonNode, summary: SummaryNode, cluster: ClusterNode }
export const edgeTypes = { relation: RelationEdge }
