#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo 'Install Node.js 24 LTS from https://nodejs.org, then run this file again.'
  exit 1
fi
npm ci --cache "${TMPDIR:-/tmp}/crypto-paper-npm-cache" --no-audit --no-fund
if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${CODEX_API_KEY:-}" ]; then
  if ! ./node_modules/.bin/codex login status >/dev/null 2>&1; then
    echo 'Sign in to Codex in your browser. The application never stores your key.'
    ./node_modules/.bin/codex login
  fi
fi
exec npm start
