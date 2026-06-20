# ── Stage 1: Frontend build ──────────────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ gcc && \
    rm -rf /var/lib/apt/lists/* && \
    npm ci
COPY . .
RUN npm run build

# ── Stage 2: Server dependencies + Playwright Chromium ───────────────────────
FROM node:20-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg python3 make g++ gcc && \
    rm -rf /var/lib/apt/lists/* && \
    npm ci --omit=dev && \
    npm install tsx && \
    npx playwright install chromium && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install dumb-init, curl (HEALTHCHECK), openssh-server, and minimal Playwright Chromium runtime deps
# Only shared libraries needed for headless Chromium (no fonts, X11, or build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init curl openssh-server sudo \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libx11-xcb1 libxfixes3 \
    fonts-freefont-ttf && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r app && useradd -r -g app -d /app -s /bin/bash app && \
    # Generate SSH host keys, configure sshd, set app user password
    mkdir -p /run/sshd && \
    ssh-keygen -A && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/UsePAM yes/UsePAM no/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config && \
    echo "HostKey /etc/ssh/ssh_host_ed25519_key" >> /etc/ssh/sshd_config && \
    echo "HostKey /etc/ssh/ssh_host_rsa_key" >> /etc/ssh/sshd_config && \
    echo "HostKey /etc/ssh/ssh_host_ecdsa_key" >> /etc/ssh/sshd_config && \
    echo "app:app123" | chpasswd && \
    echo "app ALL=(root) NOPASSWD:/usr/sbin/sshd,/usr/bin/ssh-keygen" >> /etc/sudoers && \
    # Verify hostkeys exist
    ls /etc/ssh/ssh_host_*key >/dev/null 2>&1 || ssh-keygen -A

# Create startup script that launches both sshd and the app
COPY --chown=app:app docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app

# Copy server dependencies from build stage
COPY --from=server-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=server-deps --chown=app:app /root/.cache/ms-playwright /app/.cache/ms-playwright

# Copy frontend build output
COPY --from=frontend-build --chown=app:app /build/dist ./dist

# Copy application source
COPY --chown=app:app tsconfig.json ./
COPY --chown=app:app server.ts ./
COPY --chown=app:app bot.ts ./
COPY --chown=app:app mcp/ ./mcp/
COPY --chown=app:app config/ ./config/
COPY --chown=app:app contracts/ ./contracts/
COPY --chown=app:app lib/ ./lib/
COPY --chown=app:app routes/ ./routes/
COPY --chown=app:app ops/ ./ops/

# Copy manifest schemas needed at runtime for validation
COPY --chown=app:app .planning/spec-kit/manifest/ .planning/spec-kit/manifest/
COPY --chown=app:app .planning/spec-kit/specs/ .planning/spec-kit/specs/
COPY --chown=app:app .agent/contracts/ .agent/contracts/

# Create persistent data directories (mounted as volumes at runtime)
RUN mkdir -p /app/data/browser-profile /app/data/logs /app/data/artifacts && \
    chown -R app:app /app/data

USER app

# Environment defaults for container execution
ENV NODE_ENV=production \
    BOT_PROFILE_DIR=/app/data/browser-profile \
    ACTIVITY_LOG_PATH=/app/data/logs/activity_log.json \
    BROWSER_HEADLESS=true \
    DEV_SKIP_BOT=false \
    DRY_RUN_MODE=true

ENTRYPOINT ["dumb-init", "--", "docker-entrypoint.sh"]
CMD ["node", "--max-old-space-size=400", "--expose-gc", "--enable-source-maps", \
     "node_modules/.bin/tsx", "server.ts"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

EXPOSE 3000 22
