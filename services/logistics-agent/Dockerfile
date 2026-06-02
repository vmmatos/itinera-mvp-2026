FROM node:20-alpine

WORKDIR /app

# --- layer: workspace manifests (for dep caching) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/logistics-agent/package.json ./services/logistics-agent/

# --- layer: install all workspace deps ---
RUN yarn install --frozen-lockfile

# --- layer: build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- layer: service source ---
COPY services/logistics-agent/src ./services/logistics-agent/src
COPY services/logistics-agent/tsconfig.json ./services/logistics-agent/
COPY services/logistics-agent/vitest.config.ts ./services/logistics-agent/

WORKDIR /app/services/logistics-agent
EXPOSE 3005

CMD ["yarn", "dev"]
