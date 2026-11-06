// Turning the /api/graph answer into positioned boxes and lines. Presentation only: which
// organisations exist, how they are related and with which roles all comes from TypeDB.
// Two automatic layout engines are supported so they can be compared on the real data
// (scripts/compare-layouts.ts); the app uses ELK, chosen on the real data (docs/plan.md §9).
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import dagre from '@dagrejs/dagre'

export type Player = { role: string; code?: string | null; name?: string | null; type: string; kind: string }
export type Relation = { key: string; type: string; attributes: Record<string, unknown>; players: Player[] }
export type GraphNodeData = { code: string; name?: string | null; type: string; type_path: string[]; cluster: string; people: number }
export type GraphData = {
  nodes: GraphNodeData[]
  relations: Relation[]
  clusters: { key: string; label: string; order: number }[]
}

/** Which role a line starts and ends at, per relation type, so arrows read "adviser -> client".
 *  Reviews run applicant -> reviewer so the authorities sit beside the deal rather than stacking up
 *  with the advisers (they are drawn without arrowheads). A relation type without an entry is still
 *  drawn, between its first two organisations. */
export const EDGE_ROLES: Record<string, { from: string; to: string }> = {
  acquisition: { from: 'acquirer', to: 'target' },
  mandate: { from: 'adviser', to: 'client' },
  financing: { from: 'lender', to: 'borrower' },
  'authority-review': { from: 'applicant', to: 'reviewer' },
  ownership: { from: 'owner', to: 'owned' },
}
/** Relation types drawn without an arrowhead (no natural direction to show). */
export const UNDIRECTED = new Set(['authority-review', 'employment'])

export type LayoutEdge = { id: string; source: string; target: string; relation: Relation; context: Player[]; count?: number }
/** Anything the layout positions: an organisation, a person, or a collapsed group. */
export type LayoutNode = { code: string; cluster: string; width?: number; height?: number }
export type Box = { x: number; y: number; width: number; height: number }
export type Layout = { nodes: Record<string, Box>; clusters: Record<string, Box>; edges: LayoutEdge[]; width: number; height: number
  /** Edge routes computed by the engine (tree only): line points that go around the boxes. */
  routes?: Record<string, { x: number; y: number }[]> }

export const NODE_W = 216
export const NODE_H = 56

/** One line per relation between two organisations; every other player (the deal a mandate is for,
 *  the clearance a review concerns) travels with the edge as context, so nothing is dropped. */
export function graphEdges(data: GraphData, visible: Set<string>, mapCode: (code: string) => string = (c) => c): LayoutEdge[] {
  const out = new Map<string, LayoutEdge>()
  for (const r of data.relations) {
    const orgs = r.players.filter((p) => p.code && visible.has(p.code))
    if (orgs.length < 2) continue
    const spec = EDGE_ROLES[r.type]
    const from = (spec && orgs.find((p) => p.role === spec.from)) || orgs[0]
    const to = (spec && orgs.find((p) => p.role === spec.to)) || orgs.find((p) => p !== from)!
    const source = mapCode(from.code!), target = mapCode(to.code!)
    if (source === target) continue                   // both ends inside one collapsed group
    // Relations folded into a collapsed group are merged into one line per type, with a count.
    const id = source === from.code && target === to.code ? r.key : `${r.type}|${source}|${target}`
    const seen = out.get(id)
    if (seen) seen.count = (seen.count ?? 1) + 1
    else out.set(id, { id, source, target, relation: r, context: r.players.filter((p) => p !== from && p !== to) })
  }
  return [...out.values()]
}

const PAD = { top: 30, side: 12, bottom: 12 }

export async function layoutElk(nodes: LayoutNode[], edges: LayoutEdge[], clusterOrder: string[], direction: 'RIGHT' | 'DOWN' = 'RIGHT'): Promise<Layout> {
  const elk = new ELK()
  const byCluster = new Map<string, LayoutNode[]>()
  for (const n of nodes) byCluster.set(n.cluster, [...(byCluster.get(n.cluster) ?? []), n])
  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80', 'elk.spacing.nodeNode': '20',
      'elk.layered.spacing.edgeNodeBetweenLayers': '30', 'elk.spacing.componentComponent': '60',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: clusterOrder.filter((c) => byCluster.has(c)).map((c) => ({
      id: `cluster:${c}`,
      layoutOptions: { 'elk.padding': `[top=${PAD.top},left=${PAD.side},bottom=${PAD.bottom},right=${PAD.side}]`, 'elk.spacing.nodeNode': '10' },
      children: byCluster.get(c)!.map((n) => ({ id: n.code, width: n.width ?? NODE_W, height: n.height ?? NODE_H })),
    })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }
  const res = await elk.layout(root)
  const out: Layout = { nodes: {}, clusters: {}, edges, width: res.width ?? 0, height: res.height ?? 0 }
  for (const c of res.children ?? []) {
    out.clusters[c.id.slice(8)] = { x: c.x!, y: c.y!, width: c.width!, height: c.height! }
    for (const n of c.children ?? []) out.nodes[n.id] = { x: c.x! + n.x!, y: c.y! + n.y!, width: n.width!, height: n.height! }
  }
  return out
}

