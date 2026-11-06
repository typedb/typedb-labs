// Shared page furniture, so all three screens open the same way.
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Title, one-line description and (optionally) controls on the right. */
export function PageHeader({ title, description, note, actions }: { title: string; description: string; note?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">{description}</p>
        {note && <div className="mt-2">{note}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

export type SegmentOption = { key: string; label: string; short?: string; icon?: LucideIcon }

/** A segmented switch (the Explorer's views, the Impact Explorer's approvals). */
export function Segmented({ options, value, onChange, label }: { options: SegmentOption[]; value: string; onChange: (key: string) => void; label: string }) {
  return (
    <div className="inline-flex w-full rounded-lg border bg-white p-1 shadow-sm lg:w-auto" role="tablist" aria-label={label}>
      {options.map(({ key, label: text, short, icon: Icon }) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)}
          className={cn('inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors lg:flex-none',
            value === key ? 'bg-ink text-white shadow-sm' : 'text-muted-foreground hover:text-ink')}>
          {Icon && <Icon className="size-4 shrink-0" />}
          {short ? <><span className="truncate sm:hidden">{short}</span><span className="hidden truncate sm:inline">{text}</span></> : <span className="truncate">{text}</span>}
        </button>
      ))}
    </div>
  )
}
