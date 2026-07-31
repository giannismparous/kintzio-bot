# Kintzio API — production image (Render / Fly / Railway)
FROM node:22-bookworm-slim

WORKDIR /app

# OS libs Playwright needs (same stack as local `npx playwright install`)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/chat-widget/package.json packages/chat-widget/

RUN npm ci \
  && npx playwright install chromium

COPY . .

RUN npm run build -w @kintzio/web \
  && npm prune --omit=dev

ENV NODE_ENV=production
# Container-safe Chromium flags (Playwright browser, same as local)
ENV PLAYWRIGHT_CHROMIUM_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu
EXPOSE 10000

CMD ["npm", "run", "start:render"]
