// Connection paths between two things on the deal (/api/connections, decision D12, docs/phase6-plan.md §7).
//
// Fixed-depth TypeQL (one query per path length, 1 to 3 relations) finds every simple path through entities
// only, so the transaction itself (a relation) is never a stepping stone and "both are on the deal" is never
// offered as a connection. The paths are ranked here by a stated cost (config/connection-policy.yaml), the
// best kept, and each step explained in words from the relation's type, the roles used and its attributes.

import { Dec } from "./decimal.ts";
import { CONNECTION_POLICY } from "./generated/assets.ts";
import * as queries from "./queries.ts";
import { dayMonthYear, formatG, PyFloat, pyRoundTo, sorted } from "./py.ts";
import { decimalText, iid, label, value, type Tx } from "./typedb.ts";

export const EVENT_TYPES = ["request", "response", "meeting", "delivery", "decision", "notice", "status-change"];
export const DISCLAIMER = "A path shows records that connect these two. It does not imply a legal or commercial relationship "
  + "beyond what each record states.";
const LETTERS: Record<string, string> = { accountability: "Accountable", responsibility: "Responsible", consultation: "Consulted", notification: "Informed" };

// How each relation reads, from the roles of its players. {role} is replaced by the player's name.
const TEMPLATES: Record<string, string> = {
  acquisition: "{acquirer} is acquiring {target}",
  employment: "{employee} works for {employer}",
  mandate: "{adviser} advises {client}",
  financing: "{lender} lends to {borrower}",
  "authority-review": "{reviewer} reviews {subject}, applied for by {applicant}",
  ownership: "{owner} owns {stake} of {owned}",
  "bound-by": "{obligor} is bound by {obligation}",
  "consent-right": "{obligation} needs the consent of {grantor}",
  "deadline-limit": "{limited-item} must happen by {deadline}",
  "risk-exposure": "the risk “{risk}” threatens {exposed}",
  "risk-ownership": "{risk-owner} owns the risk “{owned-risk}”",
  sequencing: "{prerequisite} must be complete before {dependent}",
  gating: "{prerequisite} must be satisfied before {dependent}",
  informing: "{prerequisite} informs {dependent} (information only; it does not move dates)",
  "work-breakdown": "{part} is part of the {whole} workstream",
};
const ROLE_ALIASES: Record<string, string> = { "accountable-item": "item", buyer: "acquirer", seller: "target" };

export interface Policy {
  hop_cost: number;
  hub_penalty: number;
  relation_weights: Record<string, number>;
  max_hops: number;
  row_cap: number;
  budget_ms: number;
  default_results: number;
  max_results: number;
  event_max_hops: number;
  hub_note_links: number;
}

let loaded: Policy | undefined;

export function policy(): Policy {
  return (loaded ??= CONNECTION_POLICY as Policy);
}

function role(roleLabel: string): string {
  const r = roleLabel.split(":").pop()!;
  return ROLE_ALIASES[r] ?? r;
}

function kind(typeLabel: string): string {
  if (typeLabel === "person") return "person";
  if (typeLabel === "risk") return "risk";
  if (typeLabel === "workstream") return "workstream";
  if (["activity", "milestone", "regulatory-clearance", "shareholder-approval", "court-sanction", "covenant", "deadline"].includes(typeLabel)) return "item";
  return "organisation";
}

export interface Node {
  code: string;
  name: string;
  type: string;
  kind: string;
}

export function node(things: Record<string, queries.Connectable>, code: string): Node {
  const t = things[code] ?? { code, name: code, type: "unknown" };
  return { ...t, kind: kind(t.type) };
}

/** Unknown code: nothing with it can be connected (the API answers 404). */
export class UnknownCode extends Error {}

/** A bad option (the API answers 422). */
export class BadOption extends Error {}

interface Candidate {
  iids: string[];
  types: string[];
  stones: string[];
  cost: number;
}

function cost(p: Policy, types: string[], stones: string[], links: Record<string, number>): number {
  let total = p.hop_cost * types.length + types.reduce((acc, t) => acc + (p.relation_weights[t] ?? 1.0), 0);
  for (const s of stones) total += p.hub_penalty * Math.log2(1 + (links[s] ?? 0));
  return pyRoundTo(total, 4);
}

