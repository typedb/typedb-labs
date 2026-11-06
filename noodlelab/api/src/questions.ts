// Named questions for the Questions tab: each shows a TypeDB capability that goes beyond looking up one part.
//
// Every question is read-only TypeQL against the live database; the answer carries a short summary, a table,
// the component ids to highlight in 3D, and (through the API) the exact TypeQL with its timing. The titles and
// explanations below describe the questions, not the vehicle: every fact in an answer comes from TypeDB.

import { Double, pythonG } from "./json.ts";
import type { QuestionMeta, QuestionResult } from "./models.ts";
import { sortBy, sorted } from "./python.ts";
import { label, NotFound, type Doc } from "./queries.ts";
import { value, type ConceptRow, type Tx } from "./typedb.ts";

type Answer = Pick<QuestionResult, "summary" | "columns" | "rows" | "highlight">;

/** A number from a reduce answer (sums of doubles come back as doubles, counts as integers). */
function num(row: ConceptRow, column: string): number {
  return value<number>(row, column);
}

/** A sum of doubles, written with a decimal point as Python's float was. */
const dbl = (n: number) => new Double(n);

export async function packEnergy(tx: Tx): Promise<Answer> {
  const r = (await tx.rows(`
        match $m isa battery-module, has energy-capacity-kwh $e, has nominal-voltage-v $v;
        reduce $kwh = sum($e), $volts = sum($v), $modules = count;
    `, "sum energy and voltage over every battery module, in TypeDB"))[0];
  const ids = await tx.docs<Doc>('match $m isa battery-module; fetch { "id": $m.component-id };', "the battery modules, to highlight",
    true);
  const kwh = num(r, "kwh"), volts = num(r, "volts"), n = Math.trunc(num(r, "modules"));
  return { summary: `${pythonG(kwh)} kWh from ${n} modules; ${pythonG(volts)} V with the modules in series`,
    columns: ["Modules", "Energy (kWh)", "Voltage in series (V)"], rows: [[n, dbl(kwh), dbl(volts)]],
    highlight: ids.map((i) => i.id) };
}

export async function drivePower(tx: Tx): Promise<Answer> {
  const r = (await tx.rows(`
        match $m isa electric-motor, has peak-power-kw $p, has peak-torque-nm $t;
        reduce $kw = sum($p), $nm = sum($t), $motors = count;
    `, "sum peak power and torque over every electric motor, in TypeDB"))[0];
  const motors = await tx.docs<Doc>(`
        match $m isa electric-motor, has peak-power-kw $p, has peak-torque-nm $t;
        fetch { "id": $m.component-id, "name": $m.name, "kw": $p, "nm": $t };
    `, "each motor's own figures", true);
  return { summary: `${pythonG(num(r, "kw"))} kW and ${pythonG(num(r, "nm"))} N·m peak from ${Math.trunc(num(r, "motors"))} motors`,
    columns: ["Motor", "Peak power (kW)", "Peak torque (N·m)"],
    rows: sortBy(motors, (m) => m.name).map((m) => [m.name, dbl(m.kw), dbl(m.nm)]),
    highlight: motors.map((m) => m.id) };
}

export async function sensorsByType(tx: Tx): Promise<Answer> {
  const counts = await tx.docs<Doc>(`
        match $x isa sensor; $x isa! $type;
        reduce $n = count groupby $type;
        fetch { "type": $type, "n": $n };
    `, "count sensors by most specific type, in TypeDB");
  const ids = await tx.docs<Doc>('match $x isa sensor; fetch { "id": $x.component-id };', "every instance of the abstract type sensor",
    true);
  const table = sortBy(counts.map((c) => [label(c.type), c.n as number] as [string, number]), (r) => [-r[1], r[0]]);
  return { summary: `${ids.length} sensors of ${table.length} types, found with one query for the abstract type 'sensor'`,
    columns: ["Type", "Count"], rows: table, highlight: ids.map((i) => i.id) };
}

export async function multiSystem(tx: Tx): Promise<Answer> {
  let found = await tx.docs<Doc>(`
        match $c isa component; system-membership (system: $s, member: $c);
        reduce $n = count groupby $c;
        match $n > 1;
        fetch { "id": $c.component-id, "name": $c.name, "systems": $n,
                "names": [ match system-membership (system: $s2, member: $c); fetch { "name": $s2.name }; ] };
    `, "count each part's system memberships, keep those above one", true);
  found = sortBy(found, (f) => [-f.systems, f.name]);
  return { summary: `${found.length} parts serve more than one functional system`,
    columns: ["Part", "Systems"],
    rows: found.map((f) => [f.name, sorted((f.names as Doc[]).map((n) => n.name as string)).join(", ")]),
    highlight: found.map((f) => f.id) };
}

