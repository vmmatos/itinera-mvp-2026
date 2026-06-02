FROM node:20-alpine

WORKDIR /app

# --- layer: workspace manifests (for dep caching) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/ws-relay/package.json ./services/ws-relay/

# --- layer: install all workspace deps ---
RUN yarn install --frozen-lockfile

# --- layer: build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- layer: service source ---
COPY services/ws-relay/src ./services/ws-relay/src
COPY services/ws-relay/tsconfig.json ./services/ws-relay/
COPY services/ws-relay/vitest.config.ts ./services/ws-relay/

WORKDIR /app/services/ws-relay
EXPOSE 3009
CMD ["yarn", "dev"]
