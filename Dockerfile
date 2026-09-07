FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

ARG SERVICE
RUN test "$SERVICE" = "web" -o "$SERVICE" = "api" -o "$SERVICE" = "worker"
RUN pnpm --filter @lrc/$SERVICE build

FROM node:24-alpine

WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
ARG SERVICE
ENV SERVICE=$SERVICE
ENV NODE_ENV=production
CMD ["sh", "-c", "pnpm --filter @lrc/$SERVICE start"]