/** Activity records are interactions: usable only when asked for, and only in short paths. */
function allowed(p: Policy, rtype: string, hops: number, activity: boolean): boolean {
  return !EVENT_TYPES.includes(rtype) || (activity && hops <= p.event_max_hops);
}

/**
 * Paths from a to b, best first. Throws UnknownCode for an unknown code and BadOption for bad options.
 *
 * Met in the middle: one query for each end's neighbours gives every one- and two-step path; for three
 * steps, one more query finds the relations joining the two neighbour sets. Simple paths only (no thing
 * or relation twice), checked here on each relation's identity.
 */
export async function find(tx: Tx, a: string, b: string, maxHops = 3, results: number | null = null, activity = true, workstreams = false) {
  const p = policy();
  results = results || p.default_results;
  if (!(maxHops >= 1 && maxHops <= p.max_hops) || !(results >= 1 && results <= p.max_results)) {
    throw new BadOption(`max_hops must be 1–${p.max_hops} and results 1–${p.max_results}`);
  }
  if (a === b) throw new BadOption("choose two different things");
  const things = await queries.connectables(tx);
  for (const code of [a, b]) if (!(code in things)) throw new UnknownCode(code);
  const links = await queries.entityLinks(tx);
  const started = performance.now();

  const hopRows = async (code: string) => (await tx.rows(queries.neighboursQuery(code, workstreams))).map(queries.hopRow);
  const na = await hopRows(a);
  const nb = await hopRows(b);
  const byEnd: Record<string, [string, string][]> = {};
  for (const [i, t, m] of nb) (byEnd[m] ??= []).push([i, t]);
  const candidates: Candidate[] = [];

  const add = (iids: string[], types: string[], stones: string[]) => {
    candidates.push({ iids, types, stones, cost: cost(p, types, stones, links) });
  };

  for (const [i, t, m] of na) { // one step: a relation joining a and b
    if (m === b && allowed(p, t, 1, activity)) add([i], [t], []);
  }
  const depths: { hops: number; paths: number; capped: boolean; skipped: boolean; note: string | null }[] =
    [{ hops: 1, paths: candidates.length, capped: false, skipped: false, note: null }];
  if (maxHops >= 2) { // two steps: a shared neighbour
    const before = candidates.length;
    for (const [i1, t1, m] of na) {
      if (m === a || m === b || !allowed(p, t1, 2, activity)) continue;
      for (const [i2, t2] of byEnd[m] ?? []) {
        if (i2 !== i1 && allowed(p, t2, 2, activity)) add([i1, i2], [t1, t2], [m]);
      }
    }
    depths.push({ hops: 2, paths: candidates.length - before, capped: false, skipped: false, note: null });
  }
  if (maxHops >= 3) { // three steps: neighbours joined in the middle
    const spent = performance.now() - started;
    const starts = new Set(na.filter(([, t, m]) => m !== a && m !== b && allowed(p, t, 3, activity)).map(([, , m]) => m));
    const ends = new Set(nb.filter(([, t, m]) => m !== a && m !== b && allowed(p, t, 3, activity)).map(([, , m]) => m));
    if (spent > p.budget_ms) {
      depths.push({ hops: 3, paths: 0, capped: false, skipped: true,
        note: `Skipped: the time budget (${p.budget_ms} ms) was used by shorter paths.` });
    } else if (starts.size && ends.size) {
      const fromA: Record<string, [string, string][]> = {};
      for (const [i, t, m] of na) if (allowed(p, t, 3, activity)) (fromA[m] ??= []).push([i, t]);
      const before = candidates.length;
      const middle = await tx.rows(queries.middleQuery(sorted(starts), sorted(ends), workstreams, p.row_cap));
      for (const r of middle) {
        const i2 = iid(r, "r");
        const t2 = label(r, "t");
        const m = value<string>(r, "mc");
        const n = value<string>(r, "nc");
        if (new Set([a, b, m, n]).size < 4) continue;
        for (const [i1, t1] of fromA[m] ?? []) {
          for (const [i3, t3] of byEnd[n] ?? []) {
            if (new Set([i1, i2, i3]).size === 3 && allowed(p, t3, 3, activity)) add([i1, i2, i3], [t1, t2, t3], [m, n]);
          }
        }
      }
      depths.push({ hops: 3, paths: candidates.length - before, capped: middle.length >= p.row_cap, skipped: false, note: null });
    } else {
      depths.push({ hops: 3, paths: 0, capped: false, skipped: false, note: null });
    }
  }
  const ranked = sorted(candidates, (c) => [c.cost, c.types.length, [...c.stones], c.types, c.iids]);
  const best = ranked.slice(0, results);
  const rest = ranked.slice(results);

  const details = await relationDetails(tx, sorted(new Set(best.flatMap((c) => c.iids))));
  const deal = await queries.deal(tx); // the transaction is a relation: named for context, never a step
  const named: Record<string, queries.Connectable> = { ...things, [deal.code]: { code: deal.code, name: deal.name ?? "", type: "acquisition" } };
  const paths = best.map((c, n) => explain(c, n + 1, a, b, named, links, details, p));
  const groups: Record<string, number> = {};
  for (const c of rest) {
    const key = c.stones.length ? c.stones[0]! : "direct";
    groups[key] = (groups[key] ?? 0) + 1;
  }
  const more = sorted(Object.entries(groups).map(([k, n]) => ({ through: k !== "direct" ? node(things, k) : null, count: n })),
    (g) => [-g.count, g.through ? g.through.name : ""]);
  return { from: node(things, a), to: node(things, b), max_hops: maxHops, activity, workstreams,
    total: candidates.length, paths, more, depths,
    elapsed_ms: pyRoundTo(performance.now() - started, 1), disclaimer: DISCLAIMER };
}

