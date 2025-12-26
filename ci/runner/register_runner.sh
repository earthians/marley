#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <github-owner-or-org> <repo-name>"
  echo "This script will prompt for a runner registration token."
  exit 1
fi

OWNER="$1"
REPO="$2"

read -p "Enter runner registration token (from GitHub -> Settings -> Actions -> Runners): " -r TOKEN
if [ -z "$TOKEN" ]; then
  echo "No token provided; aborting"
  exit 1
fi

ARCH=$(uname -m)
RUNNER_DIR="$HOME/actions-runner"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

echo "Downloading GitHub Actions runner..."
LATEST=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name)
ASSET_URL=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | jq -r '.assets[] | select(.name|test("linux-x64")) | .browser_download_url')
if [ -z "$ASSET_URL" ]; then
  ASSET_URL=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | jq -r '.assets[0].browser_download_url')
fi
curl -L -o actions-runner.tar.gz "$ASSET_URL"
tar xzf actions-runner.tar.gz

echo "Configuring runner for ${OWNER}/${REPO}"
./config.sh --url https://github.com/${OWNER}/${REPO} --token "$TOKEN" --unattended --replace

echo "To run the runner in background, create a systemd service or run: ./run.sh &"
