import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Envelope } from '@/api/client'
import { TypeQLDrawer } from '@/components/typeql'
import { cn } from '@/lib/utils'

type PanelProps<T extends Envelope> = {
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  action?: ReactNode | ((result: T) => ReactNode)
  query: UseQueryResult<T>
  children: (result: T) => ReactNode
  className?: string
  bodyClassName?: string
  skeletonRows?: number
  /** Line 2 of "Show TypeQL": what this panel's queries retrieve or demonstrate. */
  note?: string
  /** Show only the queries behind this panel when several panels share one answer. */
  select?: (query: string) => boolean
}

/** A dashboard card for one API answer: loading and error states, and its "Show TypeQL" drawer. */
export function Panel<T extends Envelope>({ title, subtitle, icon, action, query, children, className, bodyClassName, skeletonRows = 4, note, select }: PanelProps<T>) {
  return (
    <Card className={cn('min-w-0 gap-0 overflow-hidden py-0 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]', className)}>
      <div className="flex items-start gap-3 px-6 pt-5 pb-4">
        {icon && <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand [&>svg]:size-4">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {query.data && action && <div className="shrink-0">{typeof action === 'function' ? action(query.data) : action}</div>}
      </div>
      <div className={cn('flex-1 px-6 pb-5', bodyClassName)}>
        {query.isPending && (
          <div className="space-y-3">{Array.from({ length: skeletonRows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        )}
        {query.isError && <PanelError message={query.error.message} />}
        {query.data && children(query.data)}
      </div>
      {query.data && <TypeQLDrawer envelope={query.data} note={note} select={select} />}
    </Card>
  )
}

export function PanelError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-risk-soft px-3.5 py-3 text-sm text-risk">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div><div className="font-medium">Couldn't load this panel</div><div className="text-risk/80">{message}</div></div>
    </div>
  )
}
