# Stage 1: Build
FROM oven/bun:alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile

COPY . .

# Build with node adapter
ENV ADAPTER=node
ARG BASE_PATH=/SEQuiz

RUN BASE_PATH="$BASE_PATH" bun run build

# Stage 2: Runtime
FROM oven/bun:alpine

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts/setup-database.ts ./scripts/setup-database.ts
COPY --from=builder /app/scripts/seed-users.ts ./scripts/seed-users.ts
COPY --from=builder /app/src/lib/server ./src/lib/server
COPY --from=builder /app/src/lib/blob/base.ts /app/src/lib/blob/filesystem.ts ./src/lib/blob/
COPY --from=builder /app/src/lib/types.ts ./src/lib/types.ts
COPY --from=builder /app/src/schema.postgres.sql ./src/schema.postgres.sql

ENV PORT=3000
EXPOSE 3000

# PUBLIC_* and ORIGIN env vars are read at runtime by SvelteKit's dynamic env module
CMD ["sh", "-c", "bun run db:setup && exec bun /app/build/index.js"]
