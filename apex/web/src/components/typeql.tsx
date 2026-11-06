import { useState } from 'react'
import { Check, ChevronDown, Code2, Copy, Database, Timer } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { Envelope } from '@/api/client'
import { ScrollArea } from '@/components/scroll-area'
import { cn } from '@/lib/utils'

const KEYWORDS = new Set(['fun', 'match', 'fetch', 'reduce', 'sort', 'limit', 'select', 'distinct', 'let', 'in', 'isa',
  'isa!', 'has', 'links', 'not', 'or', 'groupby', 'count', 'sum', 'mean', 'asc', 'desc', 'is', 'like', 'return', 'first'])
const TOKEN = /("(?:[^"\\]|\\.)*")|(#[^\n]*)|(\$[\w-]+)|(\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:\.\d+)?(?:dec)?\b)|([A-Za-z][\w-]*!?)|([\s\S])/g

/** Minimal TypeQL syntax colouring: strings, comments, variables, keywords. */
function Highlighted({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let m: RegExpExecArray | null
  let i = 0
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(text))) {
    const [all, str, comment, variable, num, word] = m
    const cls = str ? 'text-amber-200' : comment ? 'text-slate-500 italic' : variable ? 'text-sky-300'
      : num ? 'text-violet-300' : word && KEYWORDS.has(word) ? 'text-teal-300 font-semibold' : word ? 'text-slate-100' : 'text-slate-400'
    parts.push(<span key={i++} className={cls}>{all}</span>)
  }
  return <>{parts}</>
}

function formatParameters(parameters: Envelope['parameters']): string {
  return Object.entries(parameters ?? {}).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')
}

/** What each capability label means (the labels themselves are detected by the API from the queries that ran). */
const CAPABILITY_HINT: Record<string, string> = {
  'Recursive functions': 'Calls a function saved in the schema that calls itself, to follow chains to any depth',
  'N-ary relationships': 'One relation with three or more role players, kept as a single fact',
  Polymorphism: 'Matches a parent type, so one pattern finds every kind beneath it',
  Negation: 'Looks for what is not there, with not { ... }',
  Aggregation: 'Counts or sums inside the database, with reduce',
  'Typed relationships': 'Relations with named roles, such as reviewer, subject and applicant',
  'Nested queries': 'A fetch with subqueries, returning a nested answer in one round trip',
}

/** "Show TypeQL": the exact queries the API ran for this panel, as recorded while they ran.
 *  Line 1: query count and the TypeDB capabilities those queries use; line 2: what they retrieve. */
export type FunctionDef = { name: string; definition: string }

export function TypeQLDrawer({ envelope, className, functions, label, note, select }: {
  envelope: Envelope; className?: string; functions?: FunctionDef[]; label?: string; note?: string
  /** Show only the queries behind one section of a page (its labels then come from those queries alone). */
  select?: (query: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const picked = envelope.typeql.map((q, n) => ({ q, n })).filter(({ q }) => !select || select(q))
  const queries = picked.map(({ q }) => q)
  const used = new Set(picked.flatMap(({ n }) => envelope.query_capabilities?.[n] ?? []))
  const capabilities = select ? (envelope.capabilities ?? []).filter((c) => used.has(c)) : (envelope.capabilities ?? [])
  const all = queries.join('\n\n')
  const params = formatParameters(envelope.parameters)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(all)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable: ignore */ }
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('border-t border-typedb-line bg-typedb-tint', className)}>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-start gap-2 px-6 py-2.5 text-left text-xs text-ink-soft transition-colors hover:bg-[#ede6f8] focus-visible:bg-[#ede6f8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-typedb">
        <Code2 className="mt-px size-3.5 shrink-0 text-typedb" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block leading-[18px]">
            <span className="font-semibold text-typedb">{open ? `Hide ${label ?? 'TypeQL'}` : `Show ${label ?? 'TypeQL'}`}</span>
            <span className="text-muted-foreground"> · {queries.length} {queries.length === 1 ? 'query' : 'queries'}</span>
            {capabilities.map((c) => (
              <span key={c}><span className="text-muted-foreground/50"> · </span><span className="font-medium whitespace-nowrap text-typedb" title={CAPABILITY_HINT[c]}>{c}</span></span>
            ))}
          </span>
          {note && <span className="mt-0.5 block text-[11.5px] leading-snug font-normal text-ink-soft">{note}</span>}
        </span>
        <ChevronDown className="mt-px size-3.5 shrink-0 text-typedb transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-typedb-line bg-card px-4 pt-3 pb-4">
        <div className="overflow-hidden rounded-lg bg-[#0d1b2a] ring-1 ring-black/10">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 px-4 py-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><Database className="size-3" />{envelope.database} · READ transaction</span>
            <span className="inline-flex items-center gap-1.5"><Timer className="size-3" />{envelope.elapsed_ms} ms</span>
            {params && <span className="font-mono text-slate-300">{params}</span>}
            {select && <span>{queries.length} of the {envelope.typeql.length} queries this page ran</span>}
            <button type="button" onClick={copy} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-300 hover:bg-white/10">
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {functions && functions.length > 0 && (
            <div className="border-b border-white/10 bg-white/[0.03]">
              <div className="px-4 pt-2.5 text-[10px] font-semibold tracking-wider text-teal-300/80 uppercase">
                Recursive functions used (saved in the schema, schema/functions.tql)
              </div>
              {functions.map((f) => (
                <pre key={f.name} className="px-4 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre"><Highlighted text={f.definition} /></pre>
              ))}
            </div>
          )}
          <ScrollArea label="Executed TypeQL queries" dark className="max-h-96" innerClassName="overflow-x-auto" more="Scroll for more queries" done="End of the queries">
            {picked.map(({ q, n }) => (
              <div key={n} className="border-b border-white/5 last:border-0">
                {envelope.typeql.length > 1 && (
                  <div className="px-4 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Query {n + 1}</div>
                )}
                <pre className="px-4 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre"><Highlighted text={q} /></pre>
              </div>
            ))}
          </ScrollArea>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The part of an answer's envelope behind some of its queries (by index), with their capabilities only. */
export function pickQueries(envelope: Envelope, indices: number[]): Envelope {
  const caps = new Set(indices.flatMap((i) => envelope.query_capabilities?.[i] ?? []))
  return { ...envelope, typeql: indices.map((i) => envelope.typeql[i]), query_capabilities: indices.map((i) => envelope.query_capabilities?.[i] ?? []),
    capabilities: (envelope.capabilities ?? []).filter((c) => caps.has(c)) }
}
