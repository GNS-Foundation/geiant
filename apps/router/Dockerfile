FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/router/ ./apps/router/
RUN npm install -g pnpm@9.15.9
RUN pnpm install --no-frozen-lockfile
EXPOSE 3000
CMD ["node", "--import", "tsx/esm", "apps/router/src/index.ts"]
