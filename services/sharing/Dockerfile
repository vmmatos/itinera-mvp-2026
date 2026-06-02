FROM node:20-alpine

WORKDIR /app

# --- workspace manifests (dep cache layer) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/sharing/package.json ./services/sharing/

# --- install workspace deps ---
RUN yarn install --frozen-lockfile

# --- chromium + fonts for puppeteer-core ---
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-emoji

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# --- build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- service source ---
COPY services/sharing/src ./services/sharing/src
COPY services/sharing/tsconfig.json ./services/sharing/
COPY services/sharing/vitest.config.ts ./services/sharing/

WORKDIR /app/services/sharing
EXPOSE 3008

CMD ["yarn", "dev"]
