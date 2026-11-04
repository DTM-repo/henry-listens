FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY relay ./relay
COPY docs/record.schema.json ./docs/record.schema.json
COPY web ./web
ENV RELAY_PORT=8787
EXPOSE 8787
CMD ["node", "relay/server.mjs"]
