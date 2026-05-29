FROM node:22-bookworm

ARG USERNAME=node

ENV BUN_INSTALL=/home/${USERNAME}/.bun
ENV NPM_CONFIG_PREFIX=/home/${USERNAME}/.npm-global
ENV PATH=/home/${USERNAME}/.bun/bin:/home/${USERNAME}/.npm-global/bin:${PATH}

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
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

USER ${USERNAME}
RUN curl -fsSL https://bun.sh/install | bash

USER root
RUN mkdir -p /home/${USERNAME}/.pi \
  /home/${USERNAME}/.npm-global \
  /home/${USERNAME}/.bun/install/cache \
  && chown -R ${USERNAME}:${USERNAME} \
    /home/${USERNAME}/.pi \
    /home/${USERNAME}/.npm-global \
    /home/${USERNAME}/.bun

USER ${USERNAME}
RUN npm install -g @earendil-works/pi-coding-agent @os-eco/mulch-cli@0.10.1 @os-eco/seeds-cli@0.4.7

USER root
COPY .devcontainer/devcontainer-entrypoint.sh /usr/local/bin/pi-lattice-devcontainer-entrypoint
RUN chmod +x /usr/local/bin/pi-lattice-devcontainer-entrypoint
ENTRYPOINT ["/usr/local/bin/pi-lattice-devcontainer-entrypoint"]

WORKDIR /workspaces/pi-lattice
