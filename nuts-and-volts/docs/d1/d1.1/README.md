# D1.1 Silhouette and design lock: evaluation of the two modelling approaches (1 November 2026)

**Status: for visual review. D1.2 not started; nothing merged.**

The question for this phase: can either approach give a vehicle that looks convincingly like a premium SUV from
every major angle, at the fixed dimensions and around the existing mechanical vehicle?

## Renders

- `compare-matching-angles.jpg`: the main comparison. It has four rows: the concept reference, the current app body,
  the October trial and the new scripted body. Each row shows front three-quarter, side and rear three-quarter views.
- `front-rear.jpg`: straight front and rear views of the new scripted body. The reference has no straight views.
- `scripted-*.jpg`: the new body's five views at full size.

The October trial and the new body are Blender (Cycles) renders with the same studio lighting. The current app
row is the in-app renderer. The cameras match the reference's angles by eye; they are not photogrammetric.

## Approach 1: improved scripted subdivision body (`blender/exterior.py`)

**What changed from the October trial:**
- **App coordinates and the real vehicle.** The body is built around the four real corner models (wheels, tyres,
  brakes) at the real axles, so there are no stand-in wheels.
- **The cage.**
  - It has 13 rails over 10 landmarks.
  - The roof rails have their own header, peak and spoiler positions. The roof falls from the B-pillar to a spoiler
    at 1.41 m, as in the reference, instead of running flat to the tail.
- **Window graphic.**
  - The rear side window ends in a point.
  - The C-pillar is body colour.
  - The A-pillars are black.
  - There is a panoramic glass panel inside a body-colour roof.
  - The beltline kicks up at the C-pillar.
- **Corners.** The front and rear corners are rounded in plan, with black lower bumpers.
- **Wheel openings.**
  - They are tight to the tyres.
  - The satin-black lips are placed on the body by ray casting. Round 1's shrink-wrap lips were jagged.
- **Packaging.** The bonnet clears the C3c interfaces: about 1.03 m over the top mounts and 1.05 m over the brake
  reservoir.

**Four rounds:**
- Round 1 read as an estate car: long flat roof, boxy front and rear.
- Rounds 2 to 4 fixed the roofline, the window graphic, the corners, the lips and the glass.
- The script takes about 2 minutes to build and render all five views.

**Assessment, honestly:**
- **Better than both earlier bodies.** The side view now has crossover proportions, and the surfaces are smooth
  with no faceting. The wheels sit properly in their openings.
- **Not yet convincing as a premium SUV from every angle.**
  - The front and rear read as soft "clay model" volumes: a tall, rounded front face and a slab-like tailgate.
  - The surfaces have no tension, so the car looks generic rather than premium.
  - The light graphics, intake and diffuser that carry the concept's character are D1.4 work, and they would help.
    They would not fix the soft volumes.
- **The same convergence problem as October.** Each round improves one area. Achieving crisp, tensioned surfaces
  needs either much finer control-cage work, with diminishing returns, or hand sculpting.

## Approach 2: adapting an existing high-quality vehicle model

**What I looked for:** a detailed, unbranded SUV model whose licence allows our use. We publish a **public GitHub
repository** containing the GLB files, and a **public web app** that sends those files to every visitor's browser.
Anyone can download and extract them.

**What I found:**

| Source | Quality | Licence | Fits our use? |
|---|---|---|---|
| Free CC0 packs ([Kenney](https://kenney.nl), [Quaternius](https://quaternius.itch.io/lowpoly-cars)) | Low-poly, game style | CC0 (anything allowed) | Licence yes; quality no |
| Free CC-BY models (Sketchfab, [Cinevva list](https://app.cinevva.com/game-assets/free-3d-vehicle-models)) | Mixed; the good SUVs are copies of real branded cars, the original ones are sci-fi | CC-BY | Licence yes; no suitable original premium SUV found |
| Commercial "generic SUV" models ([TurboSquid](https://www.turbosquid.com/3d-models/3d-generic-electric-suv-1224298), [CGTrader](https://www.cgtrader.com/3d-models/car/suv/generic-suv-2), [3dmodels.org](https://3dmodels.org/3d-models/generic-suv-ev-2021/), [Superhive](https://superhivemarket.com/products/car-blend)) | High: what we want | Royalty-free licences ([comparison](https://licenseorg.com/compare/cgtrader-vs-turbosquid)) | **No as standard.** They allow the model inside a product but forbid redistributing it in an extractable form. A public repository and a web app that downloads the GLB are both extractable. |
| AI-generated models ([Meshy](https://www.meshy.ai/tags/suv) and similar) | Lumpy topology, baked textures, unclear originality | Varies by plan | Not suitable for a clean, separable, id-named body |

**What adapting would involve** even with a suitable licence:
- re-proportioning the model to our wheelbase, track and wheels;
- cutting it into panels named by our component ids;
- adding inner panels and the body-in-white;
- keeping the bonnet and arch clearances.

That is substantial, but it is mechanical work that suits scripts. The model's quality would carry the "premium"
look that scripting struggles with.

**Feasible routes:**
1. **Buy a commercial model with an extended or editorial licence** that explicitly allows redistribution in an
   open-source repository and web app, confirmed in writing by the seller before purchase.
2. **Keep the GLB out of the public repository.** Serve the GLB privately, outside Git, and keep the repository's
   code public. The model still reaches every visitor's browser, so this still needs the seller's agreement.
3. **Commission an original model** under our own licence. This was declined earlier.

**A render trial of approach 2 was not done.** It needs a download or a purchase, and I have not done either
without your permission. The repository also has no LICENSE file yet, so "our open-source licence" is still to be
chosen. Any third-party model must be compatible with whatever you choose.

## Recommendation

- **Neither approach, as things stand, meets the acceptance criterion.** Approach 1 is the best scripted result
  so far and is free of licence risk, but it reads as a generic, soft SUV at the front and rear.
- **If "convincing premium from every angle" is firm,** it most likely needs a professionally modelled body,
  bought (approach 2) or commissioned, with written permission to redistribute.
- **If "credible and clean" is acceptable for a demonstrator,** approach 1 can proceed into D1.2, with the
  character added in D1.4 (light blade, tail bar, intake, diffuser, trims) and one more round of front and rear
  shaping.

**Decision needed before D1.2:** choose approach 1, approve a short render trial of a specific commercial model,
or choose to commission a model.
