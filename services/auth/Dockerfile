FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock ./
COPY services/shared/package.json ./services/shared/
COPY services/auth/package.json ./services/auth/

RUN yarn install --frozen-lockfile

COPY services/shared/src ./services/shared/src
COPY services/shared/tsconfig.json ./services/shared/

RUN cd services/shared && yarn build

COPY services/auth/src ./services/auth/src
COPY services/auth/tsconfig.json ./services/auth/

WORKDIR /app/services/auth
EXPOSE 3010
CMD ["yarn", "dev"]
