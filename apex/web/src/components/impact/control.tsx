// Scenario control, escalation banner and contractual-deadline cards for the Impact Explorer.
// Every number and outcome shown here comes from /api/impact; nothing is decided in the browser.
import { AlertOctagon, ArrowRight, CalendarClock, CheckCircle2, Clock, Flag, Gavel, RotateCcw, Scale, TriangleAlert } from 'lucide-react'
import type { Schemas } from '@/api/client'
import { formatDate, formatPercent, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Impact = Schemas['Impact']

export function ScenarioControl({ data, delay, setDelay, max }: { data: Impact; delay: number; setDelay: (d: number) => void; max: number }) {
  const s = data.start
  const pct = (d: number) => `${(d / max) * 100}%`
  return (
    <div className="rounded-2xl bg-gradient-to-br from-ink via-ink to-ink-soft p-5 text-white shadow-lg shadow-ink/10 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.12em] text-white/50 uppercase">Scenario: delay to</div>
          <div className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{s.name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/70">
            <span>Planned {formatDate(s.planned)}</span>
            <ArrowRight className="size-3.5 text-white/40" />
            <span className={cn('rounded px-1.5 py-0.5 font-semibold', delay ? 'bg-amber-300/15 text-amber-200' : 'text-white')}>
              Projected {formatDate(s.projected)}
            </span>
            <span className="text-white/45">· accountable: {s.raci.find((r) => r.letter === 'A')?.name ?? '—'}</span>
          </div>
        </div>
        <div className="shrink-0 text-left lg:text-right">
          <div className="text-[11px] font-semibold tracking-[0.12em] text-white/50 uppercase">Delay</div>
          <div className="text-5xl leading-none font-semibold tracking-tight tabular">{delay}<span className="ml-1 text-xl text-white/60">days</span></div>
        </div>
      </div>

      <div className="mt-6">
        <div className="relative px-1">
          <input type="range" min={0} max={max} step={1} value={delay} aria-label="Delay in days"
            onChange={(e) => setDelay(Number(e.target.value))}
            className="apex-range relative z-10 w-full" style={{ ['--fill' as string]: pct(delay) }} />
          <div className="pointer-events-none absolute inset-x-1 top-0 h-full">
            {data.scenarios.filter((x) => x.kind === 'threshold').map((x) => (
              <div key={x.days} className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-rose-400/90" style={{ left: pct(x.days) }} />
            ))}
          </div>
        </div>
        <div className="relative mt-1 h-4 px-1 text-[10.5px] text-white/45">
          <span className="absolute left-1">0</span>
          <span className="absolute right-1">{max} days</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {data.scenarios.map((x) => {
          const active = x.days === delay
          return (
            <button key={x.days} type="button" onClick={() => setDelay(x.days)} title={x.detail}
              className={cn('group inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[12px] ring-1 transition-all',
                active ? 'bg-white text-ink ring-white' : 'bg-white/5 text-white/85 ring-white/15 hover:bg-white/10')}>
              <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold tabular',
                active ? 'bg-ink text-white' : x.kind === 'threshold' ? 'bg-rose-400/20 text-rose-200' : 'bg-white/10 text-white')}>{x.days}d</span>
              <span className="max-w-56 truncate">{x.label}</span>
            </button>
          )
        })}
        <button type="button" onClick={() => setDelay(0)} disabled={delay === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white/80 ring-1 ring-white/15 hover:bg-white/10 disabled:opacity-40">
          <RotateCcw className="size-3.5" />Reset
        </button>
      </div>
    </div>
  )
}

/** One sentence on where the scenario stands, coloured by how far it has escalated. */
export function EscalationBanner({ data }: { data: Impact }) {
  const breached = data.deadlines.filter((d) => d.breached)
  const nearest = [...data.deadlines].filter((d) => !d.breached).sort((a, b) => a.headroom_days - b.headroom_days)[0]
  const moved = data.summary.moved - (data.start.shift_days > 0 ? 1 : 0)
  const tone = data.level === 'breach' ? 'border-risk/30 bg-risk-soft text-risk' : data.level === 'delayed' ? 'border-warn/30 bg-warn-soft text-warn' : 'border-ok/25 bg-ok-soft text-ok'
  const Icon = data.level === 'breach' ? AlertOctagon : data.level === 'delayed' ? Clock : CheckCircle2
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border px-5 py-4 sm:flex-row sm:items-center', tone)}>
      <Icon className="size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">
          {data.level === 'on-plan' && 'Base plan: every contractual deadline is met'}
          {data.level === 'delayed' && `${plural(moved, 'item')} delayed downstream; no contractual deadline breached`}
          {data.level === 'breach' && `${plural(breached.length, 'contractual deadline')} breached`}
        </div>
        <div className="text-[12.5px] text-foreground/70">
          {data.level === 'breach' && breached.map((d) => d.name).join(' · ')}
          {data.level !== 'breach' && nearest && <>Tightest remaining headroom: <span className="font-medium text-foreground">{nearest.headroom_days} days</span> on {nearest.name}</>}
          {data.level === 'delayed' && data.summary.workstreams.length > 0 && <> · across {data.summary.workstreams.join(', ')}</>}
        </div>
      </div>
      <div className="flex gap-4 text-center">
        <Stat n={moved} label="items delayed" />
        <Stat n={breached.length} label="deadlines breached" alert={breached.length > 0} />
        <Stat n={data.summary.people.filter((p) => p.items.some((i) => i.letter === 'A' || i.letter === 'R')).length} label="people to act" />
      </div>
    </div>
  )
}

