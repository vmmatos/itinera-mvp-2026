FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN yarn install

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

CMD ["yarn", "dev"]
