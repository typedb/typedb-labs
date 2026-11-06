import { Scale } from 'lucide-react'
import { useApprovals } from '@/api/client'
import { Panel } from '@/components/panel'
import { ProgressBar, StatusBadge } from '@/components/status'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Regulatory approvals: each clearance with the authorities reviewing it (an n-ary relation). */
export function Approvals({ className }: { className?: string }) {
  const q = useApprovals()
  return (
    <Panel title="Regulatory approvals" icon={<Scale />} className={className} query={q}
      note="Each regulatory clearance with its authority review (the legal basis and phase are stored on the review itself) and the latest event about it."
      subtitle="Each clearance, the authority reviewing it, and the latest recorded event"
      action={({ data }) => (
        <span className="text-xs text-muted-foreground"><span className="font-semibold text-ink">{data.filter((a) => a.status === 'complete').length}</span> of {data.length} cleared</span>
      )}>
      {({ data }) => (
        <div className="divide-y rounded-lg border">
          {data.map((a) => {
            const open = a.status === 'at-risk' || a.status === 'delayed'
            return (
              <div key={a.code} className={cn('grid gap-3 px-4 py-3.5 *:min-w-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]', open && 'bg-warn-soft/40 shadow-[inset_3px_0_0_var(--warn)]')}>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-ink">{a.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {a.reviews.length ? a.reviews.map((r) => (
                      <span key={r.code} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11.5px] text-foreground/80">
                        <span className="rounded bg-white px-1 text-[10px] font-semibold text-muted-foreground ring-1 ring-border">{r.jurisdiction}</span>{r.name}
                      </span>
                    )) : <span className="rounded-md bg-risk-soft px-2 py-0.5 text-[11.5px] font-medium text-risk">No reviewing authority recorded</span>}
                  </div>
                  {a.latest && <div className="mt-1.5 text-[12px] text-muted-foreground"><span className="text-foreground/70">{formatDateTime(a.latest.when)}:</span> {a.latest.summary}</div>}
                </div>
                <div className="min-w-0 text-[12px] text-muted-foreground">
                  <div className="text-foreground/80">{a.reviews[0]?.phase ?? '—'}</div>
                  <div className="truncate">{a.legal_basis}</div>
                  <div className="mt-0.5">Accountable: <span className="text-foreground/80">{a.accountable?.name ?? '—'}</span></div>
                </div>
                <div className="flex min-w-36 flex-col items-start gap-1.5 md:items-end">
                  <StatusBadge status={a.status} />
                  <div className="text-[12px] text-muted-foreground">{a.status === 'complete' ? 'Cleared' : 'Due'} {formatDate(a.status === 'complete' ? a.completed ?? a.due : a.due)}</div>
                  <div className="flex w-32 items-center gap-2"><ProgressBar value={a.progress ?? 0} status={a.status} /><span className="w-8 text-right text-[11px] text-muted-foreground tabular">{a.progress ?? 0}%</span></div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
