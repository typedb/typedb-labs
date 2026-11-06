// Pieces shared by the Workstreams list and detail pages. Presentation only: every value comes from
// /api/workstreams; "in N days" is counted by the API from the stored scenario date.
import type { ReactNode } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Schemas } from '@/api/client'
import { ProgressBar } from '@/components/status'
import { humanise, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Summary = Schemas['WorkstreamSummary']
type Risk = Schemas['WorkstreamRisk']

export function inDays(days: number) {
  if (days === 0) return 'on the scenario date'
  return days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} ago`
}

/** The three measures, never merged: activity progress, milestone completion, readiness to close. */
export function Measures({ w, compact }: { w: Summary; compact?: boolean }) {
  const milestones = w.milestones_total ? (100 * w.milestones_achieved) / w.milestones_total : 0
  const conditions = w.conditions_total ? (100 * w.conditions_satisfied) / w.conditions_total : 0
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-3' : 'sm:grid-cols-3')}>
      <Measure label="Activity progress" value={`${w.progress ?? 0}%`} hint={w.progress_basis}>
        <ProgressBar value={w.progress ?? 0} status="in-progress" />
      </Measure>
      <Measure label="Milestones achieved" value={`${w.milestones_achieved} of ${w.milestones_total}`} hint="Point-in-time items completed">
        <ProgressBar value={milestones} status="complete" />
      </Measure>
      {w.conditions_total > 0
        ? <Measure label="Conditions to close" value={`${w.conditions_satisfied} of ${w.conditions_total}`} hint="Readiness to close: conditions in this workstream that are satisfied">
            <ProgressBar value={conditions} status={w.conditions_satisfied === w.conditions_total ? 'complete' : 'at-risk'} />
          </Measure>
        : <Measure label="Conditions to close" value="None here" hint="This workstream holds no conditions to completion" muted />}
    </div>
  )
}

function Measure({ label, value, hint, children, muted }: { label: string; value: string; hint: string; children?: ReactNode; muted?: boolean }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-[17px] leading-tight font-semibold tabular', muted ? 'text-muted-foreground' : 'text-ink')}>{value}</div>
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

const SEVERITY: Record<string, string> = {
  critical: 'bg-risk-soft text-risk ring-risk/25', high: 'bg-warn-soft text-warn ring-warn/25',
  medium: 'bg-info-soft text-info ring-info/20', low: 'bg-muted text-muted-foreground ring-border',
}

/** A risk, always with words (severity, likelihood, status), never colour alone. */
export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  const closed = risk.status === 'closed'
  const Icon = closed ? ShieldCheck : ShieldAlert
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset',
      closed ? 'bg-muted text-muted-foreground ring-border' : SEVERITY[risk.severity ?? 'low'], className)} title={risk.description ?? undefined}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{risk.name}</span>
      <span className="shrink-0 font-normal opacity-80">· {humanise(risk.severity)} severity · {humanise(risk.status)}</span>
    </span>
  )
}

export function openRisks(w: Summary) {
  return w.risks.filter((r) => r.status !== 'closed')
}
