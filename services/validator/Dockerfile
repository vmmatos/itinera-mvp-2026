FROM node:20-alpine

WORKDIR /app

# --- layer: workspace manifests (for dep caching) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/validator/package.json ./services/validator/

# --- layer: install all workspace deps ---
RUN yarn install --frozen-lockfile

# --- layer: build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- layer: service source ---
COPY services/validator/src ./services/validator/src
COPY services/validator/tsconfig.json ./services/validator/
COPY services/validator/vitest.config.ts ./services/validator/

WORKDIR /app/services/validator
EXPOSE 3006

CMD ["yarn", "dev"]
