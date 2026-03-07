FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-gdal \
    gdal-bin \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN cd packages/mcp-gdal && npx tsc --outDir dist --esModuleInterop --module nodenext --target es2022 --moduleResolution nodenext --skipLibCheck src/index.ts && cp src/gdal_worker.py dist/gdal_worker.py

EXPOSE 3201
CMD ["node", "packages/mcp-gdal/dist/index.js"]
