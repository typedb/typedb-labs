import { Link } from 'react-router'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

/** Navigation placeholder for screens built in later phases. */
export function ComingSoon({ title, phase, icon: Icon, points }: { title: string; phase: string; icon: LucideIcon; points: string[] }) {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Icon className="size-7" /></div>
      <div className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-brand">{phase}</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-3 text-muted-foreground">This screen is part of the next phase of the demonstration.</p>
      <ul className="mx-auto mt-8 max-w-md space-y-2.5 text-left text-sm text-foreground/80">
        {points.map((p) => (
          <li key={p} className="flex gap-3 rounded-lg border bg-card px-4 py-3"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{p}</li>
        ))}
      </ul>
      <Link to="/" className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-ink hover:underline">
        <ArrowLeft className="size-4" />Back to Deal Overview
      </Link>
    </div>
  )
}
