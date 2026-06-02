FROM node:20-alpine

WORKDIR /app

# --- layer: workspace manifests (for dep caching) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/orchestrator/package.json ./services/orchestrator/

# --- layer: install all workspace deps ---
RUN yarn install --frozen-lockfile

# --- layer: build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- layer: service source ---
COPY services/orchestrator/src ./services/orchestrator/src
COPY services/orchestrator/tsconfig.json ./services/orchestrator/
COPY services/orchestrator/vitest.config.ts ./services/orchestrator/

WORKDIR /app/services/orchestrator
EXPOSE 3001
CMD ["yarn", "dev"]
