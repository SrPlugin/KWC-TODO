# syntax=docker/dockerfile:1

# ---------- 1) Build del frontend (Vite) ----------
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- 2) Backend + build del frontend embebido ----------
FROM node:20-alpine AS server
WORKDIR /app/server

# better-sqlite3 compila un binding nativo; se necesitan herramientas de build en Alpine.
RUN apk add --no-cache python3 make g++

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/ ./
COPY --from=client-build /app/client/dist /app/client/dist

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/server/data

RUN mkdir -p "$DATA_DIR" && chown -R node:node /app/server
USER node

EXPOSE 4000
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
