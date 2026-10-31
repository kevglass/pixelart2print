#!/usr/bin/env bash
set -euo pipefail

REMOTE_USER="kevglass"
REMOTE_HOST="cokeandcode.com"
REMOTE_DIR="cokeandcode.com/pixelart2print"
URL="https://cokeandcode.com/pixelart2print/"

cd "$(dirname "$0")"

echo "Testing..."
npm test

# The build uses relative paths (base './'), so it works from any subfolder.
echo "Building..."
npm run build

echo "Setting local permissions..."
find dist -type d -exec chmod 755 {} \;
find dist -type f -exec chmod 644 {} \;

echo "Deploying to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR} ..."
rsync -avz --delete \
  dist/ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

echo "Setting remote permissions..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "find '${REMOTE_DIR}' -type d -exec chmod 755 {} \; && find '${REMOTE_DIR}' -type f -exec chmod 644 {} \;"

# Hosted as static files there's no dev server, so "Open in Bambu Studio"
# downloads the 3MF instead; run locally with npm run dev for the direct link.
echo "Deploy complete: ${URL}"
