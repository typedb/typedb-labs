import { Activity as ActivityIcon, BadgeCheck, CalendarCheck, FilePen, FileText, Handshake, Megaphone, MessagesSquare, PenLine, RefreshCw, Send, TriangleAlert } from 'lucide-react'
import { useActivity } from '@/api/client'
import { Panel } from '@/components/panel'
import { ScrollArea } from '@/components/scroll-area'
import { formatDate, formatDateTime, initials } from '@/lib/format'
import { cn } from '@/lib/utils'

// Icons for event kinds. The kind itself, and everything else shown, comes from TypeDB.
const KIND_ICON: Record<string, typeof ActivityIcon> = {
  cleared: BadgeCheck, approved: CalendarCheck, filed: Send, signed: PenLine, consent: Handshake,
  announced: Megaphone, published: FileText, delivered: FilePen, meeting: MessagesSquare,
  update: RefreshCw, 'status-change': TriangleAlert,
}

/** Recent activity: the latest deal events, newest first. */
export function RecentActivity({ className, fill }: { className?: string; fill?: boolean }) {
  // With `fill`, the panel takes the height its column leaves (wide screens) and the list scrolls inside it.
  const q = useActivity(fill ? 30 : 8)
  return (
    <Panel title="Recent activity" icon={<ActivityIcon />} className={cn(fill && 'xl:min-h-0 xl:flex-1', className)} query={q} skeletonRows={6}
      bodyClassName={cn(fill && 'xl:relative xl:min-h-[420px] xl:px-0 xl:pb-0')}
      note="The latest events of every kind, found through the parent type deal-event, newest first, with who acted and on which item."
      subtitle="Latest recorded events across the deal, newest first">
      {({ data }) => (
        <ScrollArea label="Recent activity" className={cn(fill && 'xl:absolute xl:inset-0')} innerClassName={cn(fill && 'xl:px-6 xl:pt-1 xl:pb-4')}
          more="Scroll for older events" done={`End of the ${data.length} latest events`} hint={fill}>
        <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
          {data.map((e, n) => {
            const Icon = KIND_ICON[e.kind ?? ''] ?? ActivityIcon
            const showDay = n === 0 || formatDate(data[n - 1].when.slice(0, 10)) !== formatDate(e.when.slice(0, 10))
            return (
              <li key={`${e.when}-${n}`} className="relative flex gap-3">
                <div className="z-10 flex size-[31px] shrink-0 items-center justify-center rounded-full border bg-card text-brand"><Icon className="size-3.5" /></div>
                <div className="min-w-0 flex-1 pt-0.5">
                  {showDay && <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{formatDate(e.when.slice(0, 10))}</div>}
                  <div className="text-[13px] leading-snug text-ink">{e.summary}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[8px] font-semibold text-foreground/70">{initials(e.actor.name)}</span>
                    <span className="truncate">{e.actor.name}{e.actor.employer ? `, ${e.actor.employer}` : ''} · {formatDateTime(e.when).split(', ')[1]}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
        </ScrollArea>
      )}
    </Panel>
  )
}
