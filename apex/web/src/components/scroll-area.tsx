// A panel region that scrolls on its own, made discoverable and keyboard-accessible: it can take focus
// (arrow keys, Page Up/Down, Home/End then scroll it), shows a focus ring, fades the edges that have more
// content beyond them, and says so in words ("Scroll for more" / "End of list").
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronsLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Edges = { start: boolean; end: boolean }

export function ScrollArea({ label, children, className, innerClassName, axis = 'y', more = 'Scroll for more', done = 'End of list', hint = true, dark = false }: {
  label: string; children: ReactNode; className?: string; innerClassName?: string; axis?: 'x' | 'y'
  more?: string; done?: string; hint?: boolean; dark?: boolean
}) {
  const fade = dark ? 'from-[#0d1b2a]' : 'from-card'
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edges>({ start: false, end: false })
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const [pos, size, view] = axis === 'y' ? [el.scrollTop, el.scrollHeight, el.clientHeight] : [el.scrollLeft, el.scrollWidth, el.clientWidth]
      setOverflows(size > view + 1)
      setEdges({ start: pos > 1, end: pos + view < size - 1 })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => { el.removeEventListener('scroll', update); observer.disconnect() }
  }, [axis, children])

  const id = useRef(`scroll-${Math.random().toString(36).slice(2)}`).current
  const y = axis === 'y'
  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div ref={ref} tabIndex={overflows ? 0 : undefined} role="region" aria-label={label} aria-describedby={overflows && hint ? id : undefined}
        className={cn('min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
          y ? 'overflow-y-auto overscroll-contain' : 'overflow-x-auto', innerClassName)}>
        {children}
      </div>
      {/* Fades on the edges that have more beyond them. */}
      <div aria-hidden className={cn('pointer-events-none absolute transition-opacity', y ? 'inset-x-0 top-0 h-6 bg-gradient-to-b' : 'inset-y-0 left-0 w-6 bg-gradient-to-r',
        fade, 'to-transparent', edges.start ? 'opacity-100' : 'opacity-0')} />
      <div aria-hidden className={cn('pointer-events-none absolute transition-opacity', y ? 'inset-x-0 h-10 bg-gradient-to-t' : 'inset-y-0 right-0 w-8 bg-gradient-to-l',
        y && (hint && overflows ? 'bottom-7' : 'bottom-0'), fade, 'to-transparent', edges.end ? 'opacity-100' : 'opacity-0')} />
      {hint && overflows && (
        <div id={id} className={cn('flex shrink-0 items-center justify-center gap-1.5 border-t py-1.5 text-[11px]',
          dark ? 'border-white/10 text-slate-400' : 'border-border/60 text-muted-foreground')}>
          {y ? <ChevronDown className={cn('size-3.5', !edges.end && 'rotate-180')} aria-hidden /> : <ChevronsLeftRight className="size-3.5" aria-hidden />}
          <span>{edges.end ? more : done}</span>
          <span className="opacity-70">· arrow keys work when focused</span>
        </div>
      )}
    </div>
  )
}
