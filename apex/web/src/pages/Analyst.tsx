import { Link, useSearchParams } from 'react-router'
import { ArrowUpRight, Bot, Database, Lightbulb } from 'lucide-react'
import { useInvestigation, type Schemas } from '@/api/client'
import { PageHeader, Segmented } from '@/components/page'
import { PanelError } from '@/components/panel'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pickQueries, TypeQLDrawer } from '@/components/typeql'
import { formatDate, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

const KEYS = ['closing-risks', 'who-acts', 'regulatory-delay']

/** AI Analyst: a concept preview. Three predefined investigations; executed steps run against TypeDB now,
 *  hypothetical steps are written in advance. No AI model, chatbot or free-text query. */
export function Analyst() {
  const [params, setParams] = useSearchParams()
  const key = KEYS.includes(params.get('i') ?? '') ? params.get('i')! : KEYS[0]
  const q = useInvestigation(key)
  const data = q.data?.data
  return (
    <div className="space-y-5">
      <PageHeader title="AI Analyst"
        description="How an AI analyst could investigate this deal using TypeDB as its source of facts."
        note={<span className="inline-flex items-center gap-1.5 rounded-full bg-typedb-tint px-2.5 py-1 text-[12px] font-semibold text-typedb ring-1 ring-typedb-line"><Bot className="size-3.5" aria-hidden />Concept preview</span>}
        actions={data && <Segmented label="Investigation" value={key} onChange={(k) => setParams(k === KEYS[0] ? {} : { i: k }, { replace: true })}
          options={data.investigations.map((i) => ({ key: i.key, label: i.title }))} />} />

      <div className="rounded-xl border border-typedb-line bg-typedb-tint px-5 py-3.5 text-[13px] leading-relaxed text-ink-soft">
        <span className="font-semibold text-typedb">No AI model runs here.</span> Each investigation is a fixed sequence of steps. Steps marked{' '}
        <span className="font-medium text-ink">Executed against TypeDB</span> ran just now, in a read-only transaction, and their queries are shown.
        The step marked <span className="font-medium text-ink">Hypothetical agent step</span> describes what an AI agent could do next; its text was
        written in advance and filled from the executed results. There is no chat, no free-text question and no external service.
      </div>

      {q.isPending ? <Skeleton className="h-96 w-full rounded-xl" /> : q.isError ? <PanelError message={q.error.message} /> : data && (
        <Card className={cn('gap-0 overflow-hidden py-0 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          <div className="border-b px-6 py-4">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">{data.title}</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{data.question} Facts as of the scenario date, {formatDate(data.as_of)}.</p>
          </div>
          <ol className="space-y-4 px-6 py-5">
            {data.steps.map((s, n) => <StepView key={s.title} s={s} n={n + 1} envelope={q.data} />)}
          </ol>
        </Card>
      )}
    </div>
  )
}

function StepView({ s, n, envelope }: { s: Schemas['InvestigationStep']; n: number; envelope: Schemas['InvestigationResponse'] }) {
  const executed = s.kind === 'executed'
  return (
    <li className={cn('overflow-hidden rounded-xl border', executed ? 'border-typedb-line bg-white' : 'border-dashed border-border bg-muted/30')}>
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('flex size-6 items-center justify-center rounded-full text-[12px] font-semibold', executed ? 'bg-typedb text-white' : 'bg-muted text-muted-foreground')}>{n}</span>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset',
            executed ? 'bg-typedb-tint text-typedb ring-typedb-line' : 'bg-white text-muted-foreground ring-border')}>
            {executed ? <Database className="size-3.5" aria-hidden /> : <Lightbulb className="size-3.5" aria-hidden />}
            {executed ? `Executed against TypeDB${s.queries.length ? ` · ${plural(s.queries.length, 'query', 'queries')}` : ' · uses earlier records'}` : 'Hypothetical agent step · not run'}
          </span>
          <h3 className="text-[14px] font-semibold text-ink">{s.title}</h3>
        </div>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{s.how}</p>
        <ul className="mt-2.5 space-y-1.5">
          {s.findings.map((f, i) => (
            <li key={i} className="text-[13px] leading-snug">
              <span className={executed ? 'text-ink' : 'text-ink-soft italic'}>{f.text}</span>
              {f.links.length > 0 && (
                <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                  {f.links.map((l) => (
                    <Link key={l.to + l.label} to={l.to} className="inline-flex items-center gap-0.5 rounded border bg-white px-1.5 py-px text-[11.5px] font-medium text-brand hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand">
                      {l.label}<ArrowUpRight className="size-3" aria-hidden />
                    </Link>
                  ))}
                </span>
              )}
            </li>
          ))}
          {!s.findings.length && <li className="text-[13px] text-muted-foreground">Nothing found.</li>}
        </ul>
      </div>
      {executed && s.queries.length > 0 && <TypeQLDrawer envelope={pickQueries(envelope, s.queries)} note="The queries this step ran, in the investigation's READ transaction." />}
    </li>
  )
}
