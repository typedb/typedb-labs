// The transaction network: organisations grouped by the part they play, joined by the typed
// relations TypeDB returns. People, and collapsed groups, are progressive disclosure.
import { useSearchParams } from 'react-router'
import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Maximize2, Network, RotateCcw, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useGraph, type Schemas } from '@/api/client'
import { PanelError } from '@/components/panel'
import { TypeQLDrawer } from '@/components/typeql'
import { UNDIRECTED, graphEdges, layoutDagre, layoutElk, type GraphData, type Layout, type LayoutEdge, type LayoutNode, type Relation } from '@/lib/graph-layout'
import { humanise } from '@/lib/format'
import { cn } from '@/lib/utils'
import { edgeTypes, nodeTypes } from './canvas'
import { PartyPanel, RelationPanel, setTypePaths } from './detail'
import { FAMILY_STYLE, familyOf, relationStyle } from './style'

type Selection = { kind: 'node'; code: string } | { kind: 'edge'; id: string; relation: Relation } | null
const PERSON = { width: 184, height: 44 }

function useExpandedPeople(codes: string[]) {
  // Each organisation's people come from its own /api/graph/node answer (employment relations).
  // `combine` gives a stable result between renders, so the layout only re-runs when data changes.
  return useQueries({
    queries: codes.map((code) => ({
      queryKey: ['party', code],
      queryFn: async () => (await fetch(`/api/graph/node/${encodeURIComponent(code)}`)).json() as Promise<Schemas['PartyResponse']>,
    })),
    combine: (results) => results.map((r) => r.data?.data).filter((d): d is Schemas['PartyDetail'] => Boolean(d)),
  })
}

