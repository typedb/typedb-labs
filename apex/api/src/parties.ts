// The Parties pages: /api/register (everyone, with engagement), /api/parties/{code} (one profile) and
// /api/engagement-policy. Contacts are masked here, on the server; no full value ever leaves the API.

import * as engagement from "./engagement.ts";
import * as explorer from "./explorer.ts";
import * as queries from "./queries.ts";
import { CONDITIONS } from "./workstreams.ts";
import { count, maxBy, sorted } from "./py.ts";
import type { Tx } from "./typedb.ts";

const AR = ["A", "R"];

export function maskEmail(v: string | null): string | null {
  if (!v || !v.includes("@")) return null;
  const at = v.indexOf("@");
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  return `${local[0]}${"•".repeat(Math.max(3, local.length - 2))}${local[local.length - 1]}@${domain}`;
}

export function maskPhone(v: string | null): string | null {
  return v ? `${v.slice(0, -3)}•••` : null;
}

export interface Context {
  as_of: string;
  items: queries.Items;
  floats: ReturnType<typeof engagement.scheduleFloat>;
  people: queries.Person[];
  organisations: queries.OrganisationParty[];
  raci: queries.RaciRow[];
  events: queries.WorkstreamEvent[];
  engagement_types: Set<string>;
  outreach_types: Set<string>;
  reviews: { authority: string; clearance: string }[];
}

/** Everything the engagement calculation reads, in one READ transaction. */
export async function context(tx: Tx): Promise<Context> {
  const asOf = (await queries.deal(tx)).as_of;
  const items = await queries.allItems(tx);
  const floats = engagement.scheduleFloat(items, await queries.allDependencies(tx), await queries.allDeadlineLimits(tx),
    new Set(await queries.hardDependencyKinds(tx)));
  return {
    as_of: asOf, items, floats,
    people: await queries.people(tx), organisations: await queries.organisationParties(tx),
    raci: await queries.allRaci(tx), events: await queries.workstreamEvents(tx),
    engagement_types: await queries.subtypes(tx, queries.ENGAGEMENT_TYPES),
    outreach_types: await queries.subtypes(tx, queries.OUTREACH_TYPES),
    reviews: await queries.authorityReviews(tx),
  };
}

export function assess(ctx: Context, party: engagement.Party, employees: readonly string[] = []): engagement.Result {
  return engagement.assess(party, ctx.as_of, ctx.items, ctx.raci, ctx.events, ctx.engagement_types,
    ctx.reviews, ctx.floats, employees, null, ctx.outreach_types);
}

/** [party for engagement.assess, employees] for a person or organisation code, or [null, []]. */
export function partyOf(ctx: Context, code: string): [engagement.Party | null, string[]] {
  const orgs: Record<string, queries.OrganisationParty> = {};
  for (const o of ctx.organisations) orgs[o.code] = o;
  for (const p of ctx.people) {
    if (p.code === code) {
      const emp = p.employer;
      return [{ code, name: p.name, kind: "person", employer: emp ? emp.code : null,
        authority: Boolean(emp && orgs[emp.code]?.authority) }, []];
    }
  }
  if (code in orgs) {
    const o = orgs[code]!;
    const staff = ctx.people.filter((p) => p.employer && p.employer.code === code).map((p) => p.code);
    return [{ code, name: o.name, kind: "organisation", employer: null, authority: o.authority }, staff];
  }
  return [null, []];
}

/**
 * Items the party is Accountable or Responsible for that are at risk, delayed or overdue (delivery risk,
 * reported apart from engagement).
 */
function delivery(ctx: Context, code: string) {
  const out = [];
  for (const r of ctx.raci) {
    const it = ctx.items[r.item]!;
    if (r.holder !== code || !AR.includes(r.letter) || it.status === "complete") continue;
    const overdue = Boolean(it.due && it.due < ctx.as_of && it.type !== "deadline");
    if (engagement.PROBLEMS.includes(it.status ?? "") || overdue) {
      out.push({ code: r.item, name: it.name, status: it.status, due: it.due, reason: overdue ? "overdue" : it.status! });
    }
  }
  return sorted(out, (x) => [x.due || "", x.code]);
}