function Stat({ n, label, alert }: { n: number; label: string; alert?: boolean }) {
  return (
    <div className="min-w-16">
      <div className={cn('text-2xl leading-none font-semibold tabular', alert ? 'text-risk' : 'text-ink')}>{n}</div>
      <div className="mt-1 text-[10.5px] text-foreground/60">{label}</div>
    </div>
  )
}

/** Each contractual deadline the delay can reach: headroom or breach (calculated), then the recorded
 *  consequence, presented as a potential exposure for people to judge, never as a certainty. */
export function DeadlineCards({ data }: { data: Impact }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {data.deadlines.map((d) => {
        const worst = [...d.limits].sort((a, b) => b.days_over - a.days_over || a.headroom_days - b.headroom_days)[0]
        const span = Math.max(d.breach_from_days ?? 1, 1)
        const used = Math.min(100, (data.delay_days / span) * 100)
        return (
          <div key={d.code} className={cn('flex flex-col overflow-hidden rounded-xl border bg-card transition-all',
            d.breached ? 'border-risk/40 shadow-[0_0_0_3px_rgba(220,38,38,0.08)]' : '')}>
            <div className={cn('px-4 pt-4 pb-3', d.breached && 'bg-risk-soft/60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    <Flag className={cn('size-3.5', d.breached ? 'text-risk' : 'text-muted-foreground')} />Contractual deadline
                  </div>
                  <div className="mt-1 text-[14.5px] leading-snug font-semibold text-ink">{d.name}</div>
                  <div className="text-[12px] text-muted-foreground">{formatDate(d.due)} · {d.legal_basis}</div>
                </div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                  d.breached ? 'bg-risk text-white' : 'bg-ok-soft text-ok')}>
                  {d.breached ? `Breached by ${plural(d.days_over, 'day')}` : `${d.headroom_days} days headroom`}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full transition-all', d.breached ? 'bg-risk' : data.delay_days > 0 ? 'bg-warn' : 'bg-ok')} style={{ width: `${d.breached ? 100 : used}%` }} />
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                {d.breach_from_days != null ? <>Breached from <span className="font-semibold text-foreground">{d.breach_from_days} days</span> of delay</> : 'Not reached within the simulated range'}
              </div>
            </div>
            <ul className="space-y-1.5 border-t px-4 py-3 text-[12.5px]">
              {d.limits.map((x) => (
                <li key={x.code} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-foreground/80">{x.name}</span>
                  <span className={cn('shrink-0 font-medium tabular', x.breached ? 'text-risk' : 'text-ink')}>
                    {formatDate(x.planned, { year: false })} <ArrowRight className="inline size-3" /> {formatDate(x.projected)}
                  </span>
                </li>
              ))}
              {worst && !d.breached && data.delay_days > 0 && <li className="text-[11.5px] text-muted-foreground">Projected {plural(worst.headroom_days, 'day')} inside the deadline</li>}
            </ul>
            <div className={cn('mt-auto border-t px-4 py-3', d.breached ? 'bg-violet-50' : 'bg-muted/40')}>
              <div className={cn('flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase', d.breached ? 'text-violet-700' : 'text-muted-foreground')}>
                <Scale className="size-3.5" />{d.breached ? 'Potential exposure · needs legal judgement' : 'If this deadline were missed'}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/80">{d.consequence}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
                {d.bound.length > 0 && <span className="inline-flex items-center gap-1"><Gavel className="size-3" />Bound: <span className="text-foreground/80">{d.bound.map((b) => b.name).join(', ')}</span></span>}
                {d.consent_from.length > 0 && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" />Consent from: <span className="text-foreground/80">{d.consent_from.map((b) => b.name).join(', ')}</span></span>}
                {d.group_obligation && <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3" />Owed inside the target group ({formatPercent(d.group_obligation.effective_stake)} owned)</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