type Attr = string | number | boolean | null;

interface Details {
  players: [string, string][];
  attributes: Record<string, Attr>;
}

/** {iid: {players: [[role, code]], attributes: {type: value}}} for the relations on the best paths. */
async function relationDetails(tx: Tx, iids: string[]): Promise<Record<string, Details>> {
  const out: Record<string, Details> = {};
  for (const i of iids) out[i] = { players: [], attributes: {} };
  if (!iids.length) return out;
  for (const r of await tx.rows(queries.relationPlayersQuery(iids))) {
    out[iid(r, "r")]!.players.push([role(label(r, "role")), value<string>(r, "c")]);
  }
  for (const r of await tx.rows(queries.relationAttributesQuery(iids))) {
    const attr = r.attr!;
    if (!("value" in attr) || !("type" in attr)) continue;
    out[iid(r, "r")]!.attributes[attr.type.label] = attrValue(attr.value, attr.valueType);
  }
  for (const d of Object.values(out)) {
    const unique = new Map(d.players.map((pl) => [`${pl[0]}\u0000${pl[1]}`, pl]));
    d.players = sorted(unique.values(), (pl) => pl);
  }
  return out;
}

/** An attribute value as the original backend's driver gave it: decimals in short form, datetimes with their nanoseconds. */
function attrValue(v: unknown, valueType: string): Attr {
  if (valueType === "decimal") return Dec.of(decimalText(v)).toString();
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) return v;
  return String(v);
}

const KEPT = ["code", "summary", "occurred-at", "stake", "lag-days", "mandate-type", "job-title", "review-phase", "legal-basis"];

function explain(c: Candidate, rank: number, a: string, b: string, things: Record<string, queries.Connectable>,
  links: Record<string, number>, details: Record<string, Details>, p: Policy) {
  const nodes = [a, ...c.stones, b];
  const steps = [];
  const notes: string[] = [];
  for (let i = 0; i < c.iids.length; i++) {
    const d = details[c.iids[i]!]!;
    const rtype = c.types[i]!;
    const frm = nodes[i]!;
    const to = nodes[i + 1]!;
    const rolesOf: Record<string, string[]> = {};
    for (const [r, code] of d.players) (rolesOf[code] ??= []).push(r);
    const attrs = d.attributes;
    const kept: Record<string, Attr> = {};
    for (const [k, v] of Object.entries(attrs)) if (KEPT.includes(k)) kept[k] = v;
    steps.push({
      from: frm, to, type: rtype, code: (attrs.code ?? null) as string | null,
      from_role: (rolesOf[frm] ?? ["?"])[0]!, to_role: (rolesOf[to] ?? ["?"])[0]!,
      sentence: sentence(rtype, d.players, frm, to, attrs, things),
      others: d.players.filter(([, code]) => code !== frm && code !== to).map(([r, code]) => ({ role: r, code, name: things[code]?.name || code })),
      attributes: kept,
    });
  }
  for (const s of c.stones) {
    if ((links[s] ?? 0) >= p.hub_note_links) notes.push(`Goes through ${things[s]!.name}, a hub with ${links[s]} links: the connection may be general.`);
  }
  if (c.types.some((t) => EVENT_TYPES.includes(t))) {
    notes.push("Includes an activity record (a meeting, request or other event): an interaction, not a standing relationship.");
  }
  if (c.types.includes("work-breakdown")) notes.push("Includes a shared workstream: being in the same workstream is a weak connection.");
  return { rank, hops: c.types.length, cost: new PyFloat(c.cost), direct: c.types.length === 1,
    nodes: nodes.map((n) => node(things, n)), steps, notes,
    text: [things[a]!.name, ...c.types.map((t, i) => `[${t}] ${things[nodes[i + 1]!]!.name}`)].join(" → ") };
}

