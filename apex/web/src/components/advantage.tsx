// The TypeDB Advantage panel: six short sections, each with evidence from Apex itself (schema excerpts read
// from the files that built the database, live figures from TypeDB, and links to working views). All content
// comes from /api/advantage; this component only lays it out and chooses where to open.
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ArrowUpRight, BookOpenCheck, Sparkles, X } from 'lucide-react'
import { useAdvantage, type Schemas } from '@/api/client'
import { PanelError } from '@/components/panel'
import { ScrollArea } from '@/components/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { TypeQLDrawer } from '@/components/typeql'
import { cn } from '@/lib/utils'

type Section = Schemas['AdvantageSection']
const SEEN_KEY = 'apex-advantage-seen'

/** Which section a page opens on (presentation only). */
export function sectionFor(pathname: string, search: string): string {
  const view = new URLSearchParams(search).get('view')
  if (pathname.startsWith('/impact')) return 'recursive-reasoning'
  if (pathname.startsWith('/explorer')) return view === 'group' ? 'recursive-reasoning' : 'typed-relationships'
  if (pathname.startsWith('/workstreams') || pathname.startsWith('/parties')) return 'polymorphism'
  if (pathname.startsWith('/analyst')) return 'ai-context'
  if (pathname.startsWith('/guide')) return 'application-complexity'
  return 'schema-constraints'
}

function seen() {
  try { return window.localStorage.getItem(SEEN_KEY) === '1' } catch { return true }
}

function markSeen() {
  try { window.localStorage.setItem(SEEN_KEY, '1') } catch { /* storage unavailable: the pulse simply shows again */ }
}

/** The top-right button, and the panel it opens. `?advantage=<section>` opens it at that section. */
export function Advantage() {
  const location = useLocation()
  const asked = new URLSearchParams(location.search).get('advantage')
  const [open, setOpen] = useState(Boolean(asked))
  const [pulse] = useState(() => !seen())
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (asked) setOpen(true) }, [asked])
  const close = () => { setOpen(false); markSeen(); setTimeout(() => button.current?.focus(), 0) }
  return (
    <>
      <button ref={button} type="button" onClick={() => { setOpen(!open); markSeen() }} aria-expanded={open} aria-controls="typedb-advantage"
        className={cn('inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[#b9a5e0]/50 bg-[#65459a]/25 px-2.5 py-1 font-medium whitespace-nowrap text-[#e7dcfb] hover:bg-[#65459a]/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cbb8ee]',
          pulse && !open && 'advantage-attention')}>
        <Sparkles className="size-3.5" aria-hidden /><span className="hidden min-[1400px]:inline">TypeDB advantage</span><span className="min-[1400px]:hidden" aria-hidden>Advantage</span>
        <span className="sr-only min-[1400px]:hidden">TypeDB advantage</span>
      </button>
      {open && <Panel section={asked ?? sectionFor(location.pathname, location.search)} onClose={close} />}
    </>
  )
}

function Panel({ section, onClose }: { section: string; onClose: () => void }) {
  const q = useAdvantage(true)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (q.data) setTimeout(() => document.getElementById(`advantage-${section}`)?.scrollIntoView({ block: 'start' }), 0)
  }, [q.data, section])
  const sections = q.data?.data.sections ?? []
  return (
    <aside id="typedb-advantage" role="dialog" aria-modal="false" aria-labelledby="advantage-title"
      className="fixed inset-y-0 right-0 z-50 flex w-[500px] max-w-full flex-col border-l border-typedb-line bg-card text-ink shadow-[-12px_0_32px_rgba(16,24,40,0.16)]">
      <header className="sticky top-0 z-10 border-b border-typedb-line bg-typedb-tint px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="advantage-title" ref={title} tabIndex={-1} className="flex items-center gap-2 text-[15px] font-semibold text-typedb outline-none">
              <Sparkles className="size-4" aria-hidden />What TypeDB does in this app
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-soft">Six points, each with its evidence from Apex: the schema, live figures and a working example.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close the TypeDB advantage panel (Escape)"
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-typedb-line bg-white px-2 py-1 text-[12.5px] font-medium text-typedb hover:bg-[#ede6f8] focus-visible:outline-2 focus-visible:outline-typedb">
            <X className="size-4" aria-hidden />Close
          </button>
        </div>
        <nav aria-label="Sections" className="mt-2.5 flex flex-wrap gap-1">
          {sections.map((s) => (
            <a key={s.key} href={`#advantage-${s.key}`} onClick={(e) => { e.preventDefault(); document.getElementById(`advantage-${s.key}`)?.scrollIntoView({ block: 'start' }) }}
              className={cn('rounded-full border px-2 py-0.5 text-[11.5px] font-medium focus-visible:outline-2 focus-visible:outline-typedb',
                s.key === section ? 'border-typedb bg-typedb text-white' : 'border-typedb-line bg-white text-typedb hover:bg-[#ede6f8]')}>{s.title}</a>
          ))}
        </nav>
      </header>
      <ScrollArea label="TypeDB advantage sections" className="flex-1" innerClassName="px-5 py-4" more="Scroll for more sections" done="End of the six sections">
        {q.isPending && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>}
        {q.isError && <PanelError message={q.error.message} />}
        <div className="space-y-6">
          {sections.map((s) => <SectionView key={s.key} s={s} current={s.key === section} onNavigate={onClose} />)}
        </div>
        <Link to="/guide" onClick={onClose} className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-typedb-line bg-typedb-tint px-4 py-2.5 text-[13px] font-medium text-typedb hover:bg-[#ede6f8]">
          <BookOpenCheck className="size-4" aria-hidden />Take the guided demonstration
        </Link>
      </ScrollArea>
      {q.data && <TypeQLDrawer envelope={q.data} note="The live figures above: type hierarchies, counts, the recursive downstream function and the data-quality checks, in one READ transaction." />}
    </aside>
  )
}

function SectionView({ s, current, onNavigate }: { s: Section; current: boolean; onNavigate: () => void }) {
  return (
    <section id={`advantage-${s.key}`} aria-labelledby={`advantage-${s.key}-title`} className={cn('scroll-mt-2 rounded-xl border p-4', current ? 'border-typedb/40 bg-typedb-tint/60' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`advantage-${s.key}-title`} className="text-[14px] font-semibold text-ink">{s.title}</h3>
        {current && <span className="rounded-full bg-typedb px-2 py-0.5 text-[10.5px] font-semibold text-white">Relevant to this page</span>}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{s.statement}</p>
      <div className="mt-3 space-y-2">
        {s.schema.map((x) => (
          <figure key={`${x.file}:${x.line}`}>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre text-ink">{x.text}</pre>
            <figcaption className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{x.file}:{x.line}</figcaption>
          </figure>
        ))}
      </div>
      <dl className="mt-3 space-y-1.5 text-[12.5px]">
        {s.live.map((f) => (
          <div key={f.label}><dt className="text-muted-foreground">{f.label}</dt><dd className="font-medium text-ink">{f.value}</dd></div>
        ))}
      </dl>
      {s.note && <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{s.note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {s.links.map((l) => (
          <Link key={l.to} to={l.to} onClick={onNavigate}
            className="inline-flex items-center gap-1 rounded-md border border-typedb-line bg-white px-2.5 py-1 text-[12.5px] font-medium text-typedb hover:bg-[#ede6f8] focus-visible:outline-2 focus-visible:outline-typedb">
            {l.label}<ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  )
}
