#!/usr/bin/env bash
set -euo pipefail

USERNAME="${DEVCONTAINER_USERNAME:-node}"
HOME_DIR="/home/${USERNAME}"

if [ "$(id -u)" = "0" ]; then
	mkdir -p \
		"${HOME_DIR}/.pi" \
		"${HOME_DIR}/.npm-global" \
		"${HOME_DIR}/.bun" \
		"${HOME_DIR}/.bun/install" \
		"${HOME_DIR}/.bun/install/cache"

	chown -R "${USERNAME}:${USERNAME}" \
		"${HOME_DIR}/.pi" \
		"${HOME_DIR}/.npm-global" \
		"${HOME_DIR}/.bun"
fi

exec "$@"
