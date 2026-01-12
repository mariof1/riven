# Frontend Builder
FROM node:24-alpine AS frontend
ENV NODE_OPTIONS=--max-old-space-size=4096
WORKDIR /app
COPY . .
RUN npm install -g pnpm && pnpm install
RUN pnpm run build
RUN pnpm prune --prod

# Final Image
FROM node:24-alpine
LABEL name="Riven" \
    description="Riven Media Server: Frontend" \
    url="https://github.com/rivenmedia/riven-frontend"

# Postgres (dev): run DB inside this container
RUN apk add --no-cache postgresql17 su-exec

# Set working directory
WORKDIR /riven

# Copy frontend build from the previous stage
COPY --from=frontend  /app/build /riven/build
COPY --from=frontend  /app/node_modules /riven/node_modules
COPY --from=frontend  /app/package.json /riven/package.json
COPY drizzle /riven/drizzle

# Add the entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "/riven/build"]