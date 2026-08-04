# Build base — includes native-module compilation tools (NOT used in production)
# Debian bookworm-slim on Node 24 LTS (glibc, not musl) — picked over Alpine for
# fewer unfixed-CVE flags and a more conventional native-module build environment.
FROM node:24-bookworm-slim AS build-base

# Refresh package index and apply security patches
RUN apt-get update \
    && apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/*

# Install build dependencies for native modules (better-sqlite3, node-pty)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies (for building)
FROM build-base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.js scripts/sync-pdf-worker.js ./scripts/
RUN npm ci

# Install production-only dependencies (for the final image)
FROM build-base AS deps-prod
WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.js scripts/sync-pdf-worker.js ./scripts/
RUN npm ci --omit=dev && npm rebuild

# Development stage
FROM build-base AS development
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.js scripts/sync-pdf-worker.js ./scripts/

# Install all dependencies (including dev dependencies for development)
RUN npm ci

# Copy source code
COPY . .

# Rebuild native modules for the current Debian/glibc platform
RUN npm rebuild

# Generate self-signed localhost certificate for dev SSL usage
# (openssl ships in bookworm-slim, but install explicitly for clarity)
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p certs && \
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout certs/localhost-key.pem \
      -out certs/localhost.pem \
      -days 365 \
      -subj "/C=US/ST=Development/L=Local/O=Quilltap Dev/OU=Dev/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Same entrypoint as production, so the timezone knobs stay in lockstep here too
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "run", "dev"]

# Build stage
FROM build-base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build plugins first (transpile TypeScript to JavaScript)
# SKIP_ENV_VALIDATION=true skips runtime env var validation during build
RUN SKIP_ENV_VALIDATION=true npm run build:plugins

# Remove plugin node_modules (dependencies are bundled during build)
RUN rm -rf /app/plugins/dist/*/node_modules

# Build Next.js using webpack (Turbopack default in Next 16+ exceeds Docker memory limits)
# SKIP_ENV_VALIDATION=true skips runtime env var validation during build
# NODE_OPTIONS caps V8 heap to prevent OOM-kills in memory-constrained containers
RUN SKIP_ENV_VALIDATION=true NODE_OPTIONS="--max-old-space-size=3072" npx next build --webpack

# Overlay our custom server entry, terminal WS handler, child entry, and bootstrap
# shim onto the Next.js standalone tree. Single source of truth lives in
# scripts/build-standalone-overlay.mjs — the same script is invoked from
# .github/workflows/release.yml and scripts/build-standalone-tarball.ts so the
# esbuild flags and the child's externals list can't drift between call sites.
RUN node scripts/build-standalone-overlay.mjs .next/standalone

# Production stage — clean image WITHOUT build tools (python3/make/g++)
FROM node:24-bookworm-slim AS production
WORKDIR /app

# Refresh package index and apply security patches
RUN apt-get update \
    && apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true

# Create non-root user (Debian groupadd/useradd, not Alpine busybox addgroup/adduser)
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

# Create data directories (data, files, logs, plugins/npm)
RUN mkdir -p /app/quilltap/data /app/quilltap/files /app/quilltap/logs /app/quilltap/plugins/npm && \
    chown -R nextjs:nodejs /app/quilltap

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy plugins (required for LLM providers, auth, themes, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/plugins/dist ./plugins/dist

# Copy package files for native module dependencies
COPY package.json package-lock.json ./

# Install runtime tools:
#   - zip + unzip — backup/restore (lib/backup/restore/archive.ts and
#     lib/backup/backup-service.ts shell out to `unzip` / `zip`)
#   - bash — required by Ariel's terminal (PTY hard-codes /bin/bash)
#
# git/curl/wget/jq were previously pre-installed here as a convenience toolbox for
# the LLM shell agent. They were removed for CVE surface: `git` drags in Debian's
# perl (2 CRITICAL + 2 HIGH, all "not fixed" in both bookworm and trixie) and
# curl/git pull libssh2 (CVE-2025-15661 HIGH, no fix). None of them are on a code
# path — the `curl` *tool* is qtap-plugin-curl, which uses Node's fetch(), not the
# binary. Only a human/agent typing at Ariel's bash prompt loses them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash zip unzip \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-compiled production node_modules from build stage (native modules already built)
COPY --from=deps-prod /app/node_modules ./node_modules

# Bundle the quilltap CLI so debugging inside the container can use
# `quilltap db --tables`, `quilltap db --mount-points "..."`, etc. The CLI's
# runtime deps (better-sqlite3-multiple-ciphers, sharp, tar, yauzl) all live
# in the root /app/node_modules above, so Node's module resolution walking
# up from /app/packages/quilltap/bin reuses them — no duplicate install.
COPY --from=builder --chown=nextjs:nodejs /app/packages/quilltap ./packages/quilltap
RUN ln -s /app/packages/quilltap/bin/quilltap.js /usr/local/bin/quilltap

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# --- Attack-surface reduction (must stay LAST: no apt-get or npm may follow) ---
#
# 1. npm / npx / corepack / yarn ship in the node base image and account for one
#    CRITICAL and six HIGH findings (tar, brace-expansion, undici, ip-address —
#    npm's own bundled node_modules). The container's only command is
#    `node server.js`, and plugin installs go through lib/plugins/registry-client.ts,
#    which downloads and extracts registry tarballs over HTTP rather than shelling
#    out to the npm CLI. Nothing at runtime executes any of these binaries.
#
# 2. Debian's perl carries 2 CRITICAL + 2 HIGH with no fix available in bookworm
#    *or* trixie, so no base-image bump clears them. perl-base is Essential, hence
#    --force-remove-essential. Nothing in Quilltap invokes perl; it was only present
#    as a dependency of the git package removed above.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
    && dpkg --purge --force-remove-essential --force-depends \
           perl perl-base perl-modules-5.36 libperl5.36 2>/dev/null || true

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=4096"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
