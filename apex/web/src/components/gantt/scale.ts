// The Gantt chart's time scale. Presentation only: every date it places comes from the API.
import { parseDate } from '@/lib/format'

const DAY_MS = 86_400_000

export type Zoom = 'fit' | 'months' | 'weeks'
/** Pixels per day for the fixed zoom levels; "fit" is measured from the available width. */
export const PX_PER_DAY: Record<Exclude<Zoom, 'fit'>, number> = { months: 4, weeks: 14 }

export type Scale = {
  start: number
  days: number
  ppd: number
  width: number
  /** x of the start of a day, in pixels from the chart's left edge. */
  x: (iso: string) => number
}

/** A scale covering whole months, from the month of the earliest date to the end of the latest. */
export function makeScale(dates: string[], ppd: number): Scale {
  const times = dates.map((d) => parseDate(d).getTime())
  const first = new Date(Math.min(...times))
  const last = new Date(Math.max(...times) + 10 * DAY_MS)   // room for the last marker and its label
  const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1)
  const days = Math.round((end - start) / DAY_MS)
  return { start, days, ppd, width: days * ppd, x: (iso) => ((parseDate(iso).getTime() - start) / DAY_MS) * ppd }
}

export function spanDays(dates: string[]): number {
  return makeScale(dates, 1).days
}

/** Month boundaries inside the scale, labelled; the year is shown on January and on the first month. */
export function monthTicks(scale: Scale) {
  const out: { x: number; width: number; label: string }[] = []
  const d = new Date(scale.start)
  let first = true
  while (d.getTime() < scale.start + scale.days * DAY_MS) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    const x = ((d.getTime() - scale.start) / DAY_MS) * scale.ppd
    const width = ((next.getTime() - d.getTime()) / DAY_MS) * scale.ppd
    const month = d.toLocaleDateString('en-GB', { month: width < 34 ? 'narrow' : 'short', timeZone: 'UTC' })
    const year = first || d.getUTCMonth() === 0
    const label = !year ? month : width >= 64 ? `${month} ${d.getUTCFullYear()}` : `${month} ’${String(d.getUTCFullYear()).slice(2)}`
    out.push({ x, width, label })
    first = false
    d.setTime(next.getTime())
  }
  return out
}

/** Mondays inside the scale (for the weeks zoom). */
export function weekTicks(scale: Scale) {
  const out: { x: number; label: string }[] = []
  const d = new Date(scale.start)
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7))
  while (d.getTime() < scale.start + scale.days * DAY_MS) {
    out.push({ x: ((d.getTime() - scale.start) / DAY_MS) * scale.ppd, label: String(d.getUTCDate()) })
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return out
}

/** Spread labels over as few lanes as possible so none overlap (greedy, left to right). */
export function lanes<T extends { x: number }>(labels: T[], width: number): (T & { lane: number })[] {
  const ends: number[] = []
  return [...labels].sort((a, b) => a.x - b.x).map((label) => {
    let lane = ends.findIndex((end) => end <= label.x)
    if (lane === -1) lane = ends.length
    ends[lane] = label.x + width
    return { ...label, lane }
  })
}
