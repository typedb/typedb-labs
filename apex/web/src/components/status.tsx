import { cn } from '@/lib/utils'
import { humanise } from '@/lib/format'

// Colours for the schema's status words. Which status an item has always comes from TypeDB.
export const STATUS_STYLE: Record<string, { dot: string; chip: string; bar: string }> = {
  complete: { dot: 'bg-ok', chip: 'bg-ok-soft text-ok ring-ok/20', bar: 'bg-ok' },
  'in-progress': { dot: 'bg-info', chip: 'bg-info-soft text-info ring-info/20', bar: 'bg-info' },
  'at-risk': { dot: 'bg-warn', chip: 'bg-warn-soft text-warn ring-warn/25', bar: 'bg-warn' },
  delayed: { dot: 'bg-risk', chip: 'bg-risk-soft text-risk ring-risk/20', bar: 'bg-risk' },
  'not-started': { dot: 'bg-idle', chip: 'bg-idle-soft text-idle ring-idle/20', bar: 'bg-idle/50' },
}
const FALLBACK = STATUS_STYLE['not-started']

export const STATUS_ORDER = ['complete', 'in-progress', 'at-risk', 'delayed', 'not-started']

export function StatusDot({ status, className }: { status?: string | null; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', (STATUS_STYLE[status ?? ''] ?? FALLBACK).dot, className)} />
}

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const style = STATUS_STYLE[status ?? ''] ?? FALLBACK
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', style.chip, className)}>
      <span className={cn('size-1.5 rounded-full', style.dot)} />
      {humanise(status)}
    </span>
  )
}

export function ProgressBar({ value, status, className }: { value: number; status?: string | null; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar"
      aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all', (STATUS_STYLE[status ?? ''] ?? FALLBACK).bar)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
