# ── Stage 1: Frontend build ──────────────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Server dependencies + Playwright Chromium ───────────────────────
FROM node:20-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg && \
    rm -rf /var/lib/apt/lists/* && \
    npm ci --omit=dev && \
    npx playwright install chromium --with-deps && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install dumb-init and curl (needed for HEALTHCHECK)
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init curl && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r app && useradd -r -g app -d /app -s /bin/bash app

WORKDIR /app

# Copy server dependencies from build stage
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /root/.cache/ms-playwright /root/.cache/ms-playwright

# Copy frontend build output
COPY --from=frontend-build /build/dist ./dist

# Copy application source
COPY tsconfig.json ./
COPY server.ts ./
COPY bot.ts ./
COPY mcp/ ./mcp/
COPY config/ ./config/
COPY contracts/ ./contracts/
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY ops/ ./ops/

# Create persistent data directories (mounted as volumes at runtime)
RUN mkdir -p /app/data/browser-profile /app/data/logs /app/data/artifacts && \
    chown -R app:app /app/data /app/node_modules

USER app

# Environment defaults for container execution
ENV NODE_ENV=production \
    BOT_PROFILE_DIR=/app/data/browser-profile \
    ACTIVITY_LOG_PATH=/app/data/logs/activity_log.json \
    BROWSER_HEADLESS=true \
    DEV_SKIP_BOT=false \
    DRY_RUN_MODE=true

# Playwright Chromium needs --disable-dev-shm-usage on small /dev/shm
# Node.js memory capped at 400 MB for 512 MB hosts
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--max-old-space-size=400", "--expose-gc", "--enable-source-maps", \
     "node_modules/.bin/tsx", "server.ts"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

EXPOSE 3000
