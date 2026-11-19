# Engineering references and simplifications

The vehicle is an original, unbranded concept. Public sources inform its *layout and proportions*; none
of its numbers are measured from, or claimed for, any real product. Manufacturers named below are cited
only as published sources; they have no connection with this project.

## Drive units (C3a, 30 October 2026)

### Sources

| Topic | Source | What we took from it |
|---|---|---|
| Overall layout, ratio | Argonne National Laboratory, *D3 2020 Tesla Model 3* vehicle benchmarking page (anl.gov/taps/d3-2020-tesla-model-3): final drive 9.04:1; rear unit a six-pole interior permanent-magnet motor | A single-speed reduction of about 9:1 for a permanent-magnet traction motor; interior (buried) magnets |
| Two-stage reduction | Volkswagen's published description of its MEB single-speed gearbox (reported by InsideEVs, Automotive Powertrain Technology International, 2020): two stages, about 10:1, chosen to keep each gear small | A two-stage helical reduction on three parallel shafts rather than one large gear |
| Benchmarking teardowns | US DOE Vehicle Technologies Office, *Benchmarking state-of-the-art technologies* (ORNL motor and inverter teardown reports, energy.gov) | Typical arrangement of housing, water jacket, stator, rotor, resolver and inverter on the unit |
| SiC power module | Infineon, HybridPACK Drive CoolSiC press release and product pages (2021): a 1200 V silicon-carbide six-pack (three half-bridges) for traction inverters up to about 250 kW | One six-pack module on a pin-fin cold plate per inverter; 800 V class |
| Hairpin windings | Published papers on hairpin (bar-wound) stators, e.g. Berardi and Bianchi, *Design guideline of an AC hairpin winding*, ICEM 2018; Glaessel et al., laser welding of hairpin windings, 2017 | Bent crowns at one end, welded pin pairs at the other; two conductor layers per slot |
| Axle disconnect | US patents on EV drive-unit disconnects (for example US 12,011,995, *Electric drive unit with a disconnect assembly*; others in the same search describe a dog clutch engaged by a solenoid and opened by a spring on power loss); Chalmers and University of Zagreb papers on disconnect clutches and permanent-magnet drag losses | Front dog-clutch disconnect on the intermediate shaft; spring-opened, so it opens without 12 V or a VCU command |

### Concept numbers (design targets, not measurements)

| Item | Value | Note |
|---|---|---|
| Reduction | 21:61 then 17:53 = **9.06:1** | Stage 1 module 2.0 mm, helix 25°; stage 2 module 3.0 mm, helix 22°. Centre distances 90.5 mm and 113.2 mm |
| Front motor | 180 kW, 340 N·m; housing Ø 260 mm; core 170 mm long | 8 poles, 48 slots |
| Rear motor | 300 kW, 520 N·m; housing Ø 290 mm; core 210 mm long | 8 poles, 48 slots |
| Motor axis above the wheel axis | front 190 mm (30 mm behind), rear 190 mm (100 mm behind) | Lets the left drive shaft pass under the motor |
| Inverter | 300 × 85 × 400 mm on top of the motor | 800 V; front 200 kW, rear 330 kW (C1 values) |

### Simplifications and fictional assumptions

- **Geometry is representative, not designed.** Gear teeth are trapezoidal, not involute; helix twist and
  tooth counts are real, flank shapes are not. Bevel gears are tapered spur teeth. Gears are placed at their
  correct centre distances but not rotated into exact mesh.
- **Hidden internals are simplified:** no intermediate-shaft or differential bearings as separate parts, no
  seals, no oil passages, no stator slot liners, no rotor laminations visible as separate sheets.
- **The water jacket** is implied by the housing's coolant ports; the channel itself is not modelled.
- **Unequal-length drive shafts:** the left (motor-side) shaft starts with a long stub under the motor. Many
  front units add an intermediate shaft with its own support bearing to keep the shafts equal (torque
  steer); not modelled.
- **Mount positions** are plausible (two under the unit, one torque rod), not tuned for vibration.
- **Inverter internals** are arranged for legibility: one module, one capacitor block, two boards, one
  three-phase current sensor. Real units vary.
- **Dependencies** (docs/dependency-semantics.md): no sensorless fallback after a resolver failure; an
  electric oil pump; drive torque lost per side downstream of the differential (an open differential would
  in fact leave the other wheel with almost no torque; flagged for review).

## Battery and high-voltage distribution (C3b, 30 October 2026)

### Sources

| Topic | Source | What we took from it |
|---|---|---|
| 800 V pack architecture | Porsche newsroom, *The battery: sophisticated thermal management, 800-volt system voltage* (Taycan): 33 modules of 12 cells, 396 cells, 198s2p, each module with its own monitoring unit, modules joined by busbars | An 800 V class pack as one long series string of modules, each module monitored for voltage and temperature, modules linked by busbars |
| Junction box contents | Texas Instruments, *SLYY226* (intelligent battery junction box); batterydesign.net, *High voltage system*; EFI Automotive battery junction box product sheet | Main contactors, pre-charge circuit, fuse (and optionally a pyrotechnic fuse) and current sensor in one housing at the pack; the BMS drives the contactors and reads the current sensor |
| Pre-charge sequence | HP Academy, *EV fundamentals: battery pack* | The pre-charge path charges the inverters' capacitors before the main contactor closes |
| Module formats | German VDA prismatic cell and module formats (as published by industry suppliers) | Prismatic cells stacked between end plates with straps, busbars and a monitoring board on top, cooled from below through a plate |

### Concept numbers (design targets, not measurements)

| Item | Value | Note |
|---|---|---|
| Cells | 224 prismatic NMC cells, 124 Ah, 3.6 V nominal | 14 per module, one string (224s1p) |
| Pack | 806 V nominal, 100 kWh | 16 modules × 50.4 V × 6.25 kWh |
| Module | 560 × 200 × 115 mm | 14 cells of 36 mm between end plates |
| Pack height | about 175 mm from the protection plate to the lid | Between 190 mm ground clearance and the cabin floor at 380 mm |
| Front bay | junction box, BMS and service disconnect in front of the modules | Inside the enclosure, behind the front subframe |

### Simplifications and fictional assumptions

- One cooling plate under all modules (real packs often use one plate per row, or cooling between cells).
- The monitor chain is drawn as one ribbon; real packs use a twisted-pair daisy chain or wireless links.
- No separate pyrotechnic fuse, no isolation-monitoring board, no DC-charge contactors (the DC charge path
  joins the junction box's main bus).
- Harnesses keep their simple procedural tube shapes; the new ones follow plausible routes.
- The charge port sits in the left rear quarter; the opening in the body panel is not cut.
