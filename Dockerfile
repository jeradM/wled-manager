FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY tools/mock-wled/package.json tools/mock-wled/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @wled-manager/web build && pnpm --filter @wled-manager/server build \
 && pnpm --filter @wled-manager/server deploy --prod --legacy /out

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data WEB_DIST=/app/web MIGRATIONS_DIR=/app/drizzle PORT=8080
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./web
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/index.js"]
