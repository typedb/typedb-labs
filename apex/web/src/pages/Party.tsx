import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Activity, ClipboardList, Route, FlaskConical, Inbox, ListChecks, Network, Send, ShieldCheck, Users } from 'lucide-react'
import { usePartyProfile, useRegister, type Schemas } from '@/api/client'
import { ItemDetail } from '@/components/gantt/item-detail'
import { Panel, PanelError } from '@/components/panel'
import { RowChevron, rowClass } from '@/components/row'
import { StatusBadge } from '@/components/status'
import { TypeQLDrawer } from '@/components/typeql'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AccessRequestDemo, Assessments, EngagementBadge, Flags } from '@/components/parties/engagement'
import { ActivityFeed } from '@/components/workstreams/feed'
import { inDays } from '@/components/workstreams/parts'
import { formatDate, humanise, plural } from '@/lib/format'
import { useSelectedItem } from '@/lib/selection'
import { cn } from '@/lib/utils'

type Profile = Schemas['PartyProfile']

// Which of the page's queries each section uses ("Show TypeQL" lists only those, with their own labels).
const isEngagement = (q: string) => /sub engagement|sub outreach|authority-review|deal-event|raci-assignment \(holder: \$h, item: \$i\); \$r isa! \$l;/.test(q)
const isResponsibilities = (q: string) => /raci-assignment \(holder: \$h, item: \$i\); \$r isa! \$l;|isa dependency|deadline-limit|sub hard-dependency|isa deal-item; \$x isa!/.test(q)
const isHistory = (q: string) => q.includes('deal-event')
const isRelations = (q: string) => q.includes('links ($myrole')