function summary(ctx: Context, party: engagement.Party, employees: readonly string[]) {
  const code = party.code;
  const items = ctx.items;
  const mine = ctx.raci.filter((r) => r.holder === code);
  const openMine = mine.filter((r) => items[r.item]!.status !== "complete");
  const result = assess(ctx, party, employees);
  const members = new Set([code, ...employees]);
  const engaged = ctx.events.filter((e) => members.has(e.actor.code) || e.attendees.some((a) => members.has(a.code)));
  const wss = new Set(mine.map((r) => items[r.item]!.workstream || r.item));
  const letters: Record<string, number> = {};
  for (const letter of "ARCI") letters[letter] = count(openMine, (r) => r.letter === letter);
  return [{
    engagement: { level: result.level, category: result.category, profile: result.profile, headline: result.headline,
      flags: result.flags, no_engagement_recorded: result.no_engagement_recorded },
    letters,
    outstanding: count(openMine, (r) => AR.includes(r.letter)),
    delivery_risk: delivery(ctx, code),
    workstreams: sorted([...wss].filter((w) => w && w.startsWith("WS-"))),
    last_activity: maxBy(engaged.map((e) => e.when), (w) => w) ?? null,
  }, result] as const;
}

export async function register(tx: Tx) {
  const ctx = await context(tx);
  const contacts = await queries.contacts(tx);
  const people = [];
  for (const p of ctx.people) {
    const [party, staff] = partyOf(ctx, p.code);
    const [s] = summary(ctx, party!, staff);
    const [email, phone] = contacts[p.code] ?? [null, null];
    people.push({ ...p, authority: party!.authority, ...s, contact: { email: maskEmail(email), phone: maskPhone(phone) } });
  }
  const organisations = [];
  for (const o of ctx.organisations) {
    const [party, staff] = partyOf(ctx, o.code);
    const [s] = summary(ctx, party!, staff);
    organisations.push({ ...o, people: staff.length, ...s });
  }
  const names: Record<string, string | null> = {};
  for (const w of await queries.workstreams(tx, ctx.items)) names[w.code] = w.name;
  return { as_of: ctx.as_of, people, organisations, workstream_names: names };
}

/** One party's profile, or null if no person or organisation has that code. */
export async function profile(tx: Tx, code: string) {
  const ctx = await context(tx);
  const [party, staff] = partyOf(ctx, code);
  if (party === null) return null;
  const items = ctx.items;
  const [s, result] = summary(ctx, party, staff);
  const names: Record<string, string | null> = {};
  for (const w of await queries.workstreams(tx, items)) names[w.code] = w.name;
  const members = new Set([code, ...staff]);
  const addressed = new Set([code, ...(party.employer ? [party.employer] : [])]);
  const assignments = [];
  for (const r of ctx.raci.filter((r) => r.holder === code)) {
    const it = items[r.item]!;
    const fl = ctx.floats[r.item];
    assignments.push({ item: r.item, name: it.name, type: it.type, letter: r.letter, via: r.via,
      status: it.status, due: it.due, criticality: it.criticality,
      workstream: { code: it.workstream || r.item, name: names[it.workstream || r.item] ?? null },
      float: fl?.float ?? null, float_deadline: fl?.deadline ?? null,
      simulate: CONDITIONS.includes(it.type) && it.status !== "complete" });
  }
  const ordered = sorted(assignments, (a) => [a.status === "complete", engagement.LETTER_ORDER.indexOf(a.letter), a.due || "", a.item]);
  const hits = (refs: queries.Ref[], set: Set<string>) => refs.some((r) => set.has(r.code));
  const history = ctx.events.filter((e) => members.has(e.actor.code) || hits(e.attendees, members)
    || hits(e.recipients, addressed) || hits(e.recipients, members));
  const both = new Set([...addressed, ...members]);
  const requestsTo = history.filter((e) => e.type === "request" && hits(e.recipients, both));
  const requestsFrom = history.filter((e) => e.type === "request" && members.has(e.actor.code));
  const node = await explorer.node(tx, code);
  let contact: { email: string | null; phone: string | null } | null = null;
  if (party.kind === "person") {
    const [email, phone] = (await queries.contacts(tx))[code] ?? [null, null];
    contact = { email: maskEmail(email), phone: maskPhone(phone) };
  }
  const person = ctx.people.find((p) => p.code === code) ?? null;
  const org = ctx.organisations.find((o) => o.code === code) ?? null;
  return {
    as_of: ctx.as_of, code, name: party.name, kind: party.kind, authority: party.authority,
    type: org ? org.type : "person", jurisdiction: org ? org.jurisdiction : null,
    title: person ? person.title : null, employer: person ? person.employer : null,
    contact, ...s, assessments: result.assessments,
    assignments: ordered, requests_to: requestsTo, requests_from: requestsFrom, history,
    people: ctx.people.filter((p) => staff.includes(p.code)),
    relations: node ? node.relations : [],
    workstream_names: names,
  };
}
