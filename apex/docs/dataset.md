# Fictional dataset

**Everything here is fictional.** Novacore plc, Atlas Biopharma plc and its subsidiaries, Helix,
Calder, every firm and every person are invented. The deal follows a realistic UK public takeover: a
cash offer by **scheme of arrangement** under the Takeover Code. The authorities are real public
bodies acting in an invented scenario (decision D3). The app shows a permanent "Fictional
demonstration data" label.

The data lives in readable YAML files, `data/seed/*.yaml` (the source of truth). `apex/seed.py` checks
it and loads it in one transaction (see "How the data is checked" below). `data/seed.tql` is the same
data as one TypeQL insert, generated for TypeDB Studio users. The demo's "today" is stored in the data:
**26 October 2026**.

Totals (Phase 6E): **1,058** entities and relations (1,051 in 6A.2, plus 7 steering meetings), made up of 30 organisations, 45 people,
1 acquisition, 11 mandates, 2 financing tranches, 9 ownership links, 7 workstreams, 78 work items
(41 activities, 21 milestones, 7 covenants, 4 clearances, 3 deadlines, 1 shareholder approval,
1 court sanction), 80 dependencies (62 sequencing, 5 gating, 13 informing; 67 hard), 4 deadline limits,
6 authority reviews, 18 legal duties, 3 consent rights, 386 RACI assignments, 118 activity events,
16 replies and 10 risks with 10 owners and 16 exposures.

Since Phase 6A.2 the data is split by workstream: `data/seed/parties.yaml`, `deal.yaml`, `links.yaml`,
`risks.yaml` and `data/seed/workstreams/<n>-<name>.yaml` (each holds its workstream, items, the
dependencies into them, their RACI and their events). The tables below describe the original 34 items;
the additions are summarised in "Phase 6A.2 additions".

## The deal

