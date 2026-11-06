// The guided demonstration (/api/guide): eight steps, about six minutes, for someone evaluating TypeDB or
// recording a short video. Each step opens an exact view. Every figure quoted here is checked against the live
// answers by tests/showcase.test.ts, so the script cannot drift from the data.

const STEPS = [
  { title: "The deal at a glance", time: "0:00", to: "/?cp=DL-HELIX-WAIVER",
    show: ["The header: two of six conditions outstanding, the CMA clearance at risk.",
      "Work progress: activity progress and milestones, shown apart from readiness to close.",
      "The Gantt with the deadline-critical chain to the Helix waiver: three items marked Deadline-critical."],
    say: "A fictional £2.4 billion acquisition. Its tightest contractual deadline can absorb 60 days of delay, and the "
      + "chain of items with the least float before it breaks runs through the CMA clearance, the court hearing and completion.",
    typedb: "Schedule float comes from one projection over the dependency relations; the Gantt, Parties and the "
      + "Impact Explorer all use it." },
  { title: "What is being bought", time: "0:45", to: "/explorer?view=group",
    show: ["Atlas IP Holdings: 90% effective ownership over two routes (70% and 20%)."],
    say: "Ownership is followed down every route and multiplied, and the guard queries refuse to answer if the data "
      + "had a cycle or a company over 100% owned.",
    typedb: "A recursive function saved in the schema (group_members), with guard queries in the same transaction." },
  { title: "How two parties are connected", time: "1:30", to: "/explorer?view=paths&from=PER-AINSWORTH&to=ORG-CMA",
    show: ["The first path: employment, then mandate, then authority review, each step a single record in words.",
      "The note that the path goes through a hub, and the disclaimer."],
    say: "A partner at the law firm is connected to the CMA because her firm advises Novacore, whose merger the CMA "
      + "reviews. The transaction itself is never a stepping stone, so ‘both are on the deal’ is never offered.",
    typedb: "Role-less matching over every relation type, with the kind statement keeping stepping stones to entities; "
      + "n-ary relations keep all their players." },
  { title: "A regulatory delay", time: "2:15", to: "/impact?item=CP-CMA&days=61",
    show: ["At 61 days the Helix waiver deadline breaks; 17 items move.",
      "Drag to 168 days: all three deadlines break.", "The dependency chain and who needs to act."],
    say: "The breaking points, 61, 120 and 136 days, are found by search over stored dates and dependencies; nobody "
      + "typed them in.",
    typedb: "The recursive impact_edges function follows every hard dependency to any depth." },
  { title: "Who is responsible", time: "3:15", to: "/workstreams/WS-REG",
    show: ["Activity progress, milestones and conditions to close, side by side.",
      "Waiting on open work: prerequisites at any depth.", "The RACI matrix: one person, different letters per item."],
    say: "Responsibility is recorded per item, so the same person can be Accountable for one item and Consulted on another.",
    typedb: "Each RACI letter is its own relation type under raci-assignment; the recursive upstream function finds open prerequisites." },
  { title: "Engagement, with its evidence", time: "4:00", to: "/parties/PER-DONNELLY",
    show: ["Red · Overdue response: the request, its reply-by date, and no reply recorded.",
      "Then the CMA: amber on its statutory timetable, never on silence."],
    say: "Facts come first: an overdue response is red whatever else the person has done. Inference is labelled, and "
      + "missing information is Unknown, never red.",
    typedb: "What counts as engagement is read from the schema's type hierarchy; a reply is a relation between two events." },
  { title: "Structured context for AI", time: "4:45", to: "/analyst?i=closing-risks",
    show: ["Executed steps with their TypeQL, and the hypothetical step, labelled as such."],
    say: "No AI runs here. The point is the material: typed records, stable codes and the exact queries, which an "
      + "assistant could cite instead of guessing.",
    typedb: "Every answer carries the executed TypeQL and the capabilities it uses." },
  { title: "Under the hood", time: "5:30", to: "/?advantage=application-complexity",
    show: ["Open any Show TypeQL drawer: the exact queries, in a READ transaction.",
      "The TypeDB Advantage panel: schema excerpts and live figures for each claim."],
    say: "Everything on screen came from TypeDB through these queries; the browser holds no business data.",
    typedb: "Schema, saved functions and read-only queries; see docs/architecture.md." },
];

export function guide() {
  return { steps: STEPS.map((s, n) => ({ n: n + 1, ...s })),
    notes: ["Open each step's link in turn; every view is a stable URL.",
      "Everything is fictional. Real public authorities appear only in an invented scenario."] };
}
