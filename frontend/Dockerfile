FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=512 npm run build

EXPOSE 3000

CMD ["npm", "start"]
