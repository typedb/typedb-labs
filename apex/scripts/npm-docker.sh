#!/bin/sh
# Run npm/npx for the frontend inside the official Node Docker image, for computers without
# Node.js installed. Usage, from the project root:
#   scripts/npm-docker.sh npm install
#   scripts/npm-docker.sh npm run build
# Files are written as your own user, not root. Ports are not published (use Docker Compose
# or a local Node install to run the dev server).
set -e
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" >/dev/null 2>&1 || DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
cd "$(dirname "$0")/../web"
exec "$DOCKER" run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e npm_config_update_notifier=false -v "$PWD":/web -w /web node:24.22.1-alpine "$@"
