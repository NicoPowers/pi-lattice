#!/usr/bin/env bash
set -euo pipefail

SOCKET_DIR="/tmp/pi-lattice-ssh-agent"
SOCKET="$SOCKET_DIR/agent.sock"
ENV_FILE="/tmp/pi-lattice-ssh-agent.env"

cleanup_agent_files() {
	if [ -d "$SOCKET" ]; then
		rmdir "$SOCKET"
	else
		rm -f "$SOCKET"
	fi

	rm -f "$ENV_FILE"
}

mkdir -p "$SOCKET_DIR"

agent_usable() {
	SSH_AUTH_SOCK="$SOCKET" ssh-add -l >/dev/null 2>&1
}

agent_running() {
	SSH_AUTH_SOCK="$SOCKET" ssh-add -l >/dev/null 2>&1
	case "$?" in
	0 | 1) return 0 ;;
	*) return 1 ;;
	esac
}

if ! agent_running; then
	cleanup_agent_files
	ssh-agent -a "$SOCKET" >"$ENV_FILE"
fi

if ! agent_usable; then
	for key in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa" "$HOME/.ssh/id_ecdsa"; do
		if [ -f "$key" ]; then
			if ssh-keygen -y -P "" -f "$key" >/dev/null 2>&1; then
				SSH_AUTH_SOCK="$SOCKET" ssh-add "$key" || true
			fi
			break
		fi
	done
fi
