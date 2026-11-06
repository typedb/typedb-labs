// The deal schedule as a Gantt chart. Everything drawn comes from /api/schedule: workstreams, their
// items' dates and statuses, dependencies, contractual deadlines and the scenario date. The chart
// only places them on a time axis (no business rules here).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { CalendarRange, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsLeftRight, ChevronsUpDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSchedule, type Schemas } from '@/api/client'
import { Panel } from '@/components/panel'
import { Segmented } from '@/components/page'
import { STATUS_ORDER } from '@/components/status'
import { dayDiff, formatDate, humanise, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ItemDetail } from './item-detail'
import { useSelectedItem } from '@/lib/selection'
import { lanes, makeScale, monthTicks, PX_PER_DAY, spanDays, weekTicks, type Scale, type Zoom } from './scale'

type Schedule = Schemas['Schedule']
type Workstream = Schemas['ScheduleWorkstream']
type Item = Schemas['ScheduleItem']

const LABEL_W = 320
const WS_H = 46
const ITEM_H = 34
const LANE_H = 18
const MARKER_LABEL_W = 168

// Bar colours per status word: a pale track, and a solid fill for the reported progress.
const TRACK: Record<string, string> = {
  complete: 'bg-ok', 'in-progress': 'bg-info/20', 'at-risk': 'bg-warn/25', delayed: 'bg-risk/20', 'not-started': 'bg-idle/20',
}
const FILL: Record<string, string> = {
  complete: 'bg-ok', 'in-progress': 'bg-info', 'at-risk': 'bg-warn', delayed: 'bg-risk', 'not-started': 'bg-idle',
}
const BORDER: Record<string, string> = {
  complete: 'border-ok bg-ok', 'in-progress': 'border-info bg-white', 'at-risk': 'border-warn bg-warn-soft',
  delayed: 'border-risk bg-risk-soft', 'not-started': 'border-idle bg-white',
}

type Row = { kind: 'ws'; ws: Workstream; y: number; h: number } | { kind: 'item'; item: Item; ws: Workstream; y: number; h: number }

/** The deal schedule with the shared item panel. Selection lives in the URL (?item=). With `workstream`,
 *  only that workstream's rows are drawn (the Workstreams page); deadlines stay on the axis. */
export function Gantt({ workstream, title = 'Deal schedule', subtitle }: { workstream?: string; title?: string; subtitle?: string }) {
  const q = useSchedule()
  const navigate = useNavigate()
  const [selected, select] = useSelectedItem()
  const [params, setParams] = useSearchParams()
  const critical = params.get('cp') ?? undefined          // ?cp=DL-... shows that deadline's deadline-critical chain
  const setCritical = (code: string | undefined) => {
    const next = new URLSearchParams(params)
    if (code) next.set('cp', code)
    else next.delete('cp')
    setParams(next, { replace: true, preventScrollReset: true })
  }
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [open, setOpen] = useState<Set<string> | null>(workstream ? new Set([workstream]) : null)   // null until the data says
  const data = q.data && workstream
    ? { ...q.data, data: { ...q.data.data, workstreams: q.data.data.workstreams.filter((w) => w.code === workstream) } }
    : q.data

  return (
    <>
      <Panel title={title} icon={<CalendarRange />} query={q} skeletonRows={8} bodyClassName="px-0 pb-0"
        note="Reads every work item through the parent type deal-item with its workstream, every dependency with its exact kind (which kinds move dates comes from the schema), and each deadline with the items it limits."
        subtitle={subtitle ?? 'Every workstream, activity, milestone and contractual deadline, with the dates TypeDB holds. Select any item for its details.'}
        action={() => data && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[12.5px] shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-brand">
              <span className="font-medium text-muted-foreground">Deadline-critical chain</span>
              <select value={critical ?? ''} onChange={(e) => setCritical(e.target.value || undefined)} aria-label="Show the chain of items with the least float before a contractual deadline"
                className="max-w-56 cursor-pointer bg-transparent py-0.5 text-ink outline-none">
                <option value="">Off</option>
                {data.data.deadlines.filter((d) => d.critical_path).map((d) => <option key={d.code} value={d.code}>{d.name} ({d.critical_path!.float} days)</option>)}
              </select>
            </label>
            {!workstream && <ExpandAll count={data.data.workstreams.length} open={open} onAll={() => setOpen(new Set(data.data.workstreams.map((w) => w.code)))} onNone={() => setOpen(new Set())} />}
            <Segmented label="Zoom" value={zoom} onChange={(k) => setZoom(k as Zoom)}
              options={[{ key: 'fit', label: workstream ? 'Fit' : 'Whole deal' }, { key: 'months', label: 'Months' }, { key: 'weeks', label: 'Weeks' }]} />
          </div>
        )}>
        {() => data && <Chart data={data.data} zoom={zoom} open={open} setOpen={setOpen} selected={selected} onSelect={select} critical={critical} filtered={Boolean(workstream)} />}
      </Panel>
      {selected && q.data && (
        <ItemDetail code={selected} asOf={q.data.data.as_of} onClose={() => select(undefined)} onSelect={select}
          onShowWorkstream={(code) => navigate(`/workstreams/${code}`)} />
      )}
    </>
  )
}

