FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json .
RUN npm install
COPY . .
EXPOSE 5003
CMD ["node", "./src/server.js"]