FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN yarn install

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3009

CMD ["yarn", "dev"]
