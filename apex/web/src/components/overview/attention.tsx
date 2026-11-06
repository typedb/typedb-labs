import { CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useChecks } from '@/api/client'
import { Panel } from '@/components/panel'
import { cn } from '@/lib/utils'

/** "Attention needed": the three data-quality checks, run live as TypeQL negation queries. */
export function AttentionNeeded({ className }: { className?: string }) {
  const q = useChecks()
  return (
    <Panel title="Attention needed" icon={<ShieldCheck />} className={className} query={q} skeletonRows={3}
      note="Each check asks TypeDB for what is missing: an item with no Accountable, an item past its due date and not complete, a clearance with no reviewing authority."
      subtitle="Data-quality checks run against the live deal record">
      {({ data }) => {
        const failing = data.checks.filter((c) => c.items.length)
        return (
          <div className="space-y-3">
            <div className={cn('flex items-center gap-3 rounded-lg px-4 py-3', data.passed ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>
              {data.passed ? <CheckCircle2 className="size-5" /> : <TriangleAlert className="size-5" />}
              <div>
                <div className="text-sm font-semibold">{data.passed ? 'All checks passed' : `${failing.length} of ${data.checks.length} checks need attention`}</div>
                <div className="text-xs opacity-80">{data.checks.length} checks · {data.checks.reduce((n, c) => n + c.items.length, 0)} issues found</div>
              </div>
            </div>
            <ul className="space-y-2">
              {data.checks.map((c) => (
                <li key={c.check} className="rounded-lg border px-3.5 py-3">
                  <div className="flex items-start gap-2.5">
                    {c.items.length ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-ink">{c.title}</span>
                        <span className={cn('rounded-full px-2 py-px text-[11px] font-semibold tabular', c.items.length ? 'bg-warn-soft text-warn' : 'bg-muted text-muted-foreground')}>{c.items.length}</span>
                      </div>
                      <div className="text-[12px] text-muted-foreground">{c.description}</div>
                      {c.items.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {c.items.map((i) => <li key={i.code} className="text-[12.5px] text-foreground/85">• {i.name ?? i.code}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      }}
    </Panel>
  )
}
