# Kintzio API — production image (Render / Fly / Railway)
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/chat-widget/package.json packages/chat-widget/

RUN npm ci

COPY . .

RUN npm run build -w @kintzio/web \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV DISABLE_BROWSER_RENDER=true
ENV STATIC_BOT_BUNDLE=data/kintzio-bundle.json
EXPOSE 10000

CMD ["npm", "run", "start", "-w", "@kintzio/api"]
