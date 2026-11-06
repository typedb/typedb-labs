// Before and after: every affected item's planned date against its projected date, with the
// contractual deadlines as vertical lines. Dates and deadlines come from /api/impact.
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Schemas } from '@/api/client'
import { formatDate, parseDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RowChevron, rowClass } from '@/components/row'

type Impact = Schemas['Impact']
const ROWS_FIRST = 8

export function BeforeAfter({ data, onSelect, selected }: { data: Impact; onSelect: (code: string) => void; selected?: string }) {
  const [expanded, setAll] = useState(false)
  // Items that contractual deadlines limit come first: they are the dates that matter most.
  const limited = new Set(data.deadlines.flatMap((d) => d.limits.map((l) => l.code)))
  const rows = [...data.items].sort((a, b) =>
    Number(b.role === 'start') - Number(a.role === 'start') || Number(limited.has(b.code)) - Number(limited.has(a.code))
    || (a.planned ?? '').localeCompare(b.planned ?? ''))
  const shown = expanded ? rows : rows.slice(0, ROWS_FIRST)
  const dates = [...data.items.flatMap((i) => [i.planned!, i.projected!]), ...data.deadlines.map((d) => d.due), data.as_of].filter(Boolean)
  const t = dates.map((d) => parseDate(d).getTime())
  const pad = 10 * 86_400_000
  const start = Math.min(...t) - pad, end = Math.max(...t) + pad
  const pos = (iso: string) => `${((parseDate(iso).getTime() - start) / (end - start)) * 100}%`
  const months: { iso: string; label: string }[] = []
  for (const d = new Date(start); d.getTime() < end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    if (m.getTime() < end) months.push({ iso: m.toISOString().slice(0, 10), label: m.toLocaleDateString('en-GB', { month: 'short', year: m.getUTCMonth() === 0 ? 'numeric' : undefined, timeZone: 'UTC' }) })
  }
  // Label months without collisions: skip one that sits too close to the last label (January wins).
  const frac = (iso: string) => (parseDate(iso).getTime() - start) / (end - start)
  const uniqMonths: { iso: string; label: string }[] = []
  for (const m of [...new Map(months.map((x) => [x.iso, x])).values()]) {
    const prev = uniqMonths[uniqMonths.length - 1]
    if (!prev || frac(m.iso) - frac(prev.iso) >= 0.085) uniqMonths.push(m)
    else if (m.iso.slice(5, 7) === '01') uniqMonths[uniqMonths.length - 1] = m
  }

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-y-0 md:grid-cols-[260px_minmax(0,1fr)_92px]">
        <div className="hidden md:block" />
        <div className="relative hidden h-6 md:block">
          {uniqMonths.map((m) => <span key={m.iso} className="absolute top-1 -translate-x-1/2 text-[10.5px] text-muted-foreground" style={{ left: pos(m.iso) }}>{m.label}</span>)}
        </div>
        <div className="hidden md:block" />
        {shown.map((it) => {
          const moved = it.shift_days > 0
          return (
            <button key={it.code} type="button" onClick={() => onSelect(it.code)} aria-pressed={selected === it.code}
              className={rowClass(selected === it.code, 'relative col-span-full grid grid-cols-subgrid items-center py-1.5')}>
              <RowChevron selected={selected === it.code} className="absolute top-1/2 right-1 -translate-y-1/2" />
              <div className="min-w-0 px-2">
                <div className="truncate text-[12.5px] font-medium text-ink" title={it.name ?? undefined}>{it.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {it.role === 'start' ? 'Delayed approval' : it.workstream?.name}{limited.has(it.code) ? ' · limited by a deadline' : ''}
                </div>
              </div>
              <div className="relative mx-2 my-1 h-5 md:my-0">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                {data.deadlines.map((d) => (
                  <div key={d.code} className={cn('absolute -top-1 -bottom-1 w-px', d.breached ? 'bg-risk' : 'bg-risk/25')} style={{ left: pos(d.due) }} />
                ))}
                {moved && (
                  <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-warn/35"
                    style={{ left: pos(it.planned!), width: `calc(${pos(it.projected!)} - ${pos(it.planned!)})` }} />
                )}
                <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-300 bg-white" style={{ left: pos(it.planned!) }} title={`Planned ${formatDate(it.planned)}`} />
                <span className={cn('absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-all',
                  it.role === 'start' ? 'bg-ink' : moved ? 'bg-warn' : 'bg-ok')} style={{ left: pos(it.projected!) }} title={`Projected ${formatDate(it.projected)}`} />
              </div>
              <div className="px-2 text-right text-[11.5px] tabular">
                <div className={cn('font-semibold', moved ? 'text-warn' : 'text-muted-foreground')}>{moved ? `+${it.shift_days} days` : 'no change'}</div>
                <div className="text-muted-foreground">{formatDate(it.projected, { year: false })}</div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-slate-300 bg-white" />Planned (recorded in TypeDB)</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-warn" />Projected (this scenario only)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-risk" />Contractual deadline</span>
        {rows.length > ROWS_FIRST && (
          <button type="button" onClick={() => setAll(!expanded)} className="ml-auto inline-flex items-center gap-1 font-medium text-ink hover:underline">
            <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />{expanded ? 'Show fewer' : `Show all ${rows.length} items`}
          </button>
        )}
      </div>
    </div>
  )
}
