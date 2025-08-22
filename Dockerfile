# ---------- build frontend ----------
FROM node:20-alpine AS fe
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- build backend ----------
FROM node:20-alpine AS be
WORKDIR /app/backend

# system deps needed at install-time for better-sqlite3
RUN apk add --no-cache python3 make g++  # build-time

COPY backend/package.json backend/package-lock.json* ./
# production deps only
RUN npm ci --omit=dev
COPY backend/ ./

# copy frontend build into place (server will look at ../frontend/build)
COPY --from=fe /app/frontend/build /app/frontend/build

# (Optional) If you want to slim the image further, you can remove build tools here:
# RUN apk del --no-network make g++ python3 && apk add --no-cache libstdc++

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_FILE=/data/data.sqlite
EXPOSE 8080

# optional: healthcheck for Fly
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.js"]
