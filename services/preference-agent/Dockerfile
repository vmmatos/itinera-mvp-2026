FROM node:20-alpine

WORKDIR /app

# --- layer: workspace manifests (for dep caching) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/preference-agent/package.json ./services/preference-agent/

# --- layer: install all workspace deps ---
RUN yarn install --frozen-lockfile

# --- layer: build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- layer: service source ---
COPY services/preference-agent/src ./services/preference-agent/src
COPY services/preference-agent/tsconfig.json ./services/preference-agent/
COPY services/preference-agent/vitest.config.ts ./services/preference-agent/

WORKDIR /app/services/preference-agent
EXPOSE 3002
CMD ["yarn", "dev"]
