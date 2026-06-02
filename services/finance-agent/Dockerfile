FROM node:20-alpine

WORKDIR /app

# --- layer: workspace manifests (for dep caching) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/finance-agent/package.json ./services/finance-agent/

# --- layer: install all workspace deps ---
RUN yarn install --frozen-lockfile

# --- layer: build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- layer: service source ---
COPY services/finance-agent/src ./services/finance-agent/src
COPY services/finance-agent/tsconfig.json ./services/finance-agent/
COPY services/finance-agent/vitest.config.ts ./services/finance-agent/

WORKDIR /app/services/finance-agent
EXPOSE 3004

CMD ["yarn", "dev"]
