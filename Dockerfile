FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.mjs auth.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/game.sqlite
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
