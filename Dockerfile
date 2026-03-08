# =============================================================================
# Edict MCP Server — Docker Image
# =============================================================================
# Multi-stage build: compile TypeScript, then production-only image.
#
# Usage:
#   docker build -t edict .
#   docker run -i edict                                          # stdio (default)
#   docker run -p 3000:3000 -e EDICT_TRANSPORT=http edict        # HTTP
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build — install all deps, generate schema, compile TypeScript
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /edict

# Copy package files first for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDeps for tsc, schema generation)
RUN npm ci --ignore-scripts

# Copy source and static assets needed for build
COPY tsconfig.json ./
COPY src/ src/
COPY schema/ schema/
COPY examples/ examples/

# Compile TypeScript (schema files are already committed in schema/)
RUN npx tsc

# ---------------------------------------------------------------------------
# Stage 2: Production — minimal runtime image
# ---------------------------------------------------------------------------
FROM node:20-slim

WORKDIR /edict

# Copy package files and install production-only deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output
COPY --from=build /edict/dist/ dist/

# Copy runtime assets (read by MCP handlers at runtime)
COPY --from=build /edict/schema/ schema/
COPY --from=build /edict/examples/ examples/

# HTTP transport port (only used with EDICT_TRANSPORT=http)
EXPOSE 3000

# Default: stdio transport (MCP standard for local servers)
# Override with: -e EDICT_TRANSPORT=http
ENTRYPOINT ["node", "dist/mcp/server.js"]
