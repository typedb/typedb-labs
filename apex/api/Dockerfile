# The Apex API image: the read-only API, and the one-off "seed" step that creates the
# database on first start (see compose.yaml). Built from the repository root:
#   docker build -f api/Dockerfile .
# Node 24 runs TypeScript directly (type stripping is on by default), so nothing is compiled.

FROM node:24.22.1-alpine
WORKDIR /app

# The exact package versions recorded in api/package-lock.json, production only.
COPY api/package.json api/package-lock.json ./api/
RUN cd api && npm ci --omit=dev --no-audit --no-fund

COPY LICENSE NOTICE ./
COPY api ./api
# The seed step reads these; the API itself reads its copies in api/src/generated (npm run gen).
COPY schema ./schema
COPY config ./config
COPY data/seed ./data/seed

# Run as an ordinary user, not root (the node image provides one).
USER node
WORKDIR /app/api
ENV NODE_ENV=production
EXPOSE 8000
CMD ["node", "server.ts"]