export async function sharedSensors(tx: Tx): Promise<Answer> {
  let found = await tx.docs<Doc>(`
        match $x isa sensor; $loop isa control-loop, links (sensor: $x);
        reduce $n = count groupby $x;
        match $n > 1;
        fetch { "id": $x.component-id, "name": $x.name, "loops": $n,
                "names": [ match $l isa control-loop, links (sensor: $x); fetch { "name": $l.name }; ] };
    `, "count each sensor's control loops, keep those above one", true);
  found = sortBy(found, (f) => f.name);
  return { summary: `${found.length} sensors feed more than one control loop`,
    columns: ["Sensor", "Control loops"],
    rows: found.map((f) => [f.name, sorted((f.names as Doc[]).map((n) => n.name as string)).join(", ")]),
    highlight: found.map((f) => f.id) };
}

export async function connectionsByKind(tx: Tx): Promise<Answer> {
  const counts = await tx.docs<Doc>(`
        match $r isa! $kind; $kind sub connection;
        reduce $n = count groupby $kind;
        fetch { "kind": $kind, "n": $n };
    `, "count connections by their most specific relation type");
  const table = sortBy(counts.map((c) => [label(c.kind).replace("-connection", ""), c.n as number] as [string, number]), (r) => -r[1]);
  return { summary: `${table.reduce((sum, r) => sum + r[1], 0)} connections of ${table.length} kinds (subtypes of one relation type)`,
    columns: ["Kind", "Count"], rows: table, highlight: [] };
}

interface Edge extends Doc {
  from: string;
  "from-name": string;
  function: string;
  to: string;
  "to-name": string;
  needs: string;
}

function byFrom(edges: Edge[]): Map<string, Edge[]> {
  const out = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
  }
  return out;
}

export async function batteryToWheel(tx: Tx): Promise<Answer> {
  const edges = await tx.docs<Edge>(`
        match
          $end isa component, has component-id "tyre-fl";
          let $c, $f, $p, $g in requirement_steps($end);
        fetch { "from": $c.component-id, "from-name": $c.name, "function": $f.function-name,
                "to": $p.component-id, "to-name": $p.name, "needs": $g.function-name };
    `, "every requirement step behind the tyre, through the recursive function requirement_steps", true);
  tx.note("TypeScript searches the returned steps breadth first for the shortest chain to a battery module.");
  // Shortest chain of requirements from the tyre back to a battery module (breadth first).
  const from = byFrom(edges);
  let frontier = ["tyre-fl"];
  const came = new Map<string, Edge | null>([["tyre-fl", null]]);
  let target: string | null = null;
  while (frontier.length && !target) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const e of from.get(node) ?? []) {
        if (!came.has(e.to)) {
          came.set(e.to, e);
          if (e.to.startsWith("battery-module-")) {
            target = e.to;
            break;
          }
          next.push(e.to);
        }
      }
      if (target) break;
    }
    frontier = next;
  }
  if (!target) return { summary: "No path found", columns: [], rows: [], highlight: [] };
  const chain: Edge[] = [];
  let node = target;
  while (came.get(node)) {
    chain.push(came.get(node)!);
    node = came.get(node)!.from;
  }
  chain.reverse();
  const table = [...chain].reverse().map((e, i) => [i + 1, `${e["to-name"]}: ${e.needs}`, `${e["from-name"]}: ${e.function}`]);
  return { summary: `${chain.length} steps from a battery module to the front-left tyre, found by a recursive walk`,
    columns: ["Step", "Provider: what it supplies", "to: the function it serves"], rows: table,
    highlight: ["tyre-fl", ...chain.map((e) => e.to)] };
}

export async function propulsionSinglePoints(tx: Tx): Promise<Answer> {
  // Two stages (docs/optimisation-backlog.md). A failure only spreads along dependencies, so a part can only
  // stop all four wheels if it is in the requirement chain of every tyre: the reverse walk finds those few
  // candidates first, and the forward failure reasoning (about 15 ms per part, however little it reaches)
  // then runs for them alone instead of for every part.
  let found = await tx.docs<Doc>(`
        match
          $t isa tyre;
          let $c, $f, $start, $g in requirement_steps($t);
        select $t, $start;
        distinct;
        reduce $needed-by = count groupby $start;
        match $needed-by == 4;
          let $p1, $g1, $t1, $f1 in lost_steps($start);
          $t1 isa tyre; $f1 has function-name "drive torque";
        reduce $tyres = count groupby $start;
        match $tyres == 4;
        fetch { "id": $start.component-id, "name": $start.name };
    `, "parts needed by all four tyres whose loss takes drive torque from all four (requirement_steps, then lost_steps)",
  true);
  found = sortBy(found, (f) => f.name);
  return { summary: `${found.length} parts whose failure alone loses drive torque at all four wheels`,
    columns: ["Part"], rows: found.map((f) => [f.name]), highlight: found.map((f) => f.id) };
}

