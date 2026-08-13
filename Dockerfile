FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY app ./app
COPY team ./team
ENV UNMEET_HOST=0.0.0.0
ENV UNMEET_PORT=8787
ENV UNMEET_DB=/data/unmeet.db
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "team/server.js"]
