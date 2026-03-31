FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /app/session /app/tmp-uploads /app/logs /app/config

EXPOSE 5000

CMD ["node", "src/server.js"]