/**
 * The physical support steps behind the front-right tyre (D1.2): through the suspension and subframe into
 * the body structure. The recursive walk returns every requirement; the support steps are kept and followed
 * from the tyre, breadth first.
 */
export async function loadPath(tx: Tx): Promise<Answer> {
  const edges = await tx.docs<Edge>(`
        match
          $end isa component, has component-id "tyre-fr";
          let $c, $f, $p, $g in requirement_steps($end);
          $d isa physical-dependency (dependent: $c, affected-function: $f, provider: $p, required-function: $g),
            has dependency-kind "support";
        fetch { "from": $c.component-id, "from-name": $c.name, "function": $f.function-name,
                "to": $p.component-id, "to-name": $p.name, "needs": $g.function-name };
    `, "the support dependencies behind the tyre, through the recursive function requirement_steps", true);
  tx.note("TypeScript follows the support steps from the tyre, breadth first, and names where they end.");
  const from = byFrom(edges);
  const seen = new Set(["tyre-fr"]);
  let frontier = ["tyre-fr"];
  const steps: Edge[] = [];
  while (frontier.length) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const e of sortBy(from.get(node) ?? [], (e) => [e["to-name"], e.needs])) {
        steps.push(e);
        if (!seen.has(e.to)) {
          seen.add(e.to);
          next.push(e.to);
        }
      }
    }
    frontier = next;
  }
  const structure = new Set((await tx.docs<Doc>('match $x isa structural-member; fetch { "id": $x.component-id };',
    "the structural members, to name where the load path ends")).map((r) => r.id as string));
  const ends = sorted(new Set(steps.filter((e) => structure.has(e.to) && !from.has(e.to)).map((e) => e["to-name"])));
  const rows = steps.map((e, i) => [i + 1, `${e["from-name"]}: ${e.function}`, `${e["to-name"]}: ${e.needs}`]);
  return { summary: `${steps.length} support steps from the front-right tyre, ending in the body structure: ${ends.join(", ")}`,
    columns: ["Step", "Part: function", "rests on"], rows, highlight: sorted(seen) };
}

type Question = [title: string, capability: string, explanation: string, run: (tx: Tx) => Promise<Answer>];

export const QUESTIONS: Record<string, Question> = {
  "pack-energy": ["How much energy does the battery store?", "Aggregation",
    "Sums an engineering property over every battery module (reduce ... sum).", packEnergy],
  "drive-power": ["What is the combined drive power?", "Aggregation over a type",
    "Sums peak power and torque over every instance of the electric-motor type.", drivePower],
  "sensors-by-type": ["Which sensors does the vehicle have?", "Polymorphism",
    "One query for the abstract type 'sensor' returns cameras, radars, lidar, satellite and wheel-speed "
    + "sensors, grouped by their most specific type.", sensorsByType],
  "multi-system": ["Which parts serve more than one system?", "Multiple membership",
    "Counts each part's system memberships, then keeps those with more than one (a two-stage pipeline).",
    multiSystem],
  "shared-sensors": ["Which sensors feed more than one control loop?", "Cross-system relationships",
    "Control loops are four-role relations (controller, sensors, actuators, system); this finds sensors "
    + "shared between loops.", sharedSensors],
  "connections-by-kind": ["How are the parts connected?", "Relation subtypes",
    "Counts physical connections by their subtype: mechanical, power, data and fluid.", connectionsByKind],
  "battery-to-wheel": ["How does battery energy reach the front-left wheel?", "Recursive traversal",
    "Walks the function-level dependencies back from the tyre with a recursive function and shows the "
    + "shortest chain to a battery module.", batteryToWheel],
  "load-path": ["What carries the front-right wheel's load into the body?", "Recursive traversal, filtered",
    "Walks the function-level dependencies back from the tyre with a recursive function, keeps the physical "
    + "support steps and follows them: through the knuckle, arms, spring and subframe to the towers, rails and "
    + "floor of the body structure.", loadPath],
  "propulsion-single-points": ["Which single failures stop all propulsion?", "Function-level failure reasoning",
    "Walks back from the four tyres to find the parts every wheel's drive needs, then runs the "
    + "failure reasoning for each of those and keeps the parts whose loss alone takes drive torque "
    + "from all four wheels. The heaviest question: about a second.", propulsionSinglePoints],
};

export function questionList(): QuestionMeta[] {
  return Object.entries(QUESTIONS).map(([id, [title, capability, explanation]]) => ({ id, title, capability, explanation }));
}

export async function run(tx: Tx, questionId: string): Promise<QuestionResult> {
  if (!Object.hasOwn(QUESTIONS, questionId)) throw new NotFound(`question ${questionId}`);
  const [title, capability, explanation, fn] = QUESTIONS[questionId];
  return { id: questionId, title, capability, explanation, ...(await fn(tx)) };
}
