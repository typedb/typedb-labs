import { useState } from 'react'
import { ArrowUpRight, Grid3x3, ListChecks } from 'lucide-react'
import { Link } from 'react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useProgress, useRaci, type Schemas } from '@/api/client'
import { Panel } from '@/components/panel'
import { RowChevron, rowClass } from '@/components/row'
import { STATUS_ORDER, STATUS_STYLE, StatusBadge, StatusDot, ProgressBar } from '@/components/status'
import { formatDate, humanise, initials } from '@/lib/format'
import { cn } from '@/lib/utils'

function StatusStack({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
        <div key={s} className={STATUS_STYLE[s].bar} style={{ width: `${(counts[s] / total) * 100}%` }} title={`${counts[s]} ${humanise(s).toLowerCase()}`} />
      ))}
    </div>
  )
}

/** Progress by workstream (each workstream's own record, plus its items' statuses). */
export function WorkstreamProgress({ className, selected, onSelect }: { className?: string; selected?: string; onSelect: (code: string) => void }) {
  const q = useProgress()
  return (
    <Panel title="Workstream progress" icon={<ListChecks />} className={className} query={q} skeletonRows={7}
      note="Counts each workstream's items by status inside TypeDB and reads every item's dates and progress; activity progress is then weighted by planned duration in Python."
      subtitle="Activity progress is weighted by planned duration; milestones are counted separately. Select a workstream for its responsibility matrix below, or open it."
      action={<Link to="/workstreams" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">All workstreams<ArrowUpRight className="size-3.5" aria-hidden /></Link>}>
      {({ data }) => (
        <ul className="-mx-2 space-y-0.5">
          {data.map((w) => {
            const items = Object.values(w.item_statuses).reduce((a, b) => a + b, 0)
            return (
              <li key={w.code} className="flex items-stretch gap-1">
                <button type="button" onClick={() => onSelect(w.code)} aria-pressed={selected === w.code}
                  aria-label={`${w.name}: show its responsibility matrix`}
                  className={rowClass(selected === w.code, 'min-w-0 flex-1 px-2 py-2.5')}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-ink" title={w.name ?? undefined}>{w.name}</span>
                        <StatusBadge status={w.status} className="hidden sm:inline-flex" />
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{w.accountable?.name} · due {formatDate(w.due)} · {items} items · {w.milestones_achieved} of {w.milestones_total} milestones achieved</div>
                    </div>
                    <div className="w-10 text-right text-[13px] font-semibold text-ink tabular" title={w.progress_basis}>{w.progress ?? 0}%</div>
                    <RowChevron selected={selected === w.code} />
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3 pr-7">
                    <ProgressBar value={w.progress ?? 0} status={w.status} />
                    <div className="w-24"><StatusStack counts={w.item_statuses} /></div>
                  </div>
                </button>
                <Link to={`/workstreams/${w.code}`} title={`Open the ${w.name} workstream`} aria-label={`Open the ${w.name} workstream`}
                  className="flex w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-brand focus-visible:outline-2 focus-visible:outline-brand">
                  <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

const LETTER: Record<string, { cls: string; word: string }> = {
  A: { cls: 'bg-ink text-white', word: 'Accountable' },
  R: { cls: 'bg-brand text-white', word: 'Responsible' },
  C: { cls: 'bg-info-soft text-info ring-1 ring-inset ring-info/25', word: 'Consulted' },
  I: { cls: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border', word: 'Informed' },
}

function CellChip({ cell, holder }: { cell: Schemas['Cell']; holder: Schemas['Holder'] }) {
  const style = LETTER[cell.letter]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex size-7 cursor-default items-center justify-center rounded-md text-[12px] font-semibold', style.cls)}>{cell.letter}</span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-medium">{holder.name}: {style.word}</div>
        {cell.via && <div className="opacity-80">Acting under mandate {cell.via}</div>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Compact RACI matrix for one workstream. Each letter is a relation type in TypeDB. */
export function RaciMatrix({ className, workstream, onSelect }: { className?: string; workstream?: string; onSelect?: (item: string) => void }) {
  const q = useRaci(workstream)
  return (
    <Panel title="Responsibility matrix (RACI)" icon={<Grid3x3 />} className={className} query={q} skeletonRows={5}
      note="Each letter is its own relation type under raci-assignment: one pattern on the parent type finds all four, with each holder's exact type."
      subtitle={q.data ? `${q.data.data.workstream.name}: who is Responsible, Accountable, Consulted and Informed` : 'Who is Responsible, Accountable, Consulted and Informed'}>
      {({ data }) => {
        const cell = new Map(data.cells.map((c) => [`${c.item}|${c.holder}`, c]))
        return (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 z-10 min-w-64 bg-muted/50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Item</th>
                    {data.holders.map((h) => (
                      <th key={h.code} className="min-w-[70px] px-1 py-2 text-center align-bottom">
                        <div className="mx-auto flex size-7 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-ink ring-1 ring-border">{initials(h.name)}</div>
                        <Link to={`/parties/${h.code}`} className="mt-1 block text-[11px] leading-tight font-medium text-ink hover:text-brand hover:underline">{h.name}</Link>
                        <div className="text-[10px] leading-tight font-normal text-muted-foreground">{h.employer ?? humanise(h.type)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.code} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="sticky left-0 z-10 bg-card px-3 py-2">
                        {onSelect ? (
                          <button type="button" onClick={() => onSelect(i.code)} className={rowClass(false, 'flex w-full items-start gap-2 px-1 py-0.5')}
                            aria-label={`${i.name}: open details`}>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2"><StatusDot status={i.status} /><span className="text-[12.5px] font-medium text-ink">{i.name}</span></span>
                              <span className="block pl-4 text-[11px] text-muted-foreground">{humanise(i.type)} · {formatDate(i.due)}</span>
                            </span>
                            <RowChevron className="mt-0.5" />
                          </button>
                        ) : <>
                          <div className="flex items-center gap-2"><StatusDot status={i.status} /><span className="text-[12.5px] font-medium text-ink">{i.name}</span></div>
                          <div className="pl-4 text-[11px] text-muted-foreground">{humanise(i.type)} · {formatDate(i.due)}</div>
                        </>}
                      </td>
                      {data.holders.map((h) => {
                        const c = cell.get(`${i.code}|${h.code}`)
                        return <td key={h.code} className="px-1.5 py-2 text-center">{c ? <CellChip cell={c} holder={h} /> : <span className="text-border">·</span>}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
              {Object.entries(LETTER).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className={cn('inline-flex size-4 items-center justify-center rounded text-[9px] font-semibold', v.cls)}>{k}</span>{v.word}</span>
              ))}
            </div>
          </div>
        )
      }}
    </Panel>
  )
}

/** Which workstream the RACI matrix shows: the one chosen, else the first at-risk one, else the first. */
export function useWorkstreamChoice() {
  const progress = useProgress()
  const [chosen, setChosen] = useState<string>()
  const ws = progress.data?.data
  const selected = chosen ?? ws?.find((w) => w.status === 'at-risk' || w.status === 'delayed')?.code ?? ws?.[0]?.code
  return { selected, choose: setChosen, error: progress.isError ? progress.error.message : undefined }
}

