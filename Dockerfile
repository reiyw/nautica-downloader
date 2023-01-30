FROM node:19-bullseye-slim
WORKDIR /app

COPY package.json .
COPY package-lock.json .

RUN npm install

RUN apt-get update && apt-get install -y --no-install-recommends \
    unar \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY nautica-downloader.js .

ENTRYPOINT ["node", "nautica-downloader.js"]