function Legend({ data, hiddenTypes, toggle, hiddenFamilies, toggleFamily }: {
  data: Schemas['Graph']; hiddenTypes: Set<string>; toggle: (t: string) => void; hiddenFamilies: Set<string>; toggleFamily: (f: string) => void
}) {
  const counts = new Map<string, number>()
  for (const r of data.relations) counts.set(r.type, (counts.get(r.type) ?? 0) + 1)
  const families = Object.entries(data.types.parties).filter(([, parent]) => parent === 'organisation').map(([t]) => t)
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium text-muted-foreground">Relations</span>
        {Object.entries(data.types.relations).map(([t, info]) => {
          const tone = relationStyle(t)
          const off = hiddenTypes.has(t)
          return (
            <button key={t} type="button" onClick={() => toggle(t)} title={`${humanise(t)}: roles ${info.roles.map(humanise).join(', ')}`}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all', off ? 'bg-white text-muted-foreground opacity-60' : 'bg-white shadow-sm')}
              style={off ? undefined : { borderColor: tone.stroke + '55', color: tone.text }}>
              <svg width="18" height="6" aria-hidden><line x1="1" y1="3" x2="17" y2="3" stroke={off ? '#cbd5e1' : tone.stroke} strokeWidth="2.5" strokeDasharray={tone.dash} /></svg>
              {tone.label}<span className="text-muted-foreground tabular">{counts.get(t)}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-medium text-muted-foreground">Organisations</span>
        {families.map((f) => {
          const s = FAMILY_STYLE[f] ?? FAMILY_STYLE.company
          const off = hiddenFamilies.has(f)
          const n = data.nodes.filter((x) => familyOf(x.type_path) === f).length
          const kinds = Object.entries(data.types.parties).filter(([, p]) => p === f).map(([t]) => humanise(t))
          return (
            <button key={f} type="button" onClick={() => toggleFamily(f)} title={kinds.length ? `Includes: ${kinds.join(', ')}` : humanise(f)}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] transition-all hover:bg-muted', off ? 'text-muted-foreground line-through opacity-60' : 'text-foreground/80')}>
              <span className="size-2.5 rounded-full" style={{ background: off ? '#cbd5e1' : s.dot }} />{humanise(f)}<span className="text-muted-foreground tabular">{n}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Canvas({ data: all, selection, setSelection, collapsed, setCollapsed, people, hiddenTypes, hiddenFamilies }: {
  data: Schemas['Graph']; selection: Selection; setSelection: (s: Selection) => void
  collapsed: Set<string>; setCollapsed: (s: Set<string>) => void; people: Set<string>; hiddenTypes: Set<string>; hiddenFamilies: Set<string>
}) {
  // Organisation families switched off in the legend leave the picture, with their relations.
  const data = useMemo(() => ({ ...all, nodes: all.nodes.filter((n) => !hiddenFamilies.has(familyOf(n.type_path))) }), [all, hiddenFamilies])
  const { fitView } = useReactFlow()
  const [layout, setLayout] = useState<Layout>()
  const [hovered, setHovered] = useState<string>()
  const expanded = useExpandedPeople([...people].sort())
  const clusterOf = useMemo(() => Object.fromEntries(data.nodes.map((n) => [n.code, n.cluster])), [data])
  const clusterLabel = useMemo(() => Object.fromEntries(data.clusters.map((c) => [c.key, c.label])), [data])
  const order = data.clusters.map((c) => c.key)

  // What is on screen: organisations (or a collapsed group in their place), people of expanded
  // organisations, and one line per relation of a visible type.
  const model = useMemo(() => {
    const mapCode = (code: string) => (collapsed.has(clusterOf[code]) ? `group:${clusterOf[code]}` : code)
    const visible = new Set(data.nodes.map((n) => n.code))
    const graph = { ...data, relations: data.relations.filter((r) => !hiddenTypes.has(r.type)) } as unknown as GraphData
    const edges: LayoutEdge[] = graphEdges(graph, visible, mapCode)
    const layoutNodes: LayoutNode[] = []
    for (const n of data.nodes) if (!collapsed.has(n.cluster)) layoutNodes.push({ code: n.code, cluster: n.cluster })
    for (const c of collapsed) if (data.nodes.some((n) => n.cluster === c)) layoutNodes.push({ code: `group:${c}`, cluster: c })
    const persons: { code: string; name: string; title: string; employer: string }[] = []
    for (const d of expanded) {
      if (!clusterOf[d.code] || collapsed.has(clusterOf[d.code])) continue   // organisation hidden or folded away
      for (const r of d.relations.filter((x) => x.type === 'employment')) {
        const p = r.others[0]
        persons.push({ code: p.code!, name: p.name ?? p.code!, title: String(r.attributes['job-title'] ?? ''), employer: d.code })
        layoutNodes.push({ code: p.code!, cluster: clusterOf[d.code], ...PERSON })
        const rel: Relation = { key: r.key, type: 'employment', attributes: r.attributes,
          players: [{ role: 'employee', code: p.code, name: p.name, type: 'person', kind: 'entity' }, { role: 'employer', code: d.code, name: d.name, type: d.type, kind: 'entity' }] }
        edges.push({ id: r.key, source: d.code, target: p.code!, relation: rel, context: [] })
      }
    }
    return { edges, layoutNodes, persons }
  }, [data, collapsed, hiddenTypes, expanded, clusterOf])

  useEffect(() => {
    let live = true
    // ELK is the chosen engine; ?layout=dagre shows the alternative, for comparison on the real data.
    const engine = new URLSearchParams(window.location.search).get('layout') === 'dagre'
      ? Promise.resolve(layoutDagre(model.layoutNodes, model.edges, order, 'LR', true))
      : layoutElk(model.layoutNodes, model.edges, order, 'RIGHT')
    engine.then((l) => { if (live) setLayout(l) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])
  // Refit once React Flow has drawn the new positions (fitting earlier uses the old ones).
  // Fit only once React Flow has measured the boxes: fitting earlier divides by zero sizes.
  const measured = useNodesInitialized()
  useEffect(() => {
    if (layout && measured) fitView({ padding: 0.06 })
  }, [layout, measured, fitView])

  const focus = useMemo(() => {
    const id = selection?.kind === 'node' ? selection.code : selection?.kind === 'edge' ? selection.id : undefined
    if (!id) return null
    const nodes = new Set<string>(), edges = new Set<string>()
    if (selection!.kind === 'node') {
      nodes.add(id)
      for (const e of model.edges) if (e.source === id || e.target === id) { edges.add(e.id); nodes.add(e.source); nodes.add(e.target) }
    } else {
      const e = model.edges.find((x) => x.id === id)
      if (e) { edges.add(e.id); nodes.add(e.source); nodes.add(e.target) }
    }
    return { nodes, edges, centre: id }
  }, [selection, model.edges])

  if (!layout) return <Skeleton className="h-full w-full" />
  const byCode = Object.fromEntries(data.nodes.map((n) => [n.code, n]))
  const personBy = Object.fromEntries(model.persons.map((p) => [p.code, p]))
  const stateOf = (code: string) => !focus ? 'normal' : code === focus.centre ? 'selected' : focus.nodes.has(code) ? 'neighbour' : 'dim'

  const nodes: Node[] = []
  for (const [key, box] of Object.entries(layout.clusters)) {
    const count = data.nodes.filter((n) => n.cluster === key).length
    if (collapsed.has(key)) continue
    nodes.push({ id: `cluster:${key}`, type: 'cluster', position: { x: box.x, y: box.y }, style: { width: box.width, height: box.height },
      data: { label: clusterLabel[key], count, onCollapse: () => setCollapsed(new Set([...collapsed, key])) }, selectable: false, draggable: false, zIndex: -1 })
  }
  for (const [code, box] of Object.entries(layout.nodes)) {
    const pos = { x: box.x, y: box.y }
    const style = { width: box.width, height: box.height }
    if (code.startsWith('group:')) {
      const key = code.slice(6)
      nodes.push({ id: code, type: 'summary', position: pos, style, data: { label: clusterLabel[key], count: data.nodes.filter((n) => n.cluster === key).length, state: stateOf(code) } })
    } else if (personBy[code]) {
      const p = personBy[code]
      nodes.push({ id: code, type: 'person', position: pos, style, data: { name: p.name, title: p.title, state: stateOf(code) } })
    } else {
      const n = byCode[code]
      if (!n) continue   // just hidden by a filter: the previous layout is shown until the new one is ready
      nodes.push({ id: code, type: 'org', position: pos, style,
        data: { name: n.name ?? code, subtitle: `${humanise(n.type)} · ${n.jurisdiction ?? ''}`, family: familyOf(n.type_path), people: n.people,
                peopleShown: people.has(code), state: stateOf(code) } })
    }
  }
  const edges: Edge[] = model.edges.map((e) => {
    const tone = relationStyle(e.relation.type)
    const state = !focus ? 'normal' : focus.edges.has(e.id) ? 'highlight' : 'dim'
    const always = e.relation.type === 'acquisition' || e.relation.type === 'ownership'
    return {
      id: e.id, source: e.source, target: e.target, type: 'relation', zIndex: state === 'highlight' ? 5 : 1,
      markerEnd: UNDIRECTED.has(e.relation.type) ? undefined : { type: MarkerType.ArrowClosed, color: tone.stroke, width: 16, height: 16 },
      data: { relation: e.relation, context: e.context, count: e.count, state,
              showLabel: e.relation.type !== 'employment' && (always || state === 'highlight' || hovered === e.id) },
    }
  })

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable minZoom={0.2} maxZoom={1.6} fitView
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => {
        if (n.type === 'cluster') return
        if (n.type === 'summary') { const s = new Set(collapsed); s.delete(n.id.slice(6)); setCollapsed(s); return }
        setSelection(selection?.kind === 'node' && selection.code === n.id ? null : { kind: 'node', code: n.id })
      }}
      onEdgeClick={(_, e) => setSelection({ kind: 'edge', id: e.id, relation: (e.data as { relation: Relation }).relation })}
      onEdgeMouseEnter={(_, e) => setHovered(e.id)} onEdgeMouseLeave={() => setHovered(undefined)}
      onPaneClick={() => setSelection(null)}>
      <Background gap={22} size={1} color="#e2e8f0" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  )
}

/** Relationship Explorer: network view with legend, detail panel and "Show TypeQL". */
// The first view keeps the target's group folded into one box: it has its own view (Group structure),
// and leaving it out makes every other organisation readable without zooming.
const START_COLLAPSED = ['target-group', 'outside-shareholders']

export function NetworkView() {
  const q = useGraph()
  // ?focus=CODE (from a Parties profile or elsewhere) opens with that party selected.
  const [params] = useSearchParams()
  const [selection, setSelection] = useState<Selection>(() => {
    const focus = params.get('focus')
    return focus ? { kind: 'node', code: focus } : null
  })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(START_COLLAPSED))
  const [people, setPeople] = useState<Set<string>>(new Set())
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [hiddenFamilies, setHiddenFamilies] = useState<Set<string>>(new Set())
  useEffect(() => { if (q.data) setTypePaths(q.data.data.types.parties) }, [q.data])

  if (q.isPending) return <Skeleton className="h-[640px] w-full rounded-xl" />
  if (q.isError) return <PanelError message={q.error.message} />
  const data = q.data.data
  const relation = selection?.kind === 'edge' ? selection.relation : undefined
  const togglePeople = (code: string) => { const s = new Set(people); if (s.has(code)) s.delete(code); else s.add(code); setPeople(s) }
  const select = (code: string) => setSelection({ kind: 'node', code })
  const collapsible = data.clusters.filter((c) => data.nodes.filter((n) => n.cluster === c.key).length > 1)

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]">
      <div className="flex flex-col gap-3 border-b px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Network className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Transaction network</h2>
            <p className="text-[13px] text-muted-foreground">{data.nodes.length} organisations and the {data.relations.length} typed relations between them. Select one to inspect it.</p>
          </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(collapsible.map((c) => c.key)))}
              className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-muted">
              <Maximize2 className="size-3.5" />{collapsed.size ? 'Expand all groups' : 'Collapse all groups'}
            </button>
            <button type="button" onClick={() => { setCollapsed(new Set(START_COLLAPSED)); setPeople(new Set()); setHiddenTypes(new Set()); setHiddenFamilies(new Set()); setSelection(null) }}
              className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-muted">
              <RotateCcw className="size-3.5" />Reset
            </button>
          </div>
        </div>
        <Legend data={data} hiddenTypes={hiddenTypes} toggle={(t) => { const s = new Set(hiddenTypes); if (s.has(t)) s.delete(t); else s.add(t); setHiddenTypes(s) }}
          hiddenFamilies={hiddenFamilies} toggleFamily={(f) => { const s = new Set(hiddenFamilies); if (s.has(f)) s.delete(f); else s.add(f); setHiddenFamilies(s) }} />
      </div>
      <div className="flex flex-col lg:flex-row">
        <div className="relative h-[460px] w-full min-w-0 bg-[#fbfcfd] sm:h-[560px] lg:h-[720px] lg:w-auto lg:flex-1">
          <ReactFlowProvider>
            <Canvas data={data} selection={selection} setSelection={setSelection} collapsed={collapsed} setCollapsed={setCollapsed}
              people={people} hiddenTypes={hiddenTypes} hiddenFamilies={hiddenFamilies} />
          </ReactFlowProvider>
          {people.size > 0 && (
            <div className="pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white">
              <Users className="size-3" />Showing people for {people.size} {people.size === 1 ? 'organisation' : 'organisations'}
            </div>
          )}
        </div>
        <aside className="min-w-0 border-t bg-white lg:w-[360px] lg:border-t-0 lg:border-l">
          <div className="lg:h-[720px]">
            {selection?.kind === 'node' && (
              <PartyPanel key={selection.code} code={selection.code} onSelect={select} onClose={() => setSelection(null)}
                peopleShown={people.has(selection.code)}
                onTogglePeople={data.nodes.some((n) => n.code === selection.code) ? () => togglePeople(selection.code) : undefined} />
            )}
            {selection?.kind === 'edge' && relation && (
              <RelationPanel relation={relation} roles={data.types.relations[relation.type]?.roles} onSelect={select} onClose={() => setSelection(null)} />
            )}
            {!selection && <Guide data={data} />}
          </div>
        </aside>
      </div>
      <TypeQLDrawer envelope={q.data} note="Organisations and every relation linking them, with role names; the legend and filters come from the schema's type hierarchy, and the target's group is found with a recursive function." />
    </Card>
  )
}

function Guide({ data }: { data: Schemas['Graph'] }) {
  const counts = new Map<string, number>()
  for (const r of data.relations) counts.set(r.type, (counts.get(r.type) ?? 0) + 1)
  return (
    <div className="space-y-5 p-5">
      <div>
        <h3 className="text-[14px] font-semibold text-ink">How to read this</h3>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-foreground/80">
          <li>• Every box is an organisation and every line a relation stored in TypeDB, with its type and roles.</li>
          <li>• Select an organisation to see its roles, its people and their responsibilities.</li>
          <li>• Select a line to see the whole relation: a mandate links adviser, client <em>and</em> the deal; a review links authority, clearance and applicant.</li>
          <li>• Collapse groups or switch relation types off to simplify the picture.</li>
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Relation types in this deal</h3>
        <ul className="space-y-2">
          {Object.entries(data.types.relations).map(([t, info]) => {
            const tone = relationStyle(t)
            return (
              <li key={t} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between text-[12.5px] font-semibold" style={{ color: tone.text }}>
                  <span>{humanise(t)}</span><span className="text-muted-foreground tabular">{counts.get(t)}</span>
                </div>
                <div className="text-[11.5px] text-muted-foreground">Roles: {info.roles.map(humanise).join(' · ')}{info.parent ? ` · a kind of ${info.parent}` : ''}</div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
