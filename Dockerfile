FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/domain/package.json packages/domain/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
RUN bun run --filter @stockup/web build

FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/domain/package.json packages/domain/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile --production --filter @stockup/server
COPY packages/domain/src packages/domain/src
COPY packages/server/src packages/server/src
COPY packages/server/drizzle packages/server/drizzle
COPY --from=build /app/packages/web/dist web
# Calendar dates the server fills in, such as a judgment's default date, follow the household's day.
ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    STOCKUP_PORT=8080 \
    STOCKUP_WEB_DIR=/app/web \
    STOCKUP_EVIDENCE_DIR=/data/evidence
EXPOSE 8080
CMD ["bun", "packages/server/src/main.ts"]
