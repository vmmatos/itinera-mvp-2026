FROM node:20-alpine

WORKDIR /app

# --- layer: workspace manifests (for dep caching) ---
COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/notification/package.json ./services/notification/

# --- layer: install all workspace deps ---
RUN yarn install --frozen-lockfile

# --- layer: build shared library ---
COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/
RUN cd services/shared && yarn build

# --- layer: service source ---
COPY services/notification/src ./services/notification/src
COPY services/notification/tsconfig.json ./services/notification/
COPY services/notification/vitest.config.ts ./services/notification/

WORKDIR /app/services/notification
EXPOSE 3007

CMD ["yarn", "dev"]
