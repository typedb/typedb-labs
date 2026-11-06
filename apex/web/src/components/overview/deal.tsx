import { ArrowRight, Building2, CalendarClock, CircleCheckBig, Gauge, Landmark, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeal, type Schemas } from '@/api/client'
import { PanelError } from '@/components/panel'
import { ProgressBar } from '@/components/status'
import { TypeQLDrawer } from '@/components/typeql'
import { formatDate, formatMoney, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATE = {
  // The badge names its subject: the transaction. "On target" only when no condition is at risk or delayed.
  'at-risk': { label: 'Transaction at risk', icon: ShieldAlert, cls: 'bg-warn-soft text-warn ring-warn/30' },
  'on-track': { label: 'On target', icon: ShieldCheck, cls: 'bg-ok-soft text-ok ring-ok/25' },
  'conditions-satisfied': { label: 'All conditions satisfied', icon: CircleCheckBig, cls: 'bg-ok-soft text-ok ring-ok/25' },
} as const

function Party({ role, org }: { role: string; org: Schemas['Organisation'] }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">{role}</div>
      <div className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-white"><Building2 className="size-4 text-teal-300/80" />{org.name}</div>
      <div className="mt-0.5 truncate text-xs text-white/55">{org.sector} · {org.jurisdiction}</div>
    </div>
  )
}

/** The deal header: name, parties, value and the headline status computed from TypeDB. */
export function DealHeader() {
  const q = useDeal()
  if (q.isPending) return <Skeleton className="h-56 w-full rounded-2xl" />
  if (q.isError) return <PanelError message={q.error.message} />
  const d = q.data.data
  const state = STATE[d.status.state]
  return (
    <Card className="gap-0 overflow-hidden border-0 py-0 shadow-lg shadow-ink/10">
      <div className="relative overflow-hidden bg-gradient-to-br from-ink via-ink to-ink-soft px-6 py-7 text-white sm:px-8">
        <div className="pointer-events-none absolute -top-24 -right-16 size-80 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', state.cls)}>
                <state.icon className="size-3.5" />{state.label}
              </span>
              <span className="text-[13px] text-white/70">
                {d.status.at_risk.length > 0 && <><span className="font-medium text-white">{d.status.at_risk.map((c) => `${c.name} is ${c.status.replace('-', ' ')}`).join('; ')}</span> · </>}
                {d.status.headline}
              </span>
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[34px]">{d.name}</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/70">{d.description}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <Party role="Acquirer" org={d.acquirer} />
              <div className="flex items-center justify-center text-white/40"><ArrowRight className="size-5 rotate-90 sm:rotate-0" /></div>
              <Party role="Target" org={d.target} />
            </div>
          </div>
          <div className="shrink-0 lg:text-right">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">Transaction value</div>
            <div className="mt-1 text-5xl font-semibold tracking-tight tabular">{formatMoney(d.value, d.currency)}</div>
            <div className="mt-2 text-[13px] text-white/65">{d.structure} · {d.currency}</div>
            <div className="mt-1 text-[12px] text-white/45">Data as of {formatDate(d.as_of)}</div>
          </div>
        </div>
      </div>
      <div className="bg-card"><TypeQLDrawer envelope={q.data} note="Finds the acquisition with its acquirer and target by role, every condition and work item with its exact type, committed financing summed by currency, and each deadline with the items it limits." /></div>
    </Card>
  )
}

function Tile({ icon: Icon, label, value, detail, children, tone }: {
  icon: typeof Gauge; label: string; value: React.ReactNode; detail?: React.ReactNode; children?: React.ReactNode; tone?: 'warn'
}) {
  return (
    <div className={cn('flex flex-col rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]', tone === 'warn' && 'border-warn/30')}>
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <Icon className={cn('size-4', tone === 'warn' ? 'text-warn' : 'text-brand')} />{label}
      </div>
      <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight text-ink tabular">{value}</div>
      {children}
      {detail && <div className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{detail}</div>}
    </div>
  )
}

/** Key transaction metrics, all from /api/deal (its TypeQL is in the header's drawer). */
export function KeyMetrics() {
  const q = useDeal()
  if (q.isPending) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
  if (q.isError) return null
  const { status, metrics } = q.data.data
  const next = metrics.next_deadline
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile icon={CircleCheckBig} label="Conditions satisfied" tone={status.at_risk.length ? 'warn' : undefined}
        value={<>{status.conditions_satisfied}<span className="text-lg text-muted-foreground"> / {status.conditions_total}</span></>}
        detail={status.at_risk.length
          ? <><span className="font-medium text-warn">{plural(status.at_risk.length, 'condition')} at risk:</span> {status.at_risk.map((a) => a.name).join(', ')}</>
          : 'No condition at risk'}>
        <div className="mt-3 flex gap-1">
          {Array.from({ length: status.conditions_total }, (_, i) => (
            <div key={i} className={cn('h-1.5 flex-1 rounded-full',
              i < status.conditions_satisfied ? 'bg-ok' : i < status.conditions_satisfied + status.at_risk.length ? 'bg-warn' : 'bg-muted')} />
          ))}
        </div>
      </Tile>
      <Tile icon={Gauge} label="Work progress"
        value={<>{metrics.progress_percent}%<span className="ml-1.5 text-[13px] font-medium text-muted-foreground">activity progress</span></>}
        detail={<>{metrics.progress_basis}. Neither figure is readiness to close: that is <span className="font-medium text-foreground">Conditions satisfied</span>.</>}>
        <ProgressBar value={metrics.progress_percent} status="in-progress" className="mt-3" />
        <div className="mt-3 flex items-baseline justify-between text-[12.5px]">
          <span className="text-muted-foreground">Milestones achieved</span>
          <span className="font-semibold text-ink tabular">{metrics.milestones_achieved} of {metrics.milestones_total}</span>
        </div>
        <ProgressBar value={metrics.milestones_total ? (100 * metrics.milestones_achieved) / metrics.milestones_total : 0} status="complete" className="mt-1.5" />
      </Tile>
      <Tile icon={Landmark} label="Committed debt financing"
        value={metrics.committed_financing.map((m) => formatMoney(m.total, m.currency)).join(' + ') || '—'}
        detail="Facilities committed by lenders for this transaction" />
      <Tile icon={CalendarClock} label="Next contractual deadline"
        value={next ? <>{next.days_remaining}<span className="text-lg text-muted-foreground"> days</span></> : '—'}
        detail={next && <><span className="font-medium text-foreground">{next.name}</span> · {formatDate(next.due)}
          {next.headroom_days != null && <> · {next.headroom_days} days of headroom over the planned date</>}</>} />
    </div>
  )
}
