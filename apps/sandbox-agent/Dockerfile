# OkBot sandbox-agent (cloud computer) — OrbStack / Docker
# Base: local debian (avoids Docker Hub node image flakes); Node from nodejs.org.
FROM debian:bookworm-slim

ARG NODE_VERSION=22.14.0
ARG TARGETARCH

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    python3 \
    ripgrep \
    xz-utils \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in \
       amd64) NODE_ARCH=x64 ;; \
       arm64) NODE_ARCH=arm64 ;; \
       *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
     | tar -xJ -C /usr/local --strip-components=1 \
  && node -v && npm -v \
  && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install \
  && npx tsc -p tsconfig.json \
  && npm prune --omit=dev \
  && npm cache clean --force

ENV SANDBOX_HOST=0.0.0.0
ENV SANDBOX_PORT=18790
ENV SANDBOX_WORKDIR=/workspace
ENV HOME=/workspace
ENV SHELL=/bin/bash

WORKDIR /workspace
RUN mkdir -p /workspace

EXPOSE 18790

CMD ["node", "/app/dist/server.js"]