| | |
|---|---|
| Code | `DEAL-APEX` ("Project Apex") |
| Acquirer | Novacore plc: UK-listed life-sciences and medical-technology group |
| Target | Atlas Biopharma plc: UK-listed developer of rare-disease biologic medicines |
| Value | £2.4 billion, all cash |
| Structure | Scheme of arrangement (court-sanctioned; needs Atlas shareholders' approval) |
| Funding | £1.8bn bridge facility (Albion £1.0bn, Northmere £0.8bn) + £0.6bn existing cash |
| Status on 26 Oct 2026 | Shareholders approved; US, EU and UK national-security clearances received; change-of-control consents in hand; **UK competition (CMA) review open and at risk** |

## Organisations (30; three added in Phase 6A.2, listed at the end)

| Code | Name | Type | Role in the deal |
|---|---|---|---|
| ORG-NOV | Novacore plc | company | Acquirer, borrower, applicant for clearances |
| ORG-ATL | Atlas Biopharma plc | company | Target; parent of the Atlas group (below) |
| ORG-ATL-UK, -US, -IE, -DE, -IP, -JV | Atlas group companies | company | See "Atlas group structure" |
| ORG-HELIX | Helix Contract Services Ltd | company | 40% JV partner; holds a change-of-control call option |
| ORG-CALDER | Calder University Enterprises Ltd | company | 10% shareholder in Atlas IP Holdings; licensor of the core patents |
| ORG-HAR | Harrowgate & Co | investment-bank | Lead financial adviser to Novacore |
| ORG-BWM | Blackwood Marsh LLP | law-firm | Legal and competition counsel to Novacore |
| ORG-KF | Kestrel & Finch LLP | accounting-firm | Financial and tax due diligence for Novacore |
| ORG-COR | Corvane Consulting | consultancy | Integration Management Office for Novacore |
| ORG-HAL | Halyard Communications | communications-firm | PR and investor communications for Novacore |
| ORG-LKH | Larkhill Capital | investment-bank | Rule 3 financial adviser to Atlas |
| ORG-PH | Pemberton Hale LLP | law-firm | Legal counsel to Atlas |
| ORG-CRB | Corbel Communications | communications-firm | PR for Atlas |
| ORG-ALB | Albion Commercial Bank | commercial-bank | Bridge lender (£1.0bn) |
| ORG-NMB | Northmere Bank | commercial-bank | Bridge lender (£0.8bn) |
| ORG-CMA | Competition and Markets Authority | regulator | UK merger control |
| ORG-EC | European Commission (DG Competition) | regulator | EU merger control |
| ORG-FTC | US Federal Trade Commission | regulator | Receives the HSR filing (with the DOJ) |
| ORG-DOJ | US Department of Justice (Antitrust Division) | regulator | Receives the HSR filing (with the FTC) |
| ORG-ISU | Investment Security Unit (Cabinet Office) | regulator | Runs the NSI Act review for the Secretary of State |
| ORG-PANEL | The Panel on Takeovers and Mergers | regulator | Administers the Takeover Code; Informed of the announcement and of any long-stop extension |
| ORG-HCJ | High Court of Justice (England and Wales) | court | Sanctions the scheme |

### How the authorities are represented, and how this was checked

Checked on 26 Oct 2026 against official or practitioner sources (the Takeover Code's Appendix 7 on
schemes, CMA merger guidance summaries, FTC/DOJ HSR summaries, and NSI Act guidance summaries).

| Clearance | Authority and role in the data | Timing used | Notes |
|---|---|---|---|
| CP-HSR | FTC **and** DOJ each receive the filing (two `authority-review`s) | 30 calendar days from filing (3 Aug → 2 Sep) | Corrected in this revision: the draft named only the FTC |
| CP-NSIA | ISU reviews for the Secretary of State | 30 working days from acceptance (24 Aug → 6 Oct; 31 Aug bank holiday) | **Fictional assumption**: Atlas's engineered cell-line platform falls in the synthetic biology sector, triggering mandatory notification. The ISU's home department has moved before: check before publishing |
| CP-EC | European Commission, Phase 1 | 25 working days (notified 14 Sep → 19 Oct) | **Fictional assumption**: both companies meet EU turnover thresholds |
| CP-CMA | CMA, Phase 1 | 40 working days (began 21 Sep → 16 Nov) | Phase 2 would be up to 24 weeks (extendable by 8). If the CMA finds a competition concern, "undertakings in lieu" add roughly 5 + 5 + 40 working days |
| CP-COURT | High Court sanction | Planned 14 days after the last condition | Code Appendix 7: the offeror confirms all conditions are satisfied before the hearing |
| (Panel) | Not an approver here | | Code Appendix 7: the long-stop date can be extended by the offeror **with the target's agreement**; Panel consent is needed only in a competitive situation, and any extension is announced. So the Panel is **Informed**, not Consulted (corrected in this revision) |

Also from Appendix 7: shareholders must be paid **within 14 days of the scheme becoming effective**
(OB-SETTLE). The Code's Rule 12 lapse-on-Phase-2 provision does not apply to schemes, so a CMA Phase 2
reference doesn't automatically end this deal; the long-stop date is what bites.

## Atlas group structure: what Novacore is buying

```
Atlas Biopharma plc (ORG-ATL, UK, listed)
└── 100%  Atlas Biopharma (UK) Ltd (ORG-ATL-UK): main operating company
    ├── 100%  Atlas Therapeutics Inc (ORG-ATL-US, Delaware): US commercial arm
    │   └──  20%  Atlas IP Holdings Ltd ──┐
    ├──  70%  Atlas IP Holdings Ltd (ORG-ATL-IP, UK): owns patents and licences
    │                                      └── also 10% Calder University Enterprises Ltd (ORG-CALDER)
    └── 100%  Atlas Biologics Ireland Ltd (ORG-ATL-IE): manufacturing
        ├── 100%  Atlas Biopharma GmbH (ORG-ATL-DE, Germany): EU distribution
        └──  60%  Helix Atlas Manufacturing Ltd (ORG-ATL-JV, Ireland): joint venture making the
                  lead product; the other 40% is Helix Contract Services Ltd (ORG-HELIX)
```

**Effective ownership by Atlas.** Verified in TypeDB and recomputed independently by the test oracle
(`tests/test_ownership.py`):

| Company | Effective stake | Routes | Working |
|---|---|---|---|
| Atlas Biopharma (UK) Ltd | 100% | 1 | 100% |
| Atlas Therapeutics Inc | 100% | 1 | 100% × 100% |
| Atlas Biologics Ireland Ltd | 100% | 1 | 100% × 100% |
| Atlas Biopharma GmbH | 100% | 1 | 100% × 100% × 100% |
| Helix Atlas Manufacturing Ltd | **60%** | 1 | 100% × 100% × 60% |
| Atlas IP Holdings Ltd | **90%** | **2** | (100% × 70%) + (100% × 100% × 20%) |

The 90% deliberately tests multiple routes. A query that took only one route would say 70% or 20%,
and one that ignored stakes would just say "owned".

**No cross-shareholdings, by design.** Nothing in the group owns any part of a company above it. Real
groups can have such cycles, and they need more sophisticated calculations. Apex rejects them as a
deliberate simplification (schema-design.md §4).

## Change-of-control scenario

Two contracts inside the Atlas group give the other side rights when Atlas changes hands:

| Code | What | Owed by (Atlas stake) | Consent from | Status |
|---|---|---|---|---|
| CV-COC-CALDER | Calder's consent to the change of control under the patent licence | Atlas IP Holdings (90%, 2 routes) | Calder University Enterprises | **Given, unconditionally** (9 Oct 2026) |
| CV-COC-HELIX | Helix's waiver of its change-of-control call option over the JV | Atlas Biologics Ireland (100%), which holds the JV's 60% | Helix Contract Services | **Signed, but conditional** (14 Oct 2026) |
| DL-HELIX-WAIVER | **Deadline: completion by 31 Jan 2027**, or the waiver lapses | Atlas Biologics Ireland (100%) | Helix Contract Services | Running |

**The contractual consequence of delay.** Helix agreed to waive its right only if the deal completes by
31 January 2027. If completion slips past that date, the waiver lapses and Helix's call option
revives: Helix may buy Atlas Biologics Ireland's 60% of Helix Atlas Manufacturing at the shareholders'
agreement's fair-value price. That JV makes Atlas's lead product, so Novacore would buy Atlas without
control of its manufacturing. This is a real breach with a real consequence, not just a date that
moves. Completion has **60 days of headroom**: a CMA delay of 61 days or more triggers it, which is
well inside the range of a CMA "undertakings in lieu" process and long before the long-stop date.
(Replaces the earlier draft's "call-option window that moves with completion", which had no real
consequence.)

## People (45, no individuals at real authorities; 21 added in Phase 6A.2)

| Organisation | People (job title is on the employment relation) |
|---|---|
| Novacore | Eleanor Hartley (CEO), Marcus Adebayo (CFO), Sophie Lindqvist (General Counsel), **Daniel Okafor** (Director, Corporate Development: deal lead), Hannah Reyes (Integration Director), Tomás Ferreira (Chief People Officer), Grace Whitfield (Head of Investor Relations) |
| Atlas | Dr Rajiv Menon (CEO), Claire Donnelly (CFO), Owen Pritchard (Company Secretary), Fiona Gallagher (Chair) |
| Harrowgate & Co | James Thornton (Managing Director), Aisha Karim (Director) |
| Blackwood Marsh | Charlotte Ainsworth (Corporate Partner), Benedict Shaw (Competition Partner) |
| Kestrel & Finch | Priya Nair (Transaction Services Partner) |
| Corvane Consulting | Lucas Brennan (IMO Lead), Mei Tanaka (Integration Manager) |
| Halyard | Oliver Grant (Account Director) |
| Larkhill Capital | Henrietta Cole (Managing Director) |
| Pemberton Hale | Samuel Achebe (Corporate Partner) |
| Corbel | Nadia Petrova (Partner) |
| Albion Commercial Bank | Rebecca Holt (Head of Leveraged Finance) |
| Northmere Bank | Ian McKenzie (Director, Acquisition Finance) |

Advisers' people hold their RACI letters **via** their firm's mandate. The loader records this when a
person works for an adviser that has exactly one mandate on the deal. Lenders act under financing,
not a mandate, so they have no `via`. Some RACI holders are organisations: the Takeover Panel, Helix
and both lenders.

## Work: 7 workstreams, the original 34 items

Dates in **bold** are complete. Lags are calendar days (a simplification: the statutory dates above
were worked out in working days, but propagation adds calendar days).

| Code | Item | Kind | Workstream | Date | Depends on (lag) |
|---|---|---|---|---|---|
| MS-DD-FIN | Financial and tax due diligence report | milestone | Due Diligence | **19 Jun 2026** | |
| MS-DD-LEGAL | Legal due diligence report | milestone | Due Diligence | **22 Jun 2026** | |
| MS-DD | Due diligence complete | milestone | Due Diligence | **26 Jun 2026** | MS-DD-FIN, MS-DD-LEGAL |
| MS-FACILITY | Bridge facility agreement signed | milestone | Financing | **13 Jul 2026** | |
| MS-ANNOUNCE | Firm offer announced (Rule 2.7) | milestone | Legal and Scheme | **14 Jul 2026** | MS-DD, MS-FACILITY |
| MS-SCHEME-DOC | Scheme document published | milestone | Legal and Scheme | **11 Aug 2026** | MS-ANNOUNCE (28) |
| CP-HSR | US HSR waiting period expired | regulatory-clearance | Regulatory | **2 Sep 2026** | |
| CP-SHAREHOLDERS | Scheme approved by Atlas shareholders | shareholder-approval | Legal and Scheme | **7 Sep 2026** | MS-SCHEME-DOC (21) |
| CP-NSIA | NSI Act approval | regulatory-clearance | Regulatory | **6 Oct 2026** | |
| CV-COC-CALDER | Calder licence change-of-control consent | covenant | Legal and Scheme | **9 Oct 2026** | |
| CV-COC-HELIX | Helix waiver of call option (conditional) | covenant | Legal and Scheme | **14 Oct 2026** | informs MS-COMPLETION |
| CP-EC | EU Phase 1 clearance | regulatory-clearance | Regulatory | **19 Oct 2026** | |
| IN-SYNERGY | Synergy plan baseline approved | milestone | Integration | 13 Nov 2026 | informs MS-DAY100 |
| CP-CMA | **UK CMA Phase 1 clearance** (at risk) | regulatory-clearance | Regulatory | 16 Nov 2026 | |
| MS-COMMS-PLAN | Day-1 communications plan approved | milestone | Communications | 18 Nov 2026 | informs MS-RNS |
| HR-CONSULT | Employee information and consultation | covenant | People | 20 Nov 2026 | informs MS-DAY1 |
| MS-IMO-READY | Day-1 readiness sign-off | milestone | Integration | 25 Nov 2026 | informs MS-DAY1 |
| CP-COURT | Court sanction hearing | court-sanction | Legal and Scheme | 30 Nov 2026 | gated by all 5 conditions (14); CP-CMA sets the date |
| MS-COMPLETION | Scheme effective: completion | milestone | Legal and Scheme | 2 Dec 2026 | CP-COURT (2) |
| CV-CONDUCT | Atlas ordinary-course restrictions end | covenant | Legal and Scheme | 2 Dec 2026 | MS-COMPLETION (0) |
| MS-FUNDS | Bridge facility drawn | milestone | Financing | 2 Dec 2026 | MS-COMPLETION (0) |
| MS-DAY1 | Day 1: combined operations start | milestone | Integration | 2 Dec 2026 | MS-COMPLETION (0) |
| HR-ORG | Day-1 leadership structure announced | milestone | People | 2 Dec 2026 | MS-COMPLETION (0) |
| MS-RNS | Completion announcement | milestone | Communications | 2 Dec 2026 | MS-COMPLETION (0) |
| MS-DELIST | Atlas shares delisted | milestone | Legal and Scheme | 3 Dec 2026 | MS-COMPLETION (1) |
| CM-TOWNHALL | Employee town halls | milestone | Communications | 3 Dec 2026 | MS-DAY1 (1) |
| OB-SETTLE | Shareholders paid (within 14 days of effective date) | covenant | Financing | 16 Dec 2026 | MS-COMPLETION (14), MS-FUNDS (0) |
| IN-SYSTEMS | Finance systems cut-over | milestone | Integration | 4 Jan 2027 | MS-DAY1 (33) |
| DL-HELIX-WAIVER | **Helix waiver: completion deadline** | deadline | Legal and Scheme | 31 Jan 2027 | limits MS-COMPLETION |
| MS-DAY100 | Day-100 integration review | milestone | Integration | 12 Mar 2027 | MS-DAY1 (100) |
| DL-LONGSTOP | **Long-stop date** | deadline | Legal and Scheme | 31 Mar 2027 | limits MS-COMPLETION |
| DL-FUNDS | Bridge "certain funds" period ends | deadline | Financing | 30 Apr 2027 | limits MS-FUNDS, OB-SETTLE |
| CV-RETENTION | Atlas key-staff retention awards paid | covenant | People | 2 Jun 2027 | MS-COMPLETION (182) |
| CV-REFI | Bridge refinanced (bond issue) | covenant | Financing | 2 Dec 2027 | MS-FUNDS (365) |

Every item and workstream has exactly one Accountable, 1-2 Responsible and usually some Consulted and
Informed (179 assignments in all). Twenty dated activity events lead up to "today", for example
19 Oct EU clearance received; 21 Oct CMA state-of-play call raised concerns about an overlap in
enzyme-replacement therapies; 22 Oct IMO readiness review at 70%.

## Phase 6A.2 additions

- **Organisations:** Mercia Lane Securities (corporate broker to Novacore), Thornbury Capital Markets
  (corporate broker to Atlas), both investment banks; Ashgrove Registrars Ltd (registrar and receiving
  agent to Atlas). Each has a mandate.
- **People:** 21 more (for example Kofi Mensah at Albion, Liam O'Sullivan at Atlas Biologics Ireland,
  Ruth Byrne at Helix, Martin Whitlock at Calder). Every person has a fictional email
  (`first-initial.surname@<org>.example`, a reserved domain that can never be delivered) and a phone
  number in Ofcom's drama range (07700 900001-900045). The API never returns them.
- **Work:** 41 activities (things with a planned start and a duration, coded `AC-`) and 3 milestones
  (MS-CONVENE convening hearing, MS-CMA-ISSUES issues letter, MS-CMA-MEETING issues meeting). Every
  workstream now stores no progress figure: progress is derived (below).
- **Events:** 111, typed as request (20), response (16), meeting (17), delivery (33), decision (15),
  notice (6) and status change (4). Responses are linked to the request they answer (16 replies).
  Deliberate situations for the engagement view, all checked by tests:
  - Claire Donnelly has an unanswered request (EV-INT-05, due 19 Oct) despite recent activity elsewhere;
  - Liam O'Sullivan has an unanswered request (EV-PPL-04, due 21 Oct);
  - Dr Menon is active on the deal but quiet on CV-CONDUCT since 16 Oct;
  - Oliver Grant is Responsible for AC-COM-DAY1 but last engaged on 13 Oct;
  - Kofi Mensah has no recorded engagement at all (shown as Unknown, never red).
- **Risks:** 10 (for example RK-CMA-P2 "CMA refers the merger to Phase 2"), each with one owner, a
  likelihood, a severity, a status, a mitigation and the work items it threatens.
- **Ownership descriptions:** each shareholding says why it exists.
- **Minority-shareholder rights: two kinds, kept apart (owner's rule, 2026-10-27).** A right that affects
  the transaction's outcome (used in dependency analysis, ownership control or impact simulation) is
  modelled structurally, as items, deadlines and consent relations. A right that is background context
  only lives in the shareholding's description.

  | Right | Holder | How it is held | Why |
  |---|---|---|---|
  | Change-of-control call option over the JV's 60% (waived, conditional on completion by 31 Jan 2027) | Helix | **Structural:** covenant CV-COC-HELIX, deadline DL-HELIX-WAIVER (limits MS-COMPLETION), consent-right with Helix as grantor | Drives the Impact Explorer's first breach (61 days) |
  | Change-of-control consent under the patent licence | Calder | **Structural:** covenant CV-COC-CALDER, consent-right with Calder as grantor | A condition of the consents programme (AC-LEG-CONSENTS) |
  | Two of five JV board seats; vetoes over reserved matters (budget, new products, change of manufacturer) | Helix | Description only | Not used by any analysis today; would matter for a voting-control view, which is deferred (D11) |
  | Consent to assign or sub-license the core patents (a reserved matter in Atlas IP Holdings) | Calder | Description only | Not used today; would matter if a CMA remedy involved licensing the patents |

  If a later feature uses a description-only right (for example the deferred voting-control view, or a
  patent-licence remedy), that right is modelled structurally first, never read from the text.
- **Progress (decision D5):** activity completion is the duration-weighted mean of progress over items
  with a planned start (weight = planned days; complete = 100%); milestone readiness is achieved
  point items out of all of them; deadlines count for neither. Deal level today: 62% over 47 items,
  11 of 28 milestones achieved.

## A known limitation in the engagement data: Benedict Shaw

Benedict Shaw (Responsible for the CMA issues meeting) is red for 12 days without engagement on that item. The
policy treats a point milestone as active 21 days before it is due, so the clock starts on 14 October, but the
meeting was only proposed on 20 October after the issues letter, and Shaw's daily work on the response to that
letter is in effect the preparation, recorded against a different item. The classification is left as it is
rather than adding a model of "preparation for" links; it is a fair reading of the records and a reminder that
an item-level engagement measure depends on work being recorded against the right item.

## Phase 6E additions: steering meetings

Seven meetings, one per workstream, recorded against the **workstream itself** (oversight), each led by
the workstream's Accountable lead and naming on its **agenda** only the items it actually discussed
(migration 002, `meeting relates agenda-item`). Attending one is engagement on its agenda items only,
never on every item in the workstream.

| Code | Date | Workstream | Led by | Attended by | Agenda |
|---|---|---|---|---|---|
| EV-DD-07 | 24 Jun | Due Diligence (close-out) | Daniel Okafor | Priya Nair, Charlotte Ainsworth, Marcus Adebayo | Due diligence complete |
| EV-REG-27 | 19 Oct | Regulatory (the previous week's steering call) | Daniel Okafor | Benedict Shaw, Sophie Lindqvist, James Thornton | UK and EU merger clearances |
| EV-LEG-22 | 20 Oct | Legal and Scheme | Sophie Lindqvist | Charlotte Ainsworth, Samuel Achebe, Owen Pritchard | Court sanction hearing; preparing the sanction hearing |
| EV-COM-10 | 20 Oct | Communications | Grace Whitfield | Oliver Grant, Simon Barlow | Day-1 communications plan; completion announcement drafts |
| EV-FIN-08 | 21 Oct | Financing | Marcus Adebayo | Aisha Karim, Neil Foster | Conditions to drawdown; bridge facility drawn |
| EV-INT-14 | 21 Oct | Integration Planning (IMO) | Hannah Reyes | Lucas Brennan, Mei Tanaka, Laura Whitcombe, Felix Brandt | Day-1 readiness checklist; interim finance arrangements; Day-1 readiness sign-off |
| EV-PPL-10 | 22 Oct | People | Tomás Ferreira | Mei Tanaka, Sarah Lindsay | Day-1 leadership design; Irish consultation |

Due Diligence finished in June, so its meeting is a close-out then, not an October steering meeting.
Regulatory already had a weekly steering call on 26 October; its addition is the previous week's call.

## The Impact Explorer scenario (the answer key)

Delay the CMA clearance by **D** days. Hard dependencies push dates forward. Every row is an automated
test (`tests/test_impact.py`), and every projected date is also checked against an independent
calculation for each delay tested.

| Delay | Story | What happens |
|---|---|---|
| 0 | Base plan | Completion 2 Dec 2026; every deadline met |
| 28 days | CMA Phase 1 clock stopped for four weeks until an information request is answered in full | Completion 30 Dec 2026; settlement 13 Jan 2027; **14 downstream items in 5 other workstreams** move; no deadline breached (32 days of Helix headroom left) |
| 60 days | | Completion 31 Jan 2027: the last day the Helix waiver holds. From here two Phase 6A.2 activities with slack also move (AC-INT-SYSTEMS, AC-PPL-AWARDS): 16 items after the clearance |
| **61+ days** | CMA finds a concern; Novacore offers undertakings in lieu (roughly 10+ weeks) | **Helix waiver lapses**: Helix may buy the JV's 60% (manufacturing of the lead product) |
| 119 days | | Completion 31 Mar 2027: the last day before the long-stop date |
| **120+ days** | | **Long-stop breached**: the scheme lapses unless Novacore extends with Atlas's agreement |
| **136+ days** | | Shareholder settlement falls outside the bridge "certain funds" period |
| 150+ days | | The drawdown itself falls outside it |
| 168 days | CMA Phase 2 reference (24 weeks) | Completion 19 May 2027: Helix deadline missed by 108 days, long-stop by 49, drawdown by 19 and settlement by 33 days; retention awards slip to 17 Nov 2027; AC-INT-100DAY also moves (17 items after the clearance) |

For each affected item the screen shows old date → projected date, the dependency that moved it, and
who is Responsible, Accountable, Consulted and Informed. For each deadline it shows headroom or days
over, its consequence, who is legally bound by it and, for obligations inside the Atlas group, their
effective stake. Already-complete items never move.

## How the data is checked

- **Before loading (`api/src/seed.ts`):** every reference exists and is the right kind of thing;
  codes are unique and well formed; status, criticality, progress, dates, lags and money are valid;
  every item has exactly one Accountable; every deadline states its consequence. Since Phase 6A.2 also:
  contact formats and uniqueness; every person holds a role; no stored workstream progress; activities
  have a planned start no later than their due date and sit inside their workstream; statuses agree
  with the scenario date; events are no later than it, by someone with a role in that workstream, with
  recipients, attendees, response dates and replies that make sense (a reply comes after its request,
  from someone it was sent to); each item's latest status change matches its status; risks are complete.
- **While loading (TypeDB, same transaction, before commit):** the schema enforces its rules; then the
  loader counts every entity and relation type against the YAML, and runs the ownership guards and
  the three data-quality checks. Any problem means nothing is saved.
- **Afterwards (tests):** base dates respect every dependency and deadline; no dependency or
  ownership cycles; effective stakes and impact projections match independent calculations; planted
  problems are caught.
