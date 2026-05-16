# ─── Relowa API ────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy workspace files
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Build
RUN pnpm --filter @relowa/api build

EXPOSE 3000

CMD ["pnpm", "--filter", "@relowa/api", "dev"]
