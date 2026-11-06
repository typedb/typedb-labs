import { Link } from 'react-router'
import { ArrowUpRight, Clock, Quote, Sparkles } from 'lucide-react'
import { useGuide } from '@/api/client'
import { PageHeader } from '@/components/page'
import { PanelError } from '@/components/panel'
import { Skeleton } from '@/components/ui/skeleton'

/** The guided demonstration: eight steps, about six minutes, each opening an exact view. Content from /api/guide. */
export function Guide() {
  const q = useGuide()
  return (
    <div className="space-y-5">
      <PageHeader title="Guided demonstration"
        description="Eight steps, about six minutes: ownership and connections, a regulatory delay, responsibilities and engagement, and what TypeDB is doing underneath. Suitable for a live walkthrough or a short recording." />
      {q.isPending ? <Skeleton className="h-96 w-full rounded-xl" /> : q.isError ? <PanelError message={q.error.message} /> : (
        <>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted-foreground">{q.data.data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <ol className="space-y-3">
            {q.data.data.steps.map((s) => (
              <li key={s.n} className="rounded-xl border bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-white">{s.n}</span>
                  <h2 className="text-[15px] font-semibold tracking-tight text-ink">{s.title}</h2>
                  <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground tabular"><Clock className="size-3.5" aria-hidden />{s.time}</span>
                  <Link to={s.to} className="ml-auto inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                    Open this view<ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
                <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div>
                    <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">Show</div>
                    <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-soft">{s.show.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                  <div>
                    <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">Say</div>
                    <p className="flex gap-2 text-[13px] leading-relaxed text-ink"><Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />{s.say}</p>
                  </div>
                </div>
                <p className="mt-3 flex gap-2 rounded-lg border border-typedb-line bg-typedb-tint px-3 py-2 text-[12.5px] text-ink-soft">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-typedb" aria-hidden /><span><span className="font-semibold text-typedb">TypeDB: </span>{s.typedb}</span>
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
