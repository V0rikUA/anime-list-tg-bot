FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
# sqlite3 is only needed for local sqlite mode; omit optional deps in production image.
RUN npm ci --omit=dev --omit=optional

COPY . .

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
