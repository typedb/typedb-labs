# Vehicle design targets (current engineering baseline)

Status: **current engineering baseline** (owner, 30 October 2026). Applied to the app on 30 October 2026
(docs/wheelbase/README.md): the axles moved (front +14.3 cm, rear -1.3 cm) and the body stayed. Still
revisable when the exterior is revisited.

Source: measured from the approved concept image (`docs/reference/concept-target.webp`), see
`docs/exterior-feasibility.md`. About ±5% because of perspective in the image.

| Dimension | Target | App before 30 Oct | Change (applied) |
|---|---|---|---|
| Overall length | 4.75 m | 4.75 m | none |
| Wheelbase | 3.03 m | 2.874 m | +0.156 m |
| Front overhang (front axle to nose) | 0.76 m | 0.90 m | −0.14 m |
| Rear overhang | about 0.96 m | 0.97 m | none in practice |
| Height | about 1.63 m | similar | to confirm in the exterior trial |
| Track (tyre centres) | 1.63 m | 1.63 m | none |
| Wheels | 22 inch | 22 inch | none |

The whole change is the **front axle moving forward about 15 cm** (the rear axle stays where it is,
within measurement error). As applied: front axle x 1.437 -> 1.58, rear axle x -1.437 -> -1.45; the origin
is now a fixed body reference point.

## What it means for mechanical packaging

- **Wheel corners**: no geometry change. Each corner is modelled around its axle centre
  (`blender/corner.py`, `AXLE`), so it moves with the axle.
- **Front suspension, steering and front drive unit**: move forward with the axle. The space between
  the front axle and the bumper shrinks by about 14 cm: the front crash structure, cooling module
  (radiator, fans) and the front drive unit's front face must fit in about 0.76 m. Typical for modern
  EVs with a front motor, but it is the tightest area and should be checked first in the mechanical work.
- **Battery**: the floor between the axles grows by about 15 cm. The pack (currently 2.0 m long, 16
  modules in 8 rows of 0.24 m) can either keep its size with more room at the ends, or grow by roughly
  half a module row. Decide during Phase B mechanical work; no change now.
- **Cabin**: longer wheelbase gives more rear legroom; the seats and floor can stay where they are.
- **Explosion**: trajectories are computed from assembled positions, so they adapt automatically.

## When these become fixed

At the exterior review: if the trial body (or a later route) is approved at these proportions,
`dimensions.ts`, `blender/corner.py` and the affected parts move in one change, with comparison renders.
