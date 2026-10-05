# API + worker image (same image, different command)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund && npx prisma generate --schema packages/db/prisma/schema.prisma
ENV NODE_ENV=production TZ=Africa/Cairo
EXPOSE 3000
CMD ["npx", "tsx", "apps/api/src/server.ts"]
