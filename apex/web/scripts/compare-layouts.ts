// Compare the layout engines on the real graph (docs/plan.md §9, decision A4).
// 1. Save the graph:  npm run export-graph-sample (in api/)   (writes web/.layout-sample.json, git-ignored)
// 2. Run:             scripts/npm-docker.sh node scripts/compare-layouts.ts
import { readFileSync } from 'node:fs'
import { graphEdges, layoutDagre, layoutElk, measure, type GraphData } from '../src/lib/graph-layout.ts'

const data: GraphData = JSON.parse(readFileSync(new URL('../.layout-sample.json', import.meta.url), 'utf8'))
const visible = new Set(data.nodes.map((n) => n.code))
const edges = graphEdges(data, visible)
const order = data.clusters.map((c) => c.key)
console.log(`${data.nodes.length} organisations, ${edges.length} relations between them\n`)

const rows: Record<string, ReturnType<typeof measure>> = {
  'ELK layered, clusters, left-to-right': measure(await layoutElk(data.nodes, edges, order, 'RIGHT')),
  'ELK layered, clusters, top-down': measure(await layoutElk(data.nodes, edges, order, 'DOWN')),
  'dagre, clusters, left-to-right': measure(layoutDagre(data.nodes, edges, order, 'LR', true)),
  'dagre, clusters, top-down': measure(layoutDagre(data.nodes, edges, order, 'TB', true)),
  'dagre, no clusters, left-to-right': measure(layoutDagre(data.nodes, edges, order, 'LR', false)),
}
console.table(rows)
