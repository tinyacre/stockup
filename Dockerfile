# syntax=docker/dockerfile:1
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/domain/package.json packages/domain/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
# The web bundle's source maps go to GlitchTip when the glitchtip_auth_token secret is given, and never into the
# image: the last check holds dist to that.
ARG STOCKUP_RELEASE=dev
ARG GLITCHTIP_URL=
ARG GLITCHTIP_ORG=
ARG GLITCHTIP_PROJECT=
RUN --mount=type=secret,id=glitchtip_auth_token,env=GLITCHTIP_AUTH_TOKEN \
    --mount=type=secret,id=cf_access_client_id,env=CF_ACCESS_CLIENT_ID \
    --mount=type=secret,id=cf_access_client_secret,env=CF_ACCESS_CLIENT_SECRET \
    bun run --filter @stockup/web build && \
    if find packages/web/dist -name '*.map' | grep -q .; then echo 'source maps left in dist' >&2; exit 1; fi

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
# The version error reports name, X.Y.Z from a v* tag; a local build reports as dev.
ARG STOCKUP_RELEASE=dev
# Calendar dates the server fills in, such as a judgment's default date, follow the household's day.
ENV STOCKUP_RELEASE=${STOCKUP_RELEASE} \
    TZ=Asia/Shanghai \
    NODE_ENV=production \
    STOCKUP_PORT=8080 \
    STOCKUP_WEB_DIR=/app/web \
    STOCKUP_EVIDENCE_DIR=/data/evidence
EXPOSE 8080
CMD ["bun", "packages/server/src/main.ts"]
