# The semantic API's development image: Node.js and the exact packages in package-lock.json.
# The code itself is not copied in: compose.yaml mounts the project read-only, so edits apply at once
# (node --watch restarts the server when a file changes). Node 24 runs TypeScript files directly.

FROM node:24.22.1-alpine

WORKDIR /opt/explorer
COPY package.json package-lock.json ./
# Includes the test tools (vitest): this image is for development and testing.
RUN npm ci --no-audit --no-fund

# The code runs from the mounted project; Node finds the packages by walking up to /node_modules.
RUN ln -s /opt/explorer/node_modules /node_modules

# Run as an ordinary user, not root (the image's "node" user).
USER node
WORKDIR /project/api
EXPOSE 8000
CMD ["node", "--watch", "server.ts"]
