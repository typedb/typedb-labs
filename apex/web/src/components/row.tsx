// One convention for rows that open something: a pointer, a hover background, a visible focus ring,
// a chevron on hover or focus, and a restrained highlight when selected. Used by the Overview,
// the Gantt chart's panel links, the Impact Explorer and the Relationship Explorer.
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function rowClass(selected?: boolean, className?: string) {
  return cn('group cursor-pointer rounded-lg text-left transition-colors hover:bg-muted/70',
    'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand',
    selected && 'bg-brand-soft/70 ring-1 ring-brand/25 hover:bg-brand-soft', className)
}

export function RowChevron({ selected, className }: { selected?: boolean; className?: string }) {
  return (
    <ChevronRight aria-hidden className={cn('size-4 shrink-0 transition-opacity',
      selected ? 'text-brand opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100', className)} />
  )
}
