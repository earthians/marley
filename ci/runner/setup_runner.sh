#!/usr/bin/env bash
set -euo pipefail

echo "Install prerequisites for a self-hosted GitHub Actions runner (Ubuntu)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root or via sudo"
  exit 1
fi

apt update
apt install -y apt-transport-https ca-certificates curl gnupg lsb-release software-properties-common

# Install Docker
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io

# Add current user to docker group (caller should relogin)
if id "${SUDO_USER:-$(whoami)}" &>/dev/null; then
  usermod -aG docker "${SUDO_USER:-$(whoami)}" || true
fi

# Install Docker Compose (plugin)
apt install -y docker-compose-plugin || true

# Install common tools
apt install -y git build-essential wget unzip jq

# Install Node.js (LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt install -y nodejs

echo "Runner prerequisites installed. Next: register the GitHub Actions runner using register_runner.sh"
echo "Then, optionally install Bench or configure Docker-based bench runs."

exit 0
