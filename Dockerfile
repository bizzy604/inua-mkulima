FROM node:24.14.0-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "npm run setup:local && npm run db:migrate && npm run db:seed && npm run dev"]
