FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY client ./client
COPY site-integration ./site-integration
RUN useradd --system --uid 10001 lesaca && mkdir -p /data /keys && chown lesaca /data /keys
USER lesaca
ENV DATA_DIR=/data KEYS_DIR=/keys HOST=0.0.0.0 PORT=8443 TRUST_PROXY=1
EXPOSE 8443
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8443/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
