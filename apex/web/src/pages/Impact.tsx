import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { FlaskConical, GitBranch, ListTree, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useImpact } from '@/api/client'
import { PanelError } from '@/components/panel'
import { PageHeader, Segmented } from '@/components/page'
import { TypeQLDrawer } from '@/components/typeql'
import { ScrollArea } from '@/components/scroll-area'
import { DeadlineCards, EscalationBanner, ScenarioControl } from '@/components/impact/control'
import { DependencyGraph, GraphLegend } from '@/components/impact/graph'
import { ItemPanel, PeopleSummary } from '@/components/impact/people'
import { BeforeAfter } from '@/components/impact/timeline'
import { cn } from '@/lib/utils'

// Wait this long after the slider stops moving before asking the API (keeps dragging smooth).
const SLIDER_PAUSE_MS = 100

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

function Section({ icon: Icon, title, subtitle, children, className, action }: {
  icon: typeof Users; title: string; subtitle?: string; children: React.ReactNode; className?: string; action?: React.ReactNode
}) {
  return (
    <Card className={cn('min-w-0 gap-0 overflow-hidden py-0 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]', className)}>
      <div className="flex flex-col gap-2 px-5 pt-4 pb-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="size-4" /></div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

/** Impact Explorer: delay one approval and see what it sets off. Read-only: every date is projected. */
export function Impact() {
  const [params, setParams] = useSearchParams()
  const item = params.get('item') ?? undefined
  const [delay, setDelay] = useState(() => Number(params.get('days') ?? 0) || 0)
  const asked = useDebounced(delay, SLIDER_PAUSE_MS)
  const [selected, setSelected] = useState<string>()
  const [showSoft, setShowSoft] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const q = useImpact(item, asked)
  // Follow the address too (Back/Forward, or an edited ?days=), not only the slider.
  const fromUrl = Number(params.get('days') ?? 0) || 0
  useEffect(() => { if (fromUrl !== asked) setDelay(fromUrl) }, [fromUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fromUrl === asked) return
    const next = new URLSearchParams(params)
    if (asked) next.set('days', String(asked)); else next.delete('days')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked])

  if (q.isPending) return <div className="space-y-5"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
  if (q.isError) return <PanelError message={q.error.message} />
  const data = q.data.data
  const max = Math.max(...data.scenarios.map((s) => s.days), 1)
  const focus = selected ?? data.start.code

  return (
    <div className={cn('space-y-5 transition-opacity', q.isPlaceholderData && 'opacity-90')}>
      <PageHeader title="Impact Explorer"
        description="Delay one approval and follow the consequences through the deal's dependencies, deadlines and people."
        note={<span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-medium text-violet-700 ring-1 ring-violet-200">
          <FlaskConical className="size-3.5" />Projection only: nothing is written to TypeDB</span>}
        actions={data.subjects.length > 1 && (
          <Segmented label="Approval to delay" value={data.start.code}
            options={data.subjects.map((s) => ({ key: s.code, label: s.name ?? s.code }))}
            onChange={(code) => { setSelected(undefined); setParams(code === data.subjects[0].code ? {} : { item: code }); setDelay(0) }} />
        )} />

      <ScenarioControl data={data} delay={delay} setDelay={setDelay} max={max} />
      <EscalationBanner data={data} />

      <div>
        <h2 className="mb-3 text-[13px] font-semibold tracking-tight text-ink">Contractual deadlines in reach of this delay</h2>
        <DeadlineCards data={data} />
      </div>

      <Section icon={GitBranch} title="Dependency chain" subtitle={showAll ? "Every item the delay reaches, read from the dependency relations in TypeDB. Select any item." : "Every route from the delayed approval to the items a contractual deadline limits. Select any item."}
        action={
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-3.5 accent-[#0f2a44]" />
              Show all affected items ({data.items.length})
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={showSoft} onChange={(e) => setShowSoft(e.target.checked)} className="size-3.5 accent-[#0f2a44]" />
              Show soft dependencies ({data.context.length})
            </label>
          </div>
        }>
        <div className="px-5 pb-3"><GraphLegend data={data} /></div>
        <div className="flex flex-col border-t lg:flex-row">
          <div className={cn('relative w-full min-w-0 bg-[#fbfcfd] lg:w-auto lg:flex-1', showAll || showSoft ? 'h-[440px] sm:h-[500px] lg:h-[560px]' : 'h-[340px] sm:h-[380px] lg:h-[460px]')}>
            <DependencyGraph data={data} showSoft={showSoft} showAll={showAll} selected={selected} onSelect={setSelected} />
          </div>
          <aside className={cn('flex min-w-0 flex-col border-t bg-white lg:w-[360px] lg:border-t-0 lg:border-l', showAll || showSoft ? 'lg:max-h-[560px]' : 'lg:max-h-[460px]')}>
            <ScrollArea label="Selected item" className="lg:flex-1" more="Scroll for more about this item" done="End of the details">
              <ItemPanel data={data} code={focus} onSelect={setSelected} onClose={() => setSelected(undefined)} />
            </ScrollArea>
          </aside>
        </div>
        <TypeQLDrawer envelope={q.data} functions={data.functions}
          note="A recursive function follows every hard dependency from the delayed approval, to any depth; projected dates are then calculated in Python, and nothing is written." />
      </Section>

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <Section icon={ListTree} title="Before and after" subtitle="Planned dates as recorded, against this scenario's projected dates" className="xl:col-span-7">
          <div className="px-3 pb-4"><BeforeAfter data={data} onSelect={setSelected} selected={selected} /></div>
        </Section>
        <Section icon={Users} title="Who needs to act" subtitle="Everyone with a RACI letter on an affected item or deadline" className="xl:col-span-5">
          <div className="px-5 pb-4"><PeopleSummary data={data} onSelect={setSelected} /></div>
          <TypeQLDrawer envelope={q.data} note="The same recursion finds everything the delay reaches and the deadlines that limit it, then everyone holding a RACI letter on them." />
        </Section>
      </div>
    </div>
  )
}