function ExpandAll({ count, open, onAll, onNone }: { count: number; open: Set<string> | null; onAll: () => void; onNone: () => void }) {
  const all = open !== null && open.size === count
  return (
    <button type="button" onClick={all ? onNone : onAll}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground shadow-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
      {all ? <><ChevronsDownUp className="size-3.5" />Collapse all</> : <><ChevronsUpDown className="size-3.5" />Expand all</>}
    </button>
  )
}

function scrollToRow(code: string) {
  // After the next render (a timer, not requestAnimationFrame, so it also runs in a background tab).
  setTimeout(() => document.getElementById(`gantt-${code}`)?.scrollIntoView({ block: 'nearest', inline: 'center' }), 0)
}

function Chart({ data, zoom, open, setOpen, selected, onSelect, critical, filtered }: {
  data: Schedule; zoom: Zoom; open: Set<string> | null; setOpen: (f: (o: Set<string> | null) => Set<string>) => void
  selected?: string; onSelect: (code: string | undefined) => void; critical?: string; filtered?: boolean
}) {
  const path = data.deadlines.find((d) => d.code === critical)
  const chain = useMemo(() => new Set(path?.critical_path?.items ?? []), [path])
  // Showing a deadline-critical chain opens the workstreams it runs through.
  useEffect(() => {
    if (!chain.size) return
    const wss = data.workstreams.filter((w) => w.items.some((i) => chain.has(i.code))).map((w) => w.code)
    setOpen((o) => (wss.every((w) => o?.has(w)) ? (o ?? new Set()) : new Set([...(o ?? []), ...wss])))
  }, [chain, data, setOpen])
  const scroller = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth - LABEL_W))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // First view: open the workstreams that hold anything at risk or delayed (from the data).
  useEffect(() => {
    if (open === null) setOpen(() => new Set(data.workstreams.filter((w) => w.items.some((i) => i.status === 'at-risk' || i.status === 'delayed')).map((w) => w.code)))
  }, [open, data, setOpen])

  const dates = useMemo(() => [
    data.as_of,
    ...data.deadlines.map((d) => d.due),
    ...data.workstreams.flatMap((w) => [w.planned_start, w.due]),
    ...data.workstreams.flatMap((w) => w.items.flatMap((i) => [i.planned_start, i.due])),
  ].filter((d): d is string => Boolean(d)), [data])
  const ppd = zoom === 'fit' ? Math.max(1, available / spanDays(dates)) : PX_PER_DAY[zoom]
  const scale = useMemo(() => makeScale(dates, ppd), [dates, ppd])

  // On a zoom change, bring the scenario date into view (a third of the way across).
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = zoom === 'fit' ? 0 : Math.max(0, scale.x(data.as_of) - (el.clientWidth - LABEL_W) / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the zoom changes, not on every refetch
  }, [zoom, scale.ppd])

  const byCode = useMemo(() => new Map(data.workstreams.flatMap((w) => w.items.map((i) => [i.code, { item: i, ws: w }] as const))), [data])
  // Selecting an item (from the panel's links, or a deep link) opens its workstream and brings it into view.
  const found = selected ? byCode.get(selected) : undefined
  const rowShown = Boolean(found && open?.has(found.ws.code))
  useEffect(() => {
    if (found && !rowShown) setOpen((o) => new Set([...(o ?? []), found.ws.code]))
  }, [found, rowShown, setOpen])
  useEffect(() => {
    if (selected && rowShown) scrollToRow(selected)     // once its row exists
  }, [selected, rowShown])

  const rows: Row[] = []
  let y = 0
  for (const ws of data.workstreams) {
    rows.push({ kind: 'ws', ws, y, h: WS_H }); y += WS_H
    if (open?.has(ws.code)) for (const item of ws.items) { rows.push({ kind: 'item', item, ws, y, h: ITEM_H }); y += ITEM_H }
  }
  const bodyHeight = y

  const markers = lanes([
    { key: 'as-of', x: scale.x(data.as_of), label: `Scenario date · ${formatDate(data.as_of)}`, kind: 'as-of' as const },
    ...data.deadlines.map((d) => ({ key: d.code, x: scale.x(d.due), label: `${d.name} · ${formatDate(d.due)}`, kind: 'deadline' as const, code: d.code })),
  ], MARKER_LABEL_W)
  const laneCount = Math.max(1, ...markers.map((m) => m.lane + 1))
  const months = monthTicks(scale)
  const weeks = zoom === 'weeks' ? weekTicks(scale) : []
  const total = LABEL_W + scale.width
  const sideways = scale.width > available + 1

  return (
    <div>
      {path?.critical_path && <CriticalNote data={data} deadline={path} filtered={filtered} />}
      <Legend hint={sideways ? <span id="gantt-scroll-hint" className="ml-auto inline-flex items-center gap-1.5 font-medium text-ink-soft">
        <ChevronsLeftRight className="size-3.5" aria-hidden />Scroll sideways: trackpad, Shift + wheel, or ← → with the chart focused</span> : undefined} />
      <div ref={scroller} className="relative overflow-x-auto border-t outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
        role="region" aria-label="Deal schedule, scrolls sideways" tabIndex={sideways ? 0 : undefined} aria-describedby={sideways ? 'gantt-scroll-hint' : undefined}>
        <div style={{ width: Math.max(total, LABEL_W + available) }} className="relative">
          {/* Time axis: months, weeks (when zoomed in), then the scenario date and deadlines. */}
          <div className="relative z-20 flex border-b bg-white">
            <div className="sticky left-0 z-20 flex shrink-0 items-end border-r bg-white px-4 pb-2 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase" style={{ width: LABEL_W }}>
              Workstream / item
            </div>
            <div className="relative" style={{ width: scale.width, height: 24 + (weeks.length ? 18 : 0) + laneCount * LANE_H + 8 }}>
              {months.map((m) => (
                <div key={m.x} className="absolute top-0 h-6 truncate border-l border-border/80 pl-1.5 text-[11.5px] leading-6 font-medium text-ink-soft" style={{ left: m.x, width: m.width }} title={m.label}>{m.label}</div>
              ))}
              {weeks.map((w) => (
                <div key={w.x} className="absolute top-6 h-[18px] border-l border-border/60 pl-1 text-[10.5px] leading-[18px] text-muted-foreground tabular" style={{ left: w.x }}>{w.label}</div>
              ))}
              {markers.map((m) => (
                <button key={m.key} type="button" disabled={m.kind === 'as-of'} onClick={() => m.kind === 'deadline' && onSelect(m.code)}
                  className={cn('absolute flex items-center gap-1 truncate rounded-sm pr-1 pl-1.5 text-left text-[11px] leading-4 font-semibold whitespace-nowrap',
                    m.kind === 'as-of' ? 'cursor-default text-ink' : 'text-risk hover:underline')}
                  // A label that would run off the right edge ends at its line instead.
                  style={{ ...(m.x + MARKER_LABEL_W > scale.width ? { right: scale.width - m.x } : { left: m.x }),
                    top: 24 + (weeks.length ? 18 : 0) + 4 + m.lane * LANE_H, maxWidth: MARKER_LABEL_W - 8 }}
                  title={m.label}>
                  <span className="truncate">{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Body: rows, with gridlines, deadline lines and the scenario-date line behind them. */}
          <div className="relative" style={{ height: bodyHeight }} data-gantt-body>
            <div className="pointer-events-none absolute top-0 bottom-0" style={{ left: LABEL_W, width: scale.width }} aria-hidden>
              {months.map((m) => <div key={m.x} className="absolute top-0 bottom-0 border-l border-border/50" style={{ left: m.x }} />)}
              {weeks.map((w) => <div key={w.x} className="absolute top-0 bottom-0 border-l border-dashed border-border/40" style={{ left: w.x }} />)}
              {data.deadlines.map((d) => <div key={d.code} className="absolute top-0 bottom-0 border-l-2 border-dashed border-risk/70" style={{ left: scale.x(d.due) }} />)}
              <div className="absolute top-0 bottom-0 w-0.5 -translate-x-px bg-ink" style={{ left: scale.x(data.as_of) }} />
            </div>
            {rows.map((r) => r.kind === 'ws'
              ? <WorkstreamRow key={r.ws.code} ws={r.ws} scale={scale} open={Boolean(open?.has(r.ws.code))} selected={selected} onSelect={onSelect}
                  onToggle={() => setOpen((o) => { const n = new Set(o ?? []); if (n.has(r.ws.code)) n.delete(r.ws.code); else n.add(r.ws.code); return n })} />
              : <ItemRow key={r.item.code} item={r.item} scale={scale} asOf={data.as_of} selected={selected === r.item.code} onSelect={onSelect}
                  onPath={chain.has(r.item.code)} dim={chain.size > 0 && !chain.has(r.item.code)} />)}
            {(selected || chain.size > 0) && <Arrows data={data} rows={rows} scale={scale} selected={selected} chain={chain} />}
          </div>
        </div>
      </div>
      <p className="border-t px-6 py-3 text-[12px] text-muted-foreground">
        The dark line is the <span className="font-medium text-ink">scenario date</span> stored in TypeDB; this demonstration never uses today's real date.
        Red dashed lines are contractual deadlines. Bars run from planned start to due date; a selected item shows its dependencies
        (solid: moves dates; dashed: information only).
      </p>
    </div>
  )
}

function Legend({ hint }: { hint?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-6 pb-3 text-[12px] text-muted-foreground">
      {STATUS_ORDER.map((s) => <span key={s} className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-5 rounded-sm', FILL[s])} />{humanise(s)}</span>)}
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rotate-45 border-2 border-info bg-white" />Milestone</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 border-l-2 border-dashed border-risk" />Contractual deadline</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ink" />Scenario date</span>
      {hint}
    </div>
  )
}

function Label({ children, depth, className }: { children: React.ReactNode; depth: number; className?: string }) {
  return (
    <div className={cn('sticky left-0 z-10 flex shrink-0 items-center border-r bg-card', className)} style={{ width: LABEL_W, paddingLeft: 12 + depth * 22 }}>
      {children}
    </div>
  )
}

// The focus ring continues across the sticky label cell, which would otherwise cover the row's own ring.
const LABEL_FOCUS = 'group-focus-visible:shadow-[inset_2px_0_0_0_var(--color-brand),inset_0_2px_0_0_var(--color-brand),inset_0_-2px_0_0_var(--color-brand)]'
const ROW_FOCUS = 'outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-brand)]'

/** Up and down arrows move between the chart's rows (Tab works too); Enter or Space opens one. */
function rowKeys(e: React.KeyboardEvent<HTMLElement>, activate: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    activate()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...(e.currentTarget.closest('[data-gantt-body]')?.querySelectorAll<HTMLElement>('[data-gantt-row]') ?? [])]
    const next = rows[rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }
}

function WorkstreamRow({ ws, scale, open, selected, onSelect, onToggle }: {
  ws: Workstream; scale: Scale; open: boolean; selected?: string; onSelect: (code: string) => void; onToggle: () => void
}) {
  const left = scale.x(ws.planned_start!)
  const width = scale.x(ws.due!) + scale.ppd - left
  const points = ws.items.filter((i) => i.shape !== 'bar')
  return (
    <div id={`gantt-${ws.code}`} className="flex border-b bg-muted/30" style={{ height: WS_H }}>
      <Label depth={0} className="bg-muted p-0">
        <button type="button" onClick={onToggle} aria-expanded={open} data-gantt-row
          onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') rowKeys(e, onToggle) }}
          aria-label={`${ws.name} workstream: ${ws.progress ?? 0}% activity progress, ${ws.milestones_achieved} of ${ws.milestones_total} milestones achieved. ${open ? 'Collapse' : 'Expand'}`}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 pr-3 pl-3 text-left transition-colors hover:bg-[oklch(0.93_0.01_250)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
          {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-ink" title={ws.name ?? undefined}>{ws.name}</span>
            <span className="block truncate text-[11.5px] text-muted-foreground">
              <span className="font-medium text-ink-soft">{ws.progress ?? 0}% activity progress</span> · {ws.milestones_achieved}/{ws.milestones_total} milestones achieved
            </span>
          </span>
        </button>
      </Label>
      <div className="relative flex-1" style={{ width: scale.width }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="absolute top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-ink/12" style={{ left, width }}>
              <div className="h-full bg-ink/45" style={{ width: `${ws.progress ?? 0}%` }} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="font-medium">{ws.name}</div>
            <div>{formatDate(ws.planned_start)} → {formatDate(ws.due)} · <StatusWord status={ws.status} /></div>
            <div className="opacity-80">{ws.progress_basis}: {ws.progress ?? 0}%</div>
          </TooltipContent>
        </Tooltip>
        {!open && points.map((i) => <Point key={i.code} item={i} scale={scale} small selected={selected === i.code} onSelect={onSelect} />)}
      </div>
    </div>
  )
}

/** One activity, milestone or deadline. The whole row is one control: label, bar and empty space
 *  all open the same item panel (bars and diamonds inside are not separate buttons). */
function ItemRow({ item, scale, asOf, selected, onSelect, onPath, dim }: {
  item: Item; scale: Scale; asOf: string; selected: boolean; onSelect: (code: string) => void; onPath?: boolean; dim?: boolean
}) {
  const when = item.planned_start ? `${formatDate(item.planned_start)} to ${formatDate(item.due)}` : formatDate(item.due)
  return (
    <div role="button" tabIndex={0} data-gantt-row aria-pressed={selected}
      aria-label={`${item.name}. ${humanise(item.type)}, ${when}, ${humanise(item.status)}. Open details`}
      onClick={() => onSelect(item.code)} onKeyDown={(e) => rowKeys(e, () => onSelect(item.code))}
      className={cn('group flex cursor-pointer border-b border-border/60 transition-colors', ROW_FOCUS,
        selected ? 'bg-brand-soft' : 'hover:bg-muted', dim && 'opacity-45 hover:opacity-100 focus-visible:opacity-100')} style={{ height: ITEM_H }}>
      <Label depth={1} className={cn('relative pr-2 transition-colors', LABEL_FOCUS, selected ? 'bg-brand-soft' : 'group-hover:bg-muted')}>
        {selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" aria-hidden />}
        <ShapeIcon item={item} />
        <span className={cn('ml-2 min-w-0 flex-1 truncate text-[12.5px]', selected || onPath ? 'font-semibold text-ink' : 'text-ink-soft group-hover:text-ink')} title={item.name ?? undefined}>{item.name}</span>
        {onPath && <span className="mr-1 shrink-0 rounded bg-risk-soft px-1.5 text-[10.5px] font-semibold text-risk" title="On the deadline-critical chain: least float before the chosen contractual deadline breaks">Deadline-critical</span>}
        <ChevronRight aria-hidden className={cn('size-4 shrink-0 transition-opacity',
          selected ? 'text-brand opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')} />
      </Label>
      <div className="relative flex-1" style={{ width: scale.width }}>
        {item.shape === 'bar' ? <Bar item={item} scale={scale} asOf={asOf} selected={selected} onPath={onPath} /> : <Point item={item} scale={scale} selected={selected} onPath={onPath} />}
      </div>
    </div>
  )
}

function ShapeIcon({ item }: { item: Item }) {
  if (item.shape === 'deadline') return <span className="h-3 shrink-0 border-l-2 border-dashed border-risk" aria-hidden />
  if (item.shape === 'milestone') return <span className={cn('size-2 shrink-0 rotate-45 border-[1.5px]', BORDER[item.status ?? 'not-started'])} aria-hidden />
  return <span className={cn('h-1.5 w-3 shrink-0 rounded-sm', FILL[item.status ?? 'not-started'])} aria-hidden />
}

function StatusWord({ status }: { status?: string | null }) {
  return <span>{humanise(status)}</span>
}

function ItemTooltip({ item, asOf }: { item: Item; asOf?: string }) {
  const days = item.planned_start ? dayDiff(item.due!, item.planned_start) + 1 : null
  return (
    <TooltipContent side="top" className="max-w-80">
      <div className="font-medium">{item.name}</div>
      <div>{item.planned_start ? <>{formatDate(item.planned_start)} → {formatDate(item.due)} ({days} days)</> : formatDate(item.due)}</div>
      <div className="opacity-80">{humanise(item.type)} · <StatusWord status={item.status} />{item.shape === 'bar' && item.status !== 'complete' && <> · {item.progress ?? 0}% reported</>}</div>
      {asOf && item.actual_start && item.actual_start !== item.planned_start && <div className="opacity-80">Actually started {formatDate(item.actual_start)}</div>}
      {item.status !== 'complete' && item.shape !== 'deadline' && (
        <div className="opacity-80">{item.float != null ? `Schedule float ${item.float} days before a contractual deadline breaks` : 'No contractual deadline within reach of a delay'}</div>
      )}
    </TooltipContent>
  )
}

function Bar({ item, scale, asOf, selected, onPath }: { item: Item; scale: Scale; asOf: string; selected: boolean; onPath?: boolean }) {
  const left = scale.x(item.planned_start!)
  const width = Math.max(scale.x(item.due!) + scale.ppd - left, 4)
  const status = item.status ?? 'not-started'
  const done = status === 'complete' ? 100 : item.progress ?? 0
  const inside = width > item.name!.length * 6.2 + 16
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span id={`gantt-${item.code}`} data-selected={selected || undefined}
          className={cn('absolute top-1/2 flex h-[18px] -translate-y-1/2 items-center rounded-[5px] transition-shadow',
            TRACK[status], selected ? 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-brand)]'
              : onPath ? 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-risk)]' : 'group-hover:shadow-[0_0_0_1px_var(--color-ink-soft)]')}
          style={{ left, width }}>
          <span className={cn('absolute inset-y-0 left-0 rounded-[5px]', FILL[status])} style={{ width: `${done}%` }} />
          {inside && <span className={cn('relative truncate px-2 text-[11px] font-medium', done > 55 ? 'text-white' : 'text-ink')}>{item.name}</span>}
        </span>
      </TooltipTrigger>
      <ItemTooltip item={item} asOf={asOf} />
    </Tooltip>
  )
}

/** A diamond. Inside an item row it is part of the row's control; on a collapsed workstream row
 *  (`small`) it is its own button, since that row's label expands the workstream instead. */
function Point({ item, scale, small, selected, onSelect, onPath }: { item: Item; scale: Scale; small?: boolean; selected: boolean; onSelect?: (code: string) => void; onPath?: boolean }) {
  const x = scale.x(item.due!) + scale.ppd / 2
  const status = item.status ?? 'not-started'
  const diamond = item.shape === 'deadline'
    ? <span className={cn('block rotate-45 border-2 border-risk bg-white', small ? 'size-2.5' : 'size-3', selected && 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-brand)]')} />
    : <span className={cn('block rotate-45 border-2', BORDER[status], small ? 'size-2.5' : 'size-3', selected ? 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-brand)]'
        : onPath && 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-risk)]')} />
  const cls = 'absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center p-1'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {small
          ? <button type="button" onClick={() => onSelect?.(item.code)} aria-label={`${item.name}: ${formatDate(item.due)}, ${humanise(status)}. Open details`}
              className={cn(cls, 'cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-brand')} style={{ left: x }}>{diamond}</button>
          : <span id={`gantt-${item.code}`} data-selected={selected || undefined} className={cls} style={{ left: x }}>
              {diamond}
              <span className="pointer-events-none absolute left-full ml-0.5 text-[11px] whitespace-nowrap text-muted-foreground">{formatDate(item.due, { year: false })}</span>
            </span>}
      </TooltipTrigger>
      <ItemTooltip item={item} />
    </Tooltip>
  )
}

/** Dependency arrows for the selected item only (prerequisite's end to dependent's start). */
function Arrows({ data, rows, scale, selected, chain }: { data: Schedule; rows: Row[]; scale: Scale; selected?: string; chain: Set<string> }) {
  const at = new Map<string, Row>()
  for (const r of rows) if (r.kind === 'item') at.set(r.item.code, r)
  const wsRow = new Map(rows.filter((r) => r.kind === 'ws').map((r) => [r.ws.code, r]))
  const items = new Map(data.workstreams.flatMap((w) => w.items.map((i) => [i.code, i] as const)))
  const place = (code: string, end: boolean) => {
    const item = items.get(code)
    if (!item) return null
    const row = at.get(code) ?? wsRow.get(item.workstream ?? '')
    if (!row) return null
    const x = item.shape === 'bar' ? (end ? scale.x(item.due!) + scale.ppd : scale.x(item.planned_start!)) : scale.x(item.due!) + scale.ppd / 2
    return { x, y: row.y + row.h / 2 }
  }
  const edges = selected ? data.dependencies.filter((d) => d.from === selected || d.to === selected)
    : data.dependencies.filter((d) => d.hard && chain.has(d.from) && chain.has(d.to))      // the chain's own links
  return (
    <svg className="pointer-events-none absolute top-0 z-[5] overflow-visible" style={{ left: LABEL_W, width: scale.width, height: '100%' }} aria-hidden>
      <defs>
        <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" className="fill-brand" />
        </marker>
      </defs>
      {edges.map((d) => {
        const a = place(d.from, true)
        const b = place(d.to, false)
        if (!a || !b) return null
        const bend = Math.max(18, Math.min(60, Math.abs(b.x - a.x) / 2))
        return <path key={`${d.from}-${d.to}`} d={`M${a.x},${a.y} C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`}
          className={cn('fill-none stroke-brand', d.hard ? 'stroke-[1.6]' : 'stroke-[1.3] opacity-70')} strokeDasharray={d.hard ? undefined : '4 3'}
          markerEnd="url(#gantt-arrow)" />
      })}
    </svg>
  )
}


/** What the deadline-critical chain means, kept apart from deadline exposure (both from impact.schedule_float).
 *  It is not a conventional (CPM) critical path to the end of the project: it is measured against a contractual deadline. */
function CriticalNote({ data, deadline, filtered }: { data: Schedule; deadline: Schedule['deadlines'][number]; filtered?: boolean }) {
  const cp = deadline.critical_path!
  const names = new Map(data.workstreams.flatMap((w) => w.items.map((i) => [i.code, i.name])))
  const shown = cp.items.filter((c) => names.has(c))
  return (
    <div className="mx-6 mb-3 grid gap-3 rounded-lg border border-risk/25 bg-risk-soft/40 px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft md:grid-cols-2">
      <div>
        <div className="font-semibold text-ink">Deadline exposure: {deadline.name}</div>
        It can absorb <span className="font-semibold text-risk">{cp.float} days</span> of delay before it breaks ({formatDate(deadline.due)}). That is the
        smallest schedule float of anything that leads to it: the same figure the Impact Explorer finds as its breaking point minus one.
      </div>
      <div>
        <div className="font-semibold text-ink">Deadline-critical chain: {plural(cp.items.length, 'item')} marked <span className="text-risk">Deadline-critical</span></div>
        {cp.items.map((c) => names.get(c) ?? c).join(' → ')}. These share that smallest float: a day of delay to any of them is a day off the deadline's
        headroom. This is not a conventional critical path to the end of the project; it is measured against this contractual
        deadline. Other items have more float, shown in their tooltips.
        {filtered && shown.length < cp.items.length && <span className="block text-muted-foreground">Some of these items are in other workstreams and are not drawn here.</span>}
      </div>
    </div>
  )
}