export function layoutDagre(nodes: LayoutNode[], edges: LayoutEdge[], clusterOrder: string[], rankdir: 'LR' | 'TB' = 'LR', compound = true): Layout {
  const g = new dagre.graphlib.Graph({ compound, multigraph: true })
  g.setGraph({ rankdir, nodesep: 22, ranksep: 90, marginx: 10, marginy: 10 })
  g.setDefaultEdgeLabel(() => ({}))
  if (compound) for (const c of clusterOrder) g.setNode(`cluster:${c}`, { paddingTop: PAD.top })
  for (const n of nodes) {
    g.setNode(n.code, { width: n.width ?? NODE_W, height: n.height ?? NODE_H })
    if (compound) g.setParent(n.code, `cluster:${n.cluster}`)
  }
  for (const e of edges) g.setEdge(e.source, e.target, {}, e.id)
  dagre.layout(g)
  const out: Layout = { nodes: {}, clusters: {}, edges, width: g.graph().width ?? 0, height: g.graph().height ?? 0 }
  for (const n of nodes) {
    const p = g.node(n.code)
    out.nodes[n.code] = { x: p.x - p.width / 2, y: p.y - p.height / 2, width: p.width, height: p.height }
  }
  // Cluster boxes drawn around their members (dagre's own cluster boxes don't leave room for a title).
  for (const c of clusterOrder) {
    const members = nodes.filter((n) => n.cluster === c).map((n) => out.nodes[n.code])
    if (!members.length) continue
    const x = Math.min(...members.map((b) => b.x)) - PAD.side
    const y = Math.min(...members.map((b) => b.y)) - PAD.top
    out.clusters[c] = { x, y, width: Math.max(...members.map((b) => b.x + b.width)) + PAD.side - x,
      height: Math.max(...members.map((b) => b.y + b.height)) + PAD.bottom - y }
  }
  return out
}

/** A plain layered layout with right-angled lines, no group boxes: the group structure (top-down)
 *  and the dependency chain (left to right). */
export async function layoutTree(nodes: LayoutNode[], edges: { id: string; source: string; target: string }[], direction: 'DOWN' | 'RIGHT' = 'DOWN'): Promise<Layout> {
  const elk = new ELK()
  const tree: ElkNode = {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.layered.spacing.nodeNodeBetweenLayers': direction === 'DOWN' ? '70' : '36',
      'elk.spacing.nodeNode': direction === 'DOWN' ? '36' : '22', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.edgeNodeBetweenLayers': direction === 'DOWN' ? '28' : '14', 'elk.spacing.edgeNode': '16', 'elk.spacing.edgeEdge': '10',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' },
    children: nodes.map((n) => ({ id: n.code, width: n.width ?? NODE_W, height: n.height ?? NODE_H })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }
  const res = await elk.layout(tree)
  const out: Layout = { nodes: {}, clusters: {}, edges: [], width: res.width ?? 0, height: res.height ?? 0 }
  for (const n of res.children ?? []) out.nodes[n.id] = { x: n.x!, y: n.y!, width: n.width!, height: n.height! }
  out.routes = {}
  for (const e of res.edges ?? []) {
    const sec = e.sections?.[0]
    if (sec) out.routes[e.id] = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
  }
  return out
}

// ---- measuring a layout (used to compare engines on the real data) ----

type Pt = { x: number; y: number }
const centre = (b: Box): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
function cross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

export function measure(l: Layout) {
  const segs = l.edges.filter((e) => l.nodes[e.source] && l.nodes[e.target]).map((e) => ({ e, a: centre(l.nodes[e.source]), b: centre(l.nodes[e.target]) }))
  let crossings = 0
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j]
    if ([s.e.source, s.e.target].some((x) => x === t.e.source || x === t.e.target)) continue
    if (cross(s.a, s.b, t.a, t.b)) crossings++
  }
  // Lines that pass straight through an unrelated organisation's box are the hardest to read.
  let throughNodes = 0
  for (const s of segs) for (const [code, box] of Object.entries(l.nodes)) {
    if (code === s.e.source || code === s.e.target) continue
    const steps = 20
    for (let k = 1; k < steps; k++) {
      const p = { x: s.a.x + ((s.b.x - s.a.x) * k) / steps, y: s.a.y + ((s.b.y - s.a.y) * k) / steps }
      if (p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height) { throughNodes++; break }
    }
  }
  const clusters = Object.values(l.clusters)
  let clusterOverlaps = 0
  for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) if (overlap(clusters[i], clusters[j])) clusterOverlaps++
  const length = segs.reduce((n, s) => n + Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y), 0)
  return { crossings, throughNodes, clusterOverlaps, width: Math.round(l.width), height: Math.round(l.height),
    aspect: +(l.width / Math.max(1, l.height)).toFixed(2), meanEdgeLength: Math.round(length / Math.max(1, segs.length)) }
}