function sentence(rtype: string, players: [string, string][], frm: string, to: string, attrs: Record<string, Attr>,
  things: Record<string, queries.Connectable>): string {
  const name = (code: string) => things[code]?.name || code;
  const byRole: Record<string, string[]> = {};
  for (const [r, code] of players) (byRole[r] ??= []).push(code);
  const ends = new Set([frm, to]);

  const fill = (r: string): string => {
    const codes = byRole[r] ?? [];
    const inEnds = codes.filter((c) => ends.has(c));
    const pick = inEnds.length ? inEnds : codes;
    return pick.length ? name(pick[0]!) : r;
  };

  if (rtype in LETTERS) {
    return `${fill("holder")} is ${LETTERS[rtype]} for ${fill("item")}` + (byRole.via ? " (under their firm’s mandate)" : "");
  }
  if (rtype in TEMPLATES) {
    let text = TEMPLATES[rtype]!;
    for (const r of sorted(Object.keys(byRole), (r) => -r.length)) text = text.replaceAll("{" + r + "}", fill(r));
    text = text.replaceAll("{stake}", "stake" in attrs ? `${formatG(Number(attrs.stake) * 100)}%` : "a share");
    const lag = attrs["lag-days"];
    if ((rtype === "sequencing" || rtype === "gating") && lag) text += `, with a ${lag}-day lag`;
    if (rtype === "employment" && attrs["job-title"]) text += ` as ${attrs["job-title"]}`;
    if (rtype === "mandate" && attrs["mandate-type"]) text += ` (${attrs["mandate-type"]})`;
    return text;
  }
  if (EVENT_TYPES.includes(rtype)) {
    const when = String(attrs["occurred-at"] ?? "").slice(0, 10);
    const what = `the ${rtype.replace(/-/g, " ")} “${attrs.summary ?? ""}”` + (when ? ` on ${dayMonthYear(when)}` : "");
    const roles: Record<string, string> = {};
    for (const [r, code] of players) if (ends.has(code)) roles[code] = r;
    const rf = roles[frm];
    const rt = roles[to];
    if (rtype === "request" && new Set([rf, rt]).size === 2 && [rf, rt].every((r) => r === "actor" || r === "recipient")) {
      const [sender, receiver] = rf === "actor" ? [frm, to] : [to, frm];
      return `${name(sender)} sent ${name(receiver)} ${what}`;
    }
    if (rtype === "meeting" && (rf === "actor" || rf === "attendee") && (rt === "actor" || rt === "attendee")) {
      return `${name(frm)} and ${name(to)} were both at ${what}`;
    }
    if ([rf, rt].includes("agenda-item") || [rf, rt].includes("subject")) {
      const item = rf === "agenda-item" || rf === "subject" ? frm : to;
      const person = item === frm ? to : frm;
      const verb = roles[item] === "agenda-item" ? "discussed" : "is about";
      return `${what[0]!.toUpperCase()}${what.slice(1)} ${verb} ${name(item)}; ${name(person)} took part as ${roles[person]}`;
    }
    return `${name(frm)} (${rf}) and ${name(to)} (${rt}) both appear in ${what}`;
  }
  const mine = players.find(([, code]) => code === frm);
  return `${name(frm)} (${Object.keys(byRole).length && mine ? mine[0] : "?"}) is linked to ${name(to)} by ${rtype}`;
}
