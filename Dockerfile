FROM node:22.22.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY app ./app
COPY team ./team
ENV UNMEET_HOST=0.0.0.0
ENV UNMEET_PORT=8787
ENV UNMEET_DB=/data/unmeet.db
VOLUME ["/data"]
EXPOSE 8787
RUN groupadd --system unmeet && useradd --system --gid unmeet --home /app unmeet && mkdir -p /data && chown -R unmeet:unmeet /app /data
USER unmeet
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "team/server.js"]