export function Party() {
  const { code } = useParams()
  const q = usePartyProfile(code)
  const [selected, select] = useSelectedItem()
  const navigate = useNavigate()
  if (q.isPending) return <div className="space-y-5"><Skeleton className="h-10 w-80" /><Skeleton className="h-72 w-full rounded-xl" /></div>
  if (q.isError) return <div className="space-y-4"><Back /><PanelError message={q.error.message} /></div>
  const p = q.data.data
  const open = p.assignments.filter((a) => a.status !== 'complete')
  const ar = open.filter((a) => a.letter === 'A' || a.letter === 'R')
  const ci = open.filter((a) => a.letter === 'C' || a.letter === 'I')
  const simulate = [...new Map(ar.filter((a) => a.simulate).map((a) => [a.item, a])).values()]

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Link to="/" className="hover:text-ink hover:underline">Deal Overview</Link><span aria-hidden>/</span>
        <Link to={`/parties${p.kind === 'organisation' ? '?tab=organisations' : ''}`} className="hover:text-ink hover:underline">Parties</Link><span aria-hidden>/</span>
        <span className="font-medium text-ink" aria-current="page">{p.name}</span>
      </nav>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="space-y-5 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">{p.name}</h1>
                <EngagementBadge level={p.engagement.level} category={p.engagement.category} />
              </div>
              <div className="mt-1.5 text-[14px] text-ink-soft">
                {p.kind === 'person'
                  ? <>{p.title}{p.employer && <>, <Link to={`/parties/${p.employer.code}`} className="font-medium text-brand hover:underline">{p.employer.name}</Link> <span className="text-muted-foreground">({humanise(p.employer.type)})</span></>}</>
                  : <>{humanise(p.type)}{p.jurisdiction ? ` · ${p.jurisdiction}` : ''}{p.authority ? ' · public authority' : ''}</>}
              </div>
              {p.contact && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
                  <span className="font-mono text-muted-foreground" title="Masked on the server">{p.contact.email}</span>
                  <span className="font-mono text-muted-foreground" title="Masked on the server">{p.contact.phone}</span>
                  <AccessRequestDemo />
                </div>
              )}
              {p.authority && (
                <p className="mt-2 max-w-2xl text-[12.5px] text-muted-foreground">
                  A real public body in an invented scenario: no individuals are recorded and no contact details exist. It is assessed against its
                  statutory timetable and the requests sent to it, never against silence.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-md lg:justify-end">
              <NavButton to={`/explorer?focus=${encodeURIComponent(p.kind === 'person' && p.employer ? p.employer.code : p.code)}`} icon={Network}>
                {p.kind === 'person' ? 'Their organisation in the Relationship Explorer' : 'In the Relationship Explorer'}
              </NavButton>
              <NavButton to={`/explorer?view=paths&from=${encodeURIComponent(p.code)}`} icon={Route}>Find connections</NavButton>
              {simulate.slice(0, 2).map((a) => (
                <NavButton key={a.item} to={`/impact?item=${encodeURIComponent(a.item)}`} icon={FlaskConical}>Simulate a delay: {a.name}</NavButton>
              ))}
            </div>
          </div>
          <div className="grid gap-4 border-t pt-4 md:grid-cols-[1fr_auto]">
            <div>
              <div className="text-[11.5px] font-medium text-muted-foreground">{p.engagement.profile} assessment</div>
              <p className="mt-0.5 max-w-4xl text-[13.5px] leading-relaxed text-ink">{p.engagement.headline}</p>
              {p.engagement.no_engagement_recorded && p.engagement.level !== 'unknown' && (
                <p className="mt-1 text-[12px] text-muted-foreground">No engagement by {p.name} is recorded anywhere on the deal yet.</p>
              )}
            </div>
            <div className="text-[12.5px] text-ink-soft md:text-right">
              <div><span className="font-semibold text-ink tabular">{p.outstanding}</span> open Accountable / Responsible</div>
              <div>{p.delivery_risk.length ? <span className="text-warn">{plural(p.delivery_risk.length, 'item')} at risk or late (delivery risk)</span> : 'No delivery risk on their items'}</div>
              <div className="text-muted-foreground">Last activity {p.last_activity ? formatDate(p.last_activity.slice(0, 10)) : 'none recorded'}</div>
            </div>
          </div>
          <Flags flags={p.engagement.flags} />
          {p.workstreams.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-muted-foreground">Works on:</span>
              {p.workstreams.map((w) => (
                <Link key={w} to={`/workstreams/${w}`} className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-0.5 font-medium text-ink-soft hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
                  <ListChecks className="size-3.5" aria-hidden />{p.workstream_names[w] ?? w}
                </Link>
              ))}
            </div>
          )}
        </div>
        <TypeQLDrawer envelope={q.data}
          note="Everything on this page in one READ transaction: the party, RACI assignments, every event, the schema's engagement and outreach types, authority reviews, the dependency data for schedule float, and relationships. Contacts are read separately and masked on the server." />
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-5 xl:col-span-7">
          <Panel title="Why: every finding and its records" icon={<ShieldCheck />} query={q} select={isEngagement}
            subtitle="Facts first (overdue responses), then inference (inactivity, deal risk). Select a record to open the item it concerns."
            note="Requests and their replies (reply relates two events), the schema's engagement subtypes, RACI letters from the relation's exact type, and authority reviews for the statutory profile.">
            {() => p.assessments.length
              ? <Assessments assessments={p.assessments} onItem={select} />
              : <p className="text-[13px] text-muted-foreground">Nothing to assess: no assignments and no requests to {p.name}.</p>}
          </Panel>
          <Responsibilities p={p} ar={ar} ci={ci} onSelect={select} q={q} />
        </div>
        <div className="min-w-0 space-y-5 xl:col-span-5">
          <Requests p={p} q={q} onSelect={select} />
          <Panel title="Engagement history" icon={<Activity />} query={q} select={isHistory} bodyClassName="px-0 pb-0"
            subtitle={`${plural(p.history.length, 'event')} they took part in, sent or received`}
            note="Every event where they acted, attended or were a recipient, through the parent type deal-event, with the request–response chain.">
            {() => p.history.length
              ? <ActivityFeed events={p.history} onSelect={select} asOf={p.as_of} />
              : <p className="px-6 pb-5 text-[13px] text-muted-foreground">No events recorded.</p>}
          </Panel>
          {p.kind === 'organisation' && <OrgPeople p={p} />}
          <Panel title="Relationships" icon={<Network />} query={q} select={isRelations}
            subtitle="Every relation this party plays a role in, with its role and the other players"
            note="Role-less matching ($r links ($myrole: $x)) returns every relation the party plays a role in, with the role name; RACI and events are listed elsewhere on this page.">
            {() => p.relations.length ? (
              <ul className="space-y-2">
                {p.relations.map((r) => (
                  <li key={r.key} className="rounded-lg border px-3 py-2 text-[12.5px]">
                    <div className="font-medium text-ink">{humanise(r.type)} <span className="font-normal text-muted-foreground">· as {humanise(r.role)}</span></div>
                    <div className="mt-0.5 text-ink-soft">
                      {r.others.map((o, n) => (
                        <span key={`${o.role}-${o.code}`}>{n > 0 && ' · '}{humanise(o.role)}:{' '}
                          {o.code?.startsWith('ORG-') || o.code?.startsWith('PER-')
                            ? <Link to={`/parties/${o.code}`} className="font-medium text-brand hover:underline">{o.name}</Link>
                            : <span className="font-medium">{o.name}</span>}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted-foreground">No relations recorded beyond employment and RACI.</p>}
          </Panel>
        </div>
      </div>
      <div><Back /></div>
      {selected && (
        <ItemDetail code={selected} asOf={p.as_of} onClose={() => select(undefined)} onSelect={select}
          onShowWorkstream={(w) => navigate(`/workstreams/${w}`)} />
      )}
    </div>
  )
}

type Assignment = Schemas['Assignment']

function Responsibilities({ p, ar, ci, onSelect, q }: { p: Profile; ar: Assignment[]; ci: Assignment[]; onSelect: (code: string) => void; q: ReturnType<typeof usePartyProfile> }) {
  const done = p.assignments.length - ar.length - ci.length
  return (
    <Panel title="Outstanding responsibilities" icon={<ClipboardList />} query={q} select={isResponsibilities}
      subtitle={`${plural(ar.length, 'open item')} as Accountable or Responsible · ${ci.length} as Consulted or Informed · ${done} complete`}
      note="RACI on every item through the parent type raci-assignment (the letter is the relation's exact type), with dates and statuses, and the dependencies and deadline limits behind each item's schedule float.">
      {() => (
        <div className="space-y-4">
          {ar.length ? (
            <ul className="divide-y rounded-lg border">
              {ar.map((a) => <AssignmentRow key={a.item + a.letter} a={a} asOf={p.as_of} onSelect={onSelect} />)}
            </ul>
          ) : <p className="text-[13px] text-muted-foreground">No open items as Accountable or Responsible.</p>}
          {ci.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[12.5px] font-medium text-brand">{plural(ci.length, 'open item')} as Consulted or Informed</summary>
              <ul className="mt-2 divide-y rounded-lg border">
                {ci.map((a) => <AssignmentRow key={a.item + a.letter} a={a} asOf={p.as_of} onSelect={onSelect} />)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  )
}

function AssignmentRow({ a, asOf, onSelect }: { a: Assignment; asOf: string; onSelect: (code: string) => void }) {
  const days = a.due ? Math.round((Date.parse(a.due) - Date.parse(asOf)) / 86_400_000) : null
  return (
    <li>
      <button type="button" onClick={() => onSelect(a.item)} className={rowClass(false, 'flex w-full items-start gap-3 rounded-none px-3 py-2.5')}
        aria-label={`${a.letter} on ${a.name}: ${humanise(a.status)}. Open details`}>
        <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold',
          a.letter === 'A' ? 'bg-ink text-white' : a.letter === 'R' ? 'bg-brand text-white' : 'bg-muted text-ink-soft')}>{a.letter}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium text-ink">{a.name}</span><StatusBadge status={a.status} /></span>
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
            {a.workstream.name} · {humanise(a.type)} · due {formatDate(a.due)}{days != null ? ` (${inDays(days)})` : ''}{a.via ? ' · under their firm’s mandate' : ''}
          </span>
          <span className="block text-[11.5px] text-muted-foreground">
            {a.float != null ? <>Schedule float <span className={cn('font-medium', a.float <= 30 ? 'text-risk' : a.float <= 60 ? 'text-warn' : 'text-ink-soft')}>{plural(a.float, 'day')}</span> before a contractual deadline breaks</>
              : a.type === 'deadline' ? 'A contractual deadline' : 'No contractual deadline within reach of a delay'}
            {a.criticality ? ` · assessed criticality ${a.criticality}` : ''}
          </span>
        </span>
        <RowChevron className="mt-1" />
      </button>
    </li>
  )
}

function Requests({ p, q, onSelect }: { p: Profile; q: ReturnType<typeof usePartyProfile>; onSelect: (code: string) => void }) {
  const row = (e: Schemas['WorkstreamEvent'], incoming: boolean) => {
    const answered = e.answered_by.length > 0
    const overdue = !answered && e.response_due && e.response_due < p.as_of
    return (
      <li key={e.code}>
        <button type="button" onClick={() => onSelect(e.item.code)} className={rowClass(false, 'flex w-full items-start gap-2 px-2 py-1.5')}>
          {incoming ? <Inbox className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Send className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] leading-snug text-ink">{e.summary}</span>
            <span className="block text-[11.5px] text-muted-foreground">
              {incoming ? `From ${e.actor.name}` : `To ${e.recipients.map((r) => r.name).join(', ')}`} · {formatDate(e.when.slice(0, 10))} · on {e.item.name}
            </span>
            {e.response_due && (
              <span className={cn('block text-[11.5px]', overdue ? 'font-medium text-risk' : answered ? 'text-ok' : 'text-ink-soft')}>
                Reply by {formatDate(e.response_due)} · {answered ? `answered ${e.answered_by.map((a) => formatDate(a.when.slice(0, 10))).join(', ')}` : overdue ? 'no response recorded, and the date has passed' : 'awaiting a response'}
              </span>
            )}
          </span>
          <RowChevron className="mt-0.5" />
        </button>
      </li>
    )
  }
  return (
    <Panel title="Requests" icon={<Inbox />} query={q} select={(s) => s.includes('deal-event')}
      subtitle={`${plural(p.requests_to.length, 'request')} to ${p.kind === 'person' ? 'them or their organisation' : 'them'} · ${plural(p.requests_from.length, 'request')} they sent`}
      note="Requests are outreach events with a reply-by date; a response is linked to the request it answers by the reply relation.">
      {() => (
        <div className="space-y-3">
          {p.requests_to.length > 0 && <ul className="space-y-0.5">{p.requests_to.map((e) => row(e, true))}</ul>}
          {p.requests_from.length > 0 && <ul className="space-y-0.5 border-t pt-2">{p.requests_from.map((e) => row(e, false))}</ul>}
          {!p.requests_to.length && !p.requests_from.length && <p className="text-[13px] text-muted-foreground">No requests recorded.</p>}
        </div>
      )}
    </Panel>
  )
}

function OrgPeople({ p }: { p: Profile }) {
  const register = useRegister()
  const levels = new Map(register.data?.data.people.map((x) => [x.code, x.engagement]) ?? [])
  return (
    <Panel title="People" icon={<Users />} query={register} select={(s) => s.includes('isa person')}
      subtitle={p.people.length ? `${plural(p.people.length, 'person', 'people')} at ${p.name} on the deal` : 'No individuals recorded'}
      note="The organisation's people through employment, each with the engagement assessment from the register.">
      {() => p.people.length ? (
        <ul className="space-y-1">
          {p.people.map((x) => {
            const e = levels.get(x.code)
            return (
              <li key={x.code}>
                <Link to={`/parties/${x.code}`} className={rowClass(false, 'flex items-center gap-3 px-2 py-1.5')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{x.name}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">{x.title}</span>
                  </span>
                  {e && <EngagementBadge level={e.level} category={e.category} />}
                  <RowChevron />
                </Link>
              </li>
            )
          })}
        </ul>
      ) : <p className="text-[13px] text-muted-foreground">{p.authority ? 'No individuals at real authorities are recorded (decision D7).' : 'No people recorded.'}</p>}
    </Panel>
  )
}

function NavButton({ to, icon: Icon, children }: { to: string; icon: typeof Network; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft shadow-sm hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
      <Icon className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{children}</span>
    </Link>
  )
}

function Back() {
  return <Link to="/parties" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"><ArrowLeft className="size-4" aria-hidden />All parties</Link>
}

