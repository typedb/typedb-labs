// Presentation only: turning values from the API into readable text. No business rules here.

const DAY_MS = 86_400_000

/** "2030-01-15" -> a Date at midnight UTC (dates in the data have no time zone). */
export function parseDate(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : `${iso}Z`)
}

export function formatDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '—'
  return parseDate(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', ...(opts.year === false ? {} : { year: 'numeric' }), timeZone: 'UTC',
  })
}

export function formatDateTime(iso: string): string {
  const d = parseDate(iso)
  return `${formatDate(iso, { year: false })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`
}

export function dayDiff(laterIso: string, earlierIso: string): number {
  return Math.round((parseDate(laterIso).getTime() - parseDate(earlierIso).getTime()) / DAY_MS)
}

function currencySymbol(currency: string): string {
  const part = new Intl.NumberFormat('en-GB', { style: 'currency', currency }).formatToParts(0)
    .find((p) => p.type === 'currency')
  return part?.value ?? `${currency} `
}

/** Exact decimal text ("1500000000") -> "£1.5bn"; "250000000" -> "£250m". */
export function formatMoney(value: string, currency: string | null | undefined): string {
  const n = Number(value)
  const symbol = currency ? currencySymbol(currency) : ''
  const trim = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 1 })
  if (Math.abs(n) >= 1e9) return `${symbol}${trim(n / 1e9)}bn`
  if (Math.abs(n) >= 1e6) return `${symbol}${trim(n / 1e6)}m`
  return `${symbol}${n.toLocaleString('en-GB')}`
}

export function formatPercent(stake: string): string {
  return `${(Number(stake) * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`
}

/** A TypeDB type or status word ("regulatory-clearance") as a label ("Regulatory clearance"). */
export function humanise(label: string | null | undefined): string {
  if (!label) return '—'
  const words = label.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.? /, '').split(/\s+/)
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
