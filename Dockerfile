FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --production

# Copy app
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]