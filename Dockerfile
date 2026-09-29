# Development image: src/ is bind-mounted by syner/docker-compose.yml (hot-reload).
# node_modules stays in the image so native deps are built for Linux.
# procps provides `ps`, which `nest start --watch` (tree-kill) needs to stop the
# previous process on reload; without it the old process keeps the port bound.
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates procps \
    && rm -rf /var/lib/apt/lists/* \
    && npm i -g pnpm@11.1.3

WORKDIR /app

# pnpm-workspace.yaml carries allowBuilds for the native build scripts
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3002

CMD ["pnpm", "start:dev"]
