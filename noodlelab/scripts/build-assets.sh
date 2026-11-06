#!/bin/sh
# Rebuild the Blender-modelled parts (wheel corners, subframes and anti-roll bars, steering, brake supply, thermal circuits, drive units, battery pack, power
# electronics, body structure, exterior panels) and compress them
# for the web app.
#   1. Blender (on this Mac, via uv) writes uncompressed models to web/assets-src/ and the visual
#      mapping files (node -> component id) to web/public/assets/. -kv keeps texture coordinates even
#      though the models carry no image textures: the app's generated textures need them..
#   2. gltfpack (in the dev container) compresses each model with Meshopt and also writes a lighter
#      ".lod1" copy (about 30% of the triangles) that the app shows when a part is small on screen.
# Usage, from the project root:  sh scripts/build-assets.sh
set -eu
cd "$(dirname "$0")/.."
DOCKER="${DOCKER:-$HOME/.docker/bin/docker}"

uv run --project blender python -I blender/corner.py
uv run --project blender python -I blender/drive_unit.py
uv run --project blender python -I blender/battery.py
uv run --project blender python -I blender/chassis.py
uv run --project blender python -I blender/steering.py
uv run --project blender python -I blender/brakes.py
uv run --project blender python -I blender/thermal.py
uv run --project blender python -I blender/structure.py
uv run --project blender python -I blender/exterior_panels.py

for src in web/assets-src/*.glb; do
  name=$(basename "$src" .glb)
  "$DOCKER" exec noodlelab-web-dev sh -c "
    npx gltfpack -i assets-src/$name.glb -o public/assets/$name.glb -cc -kn -km -ke -kv -vtf &&
    npx gltfpack -i assets-src/$name.glb -o public/assets/$name.lod1.glb -cc -kn -km -ke -kv -vtf -si 0.3"
done
ls -l web/public/assets
