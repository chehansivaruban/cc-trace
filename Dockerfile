# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN STANDALONE=1 pnpm build

FROM node:22-alpine
WORKDIR /app
# HOSTNAME=0.0.0.0 is needed inside the container for -p to work; publish to 127.0.0.1 on the host.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CLAUDE_CONFIG_DIR=/claude \
    CC_TRACE_POLL=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
