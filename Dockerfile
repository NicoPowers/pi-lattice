FROM node:22-bookworm

ARG USERNAME=node
ARG PI_VERSION=0.75.1
ARG BUN_VERSION=1.3.14

ENV BUN_INSTALL=/home/${USERNAME}/.bun
ENV PATH=/home/${USERNAME}/.bun/bin:${PATH}

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    less \
    openssh-client \
    pkg-config \
    python3 \
    ripgrep \
    unzip \
  && rm -rf /var/lib/apt/lists/*

USER ${USERNAME}
RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}

USER root
RUN npm install -g @earendil-works/pi-coding-agent@${PI_VERSION}

USER ${USERNAME}
WORKDIR /workspaces/pi-agent-orchestrator
