import { Briefcase, Building2, Landmark, Scale, Users } from 'lucide-react'
import { useParties, type Schemas } from '@/api/client'
import { Panel } from '@/components/panel'
import { StatusDot } from '@/components/status'
import { formatMoney, humanise, initials, plural } from '@/lib/format'

function Team({ people }: { people: Schemas['Person'][] }) {
  if (!people.length) return null
  return (
    <ul className="mt-3 space-y-1.5 border-t pt-3">
      {people.map((p) => (
        <li key={p.code} className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-foreground/70">{initials(p.name)}</span>
          <span className="min-w-0 truncate text-[12.5px]"><span className="font-medium text-ink">{p.name}</span> <span className="text-muted-foreground">· {p.title}</span></span>
        </li>
      ))}
    </ul>
  )
}

function OrgCard({ org, eyebrow, meta, children }: { org: Schemas['Organisation']; eyebrow: string; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-brand">{eyebrow}</div>
      <div className="mt-1 text-[14px] font-semibold text-ink">{org.name}</div>
      {meta && <div className="mt-0.5 text-[12px] text-muted-foreground">{meta}</div>}
      {children}
    </div>
  )
}

function Group({ icon: Icon, title, count, children }: { icon: typeof Users; title: string; count: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="text-[12px] text-muted-foreground">{count}</span>
      </div>
      {children}
    </section>
  )
}

/** Everyone on the deal, by the part they play. Teams are the people holding any RACI letter. */
export function Participants() {
  const q = useParties()
  return (
    <Panel title="Deal participants" icon={<Users />} query={q} skeletonRows={5}
      note="A mandate relates client, adviser and deal in one relation, and financing relates lender, borrower and purpose; each party comes back with its exact type."
      subtitle="Principals, advisers by mandate, lenders and authorities, with the people working on the deal"
      action={({ data }) => {
        const orgs = data.principals.length + data.advisers.length + data.lenders.length + data.authorities.length
        const people = new Set([...data.principals, ...data.advisers, ...data.lenders].flatMap((g) => g.team.map((p) => p.code))).size
        return <span className="text-xs text-muted-foreground"><span className="font-semibold text-ink">{orgs}</span> organisations · <span className="font-semibold text-ink">{people}</span> people</span>
      }}>
      {({ data }) => {
        const clients = [...new Map(data.advisers.map((a) => [a.client.code, a.client])).values()]
        return (
          <div className="space-y-7">
            <Group icon={Building2} title="Principals" count={plural(data.principals.length, 'company', 'companies')}>
              <div className="grid gap-3 md:grid-cols-2">
                {data.principals.map((p) => (
                  <OrgCard key={p.organisation.code} org={p.organisation} eyebrow={p.role} meta={`${p.organisation.sector} · ${p.organisation.jurisdiction}`}>
                    <Team people={p.team} />
                  </OrgCard>
                ))}
              </div>
            </Group>
            <Group icon={Briefcase} title="Advisers" count={plural(data.advisers.length, 'mandate')}>
              <div className="space-y-4">
                {clients.map((c) => (
                  <div key={c.code}>
                    <div className="mb-2 text-[12px] text-muted-foreground">Advising <span className="font-medium text-foreground">{c.name}</span></div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      {data.advisers.filter((a) => a.client.code === c.code).map((a) => (
                        <OrgCard key={a.mandate} org={a.organisation} eyebrow={humanise(a.type)} meta={a.mandate_type}><Team people={a.team} /></OrgCard>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Group>
            <div className="grid gap-7 *:min-w-0 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Group icon={Landmark} title="Lenders" count={plural(data.lenders.length, 'facility', 'facilities')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.lenders.map((l) => (
                    <OrgCard key={l.facility.code} org={l.organisation} eyebrow={humanise(l.type)}
                      meta={<><span className="font-semibold text-ink tabular">{formatMoney(l.facility.value, l.facility.currency)}</span> · {l.facility.name}</>}>
                      <Team people={l.team} />
                    </OrgCard>
                  ))}
                </div>
              </Group>
              <Group icon={Scale} title="Authorities" count={plural(data.authorities.length, 'body', 'bodies')}>
                <ul className="divide-y rounded-xl border">
                  {data.authorities.map((a) => (
                    <li key={a.organisation.code} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{a.organisation.jurisdiction}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink">{a.organisation.name}</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {a.reviews.length > 0
                            ? a.reviews.map((r) => <span key={r.code} className="mr-3 inline-flex items-center gap-1.5"><StatusDot status={r.status} />Reviews: {r.name}</span>)
                            : a.raci.length > 0 ? `Informed of: ${a.raci.map((r) => r.name).join(', ')}` : humanise(a.type)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Group>
            </div>
          </div>
        )
      }}
    </Panel>
  )
}
