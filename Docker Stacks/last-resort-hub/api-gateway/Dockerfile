FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY src/ src/

EXPOSE 3005

CMD ["bun", "run", "src/index.ts"]
