# Container image for running mediamcp as a stdio MCP server.
# Used by Glama (and anyone who wants a ready-to-run image) to build, start,
# and introspect the server. The server starts without an API key — key
# checks happen per tool call — so `tools/list` introspection works out of the box.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# stdio transport: the MCP client speaks JSON-RPC over stdin/stdout.
ENTRYPOINT ["node", "dist/index.js"]
