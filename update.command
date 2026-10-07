#!/bin/bash
# Install this downloaded update INTO an existing installation, keeping its wallet.
set -euo pipefail
update_root="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 LTS from https://nodejs.org first.'
  exit 1
fi
if [ "$#" -gt 0 ]; then
  update_target="$1"
elif [ "$(uname -s)" = 'Darwin' ]; then
  update_target="$(osascript -e 'POSIX path of (choose folder with prompt "Choose your ORIGINAL Paper Team folder (the one containing your saved wallet). Close its running Terminal app first." default location (path to downloads folder))')"
else
  echo 'Usage: bash update.command /path/to/existing/crypto-paper-trading-app'
  exit 1
fi
update_target="$(cd "$update_target" && pwd)"
if [ "$update_target" = "$update_root" ]; then
  echo 'You selected the NEW download. Choose your ORIGINAL installation folder to retain its wallet.'
  exit 1
fi
node - "$update_target/package.json" <<'JS'
const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(p.name!=='crypto-paper-team')throw Error('Selected folder is not a Paper Team installation.');
JS
if [ -f "$update_target/data/server.lock" ]; then
  update_pid="$(cat "$update_target/data/server.lock")"
  case "$update_pid" in ''|*[!0-9]*) echo 'Invalid wallet lock. Close the original app and check data/server.lock.'; exit 1;; esac
  if kill -0 "$update_pid" 2>/dev/null; then
    echo 'The original app is still running. Press Control+C in its Terminal, then run this updater again.'
    exit 1
  fi
fi
update_backup="$update_target/backups/before-1.2-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$update_backup"
for update_item in src public scripts test docs data; do
  if [ -d "$update_target/$update_item" ]; then cp -R "$update_target/$update_item" "$update_backup/$update_item"; fi
done
for update_item in package.json package-lock.json config.json README.md; do
  if [ -f "$update_target/$update_item" ]; then cp -p "$update_target/$update_item" "$update_backup/$update_item"; fi
done
for update_item in src public scripts test docs; do
  mkdir -p "$update_target/$update_item"
  cp -R "$update_root/$update_item/." "$update_target/$update_item/"
done
for update_item in package.json package-lock.json README.md .gitignore .nvmrc launch.command update.command; do
  cp -p "$update_root/$update_item" "$update_target/$update_item"
done
if [ ! -f "$update_target/config.json" ]; then cp -p "$update_root/config.json" "$update_target/config.json"; fi
node - "$update_target/config.json" <<'JS'
const fs=require('fs'),file=process.argv[2],config=JSON.parse(fs.readFileSync(file,'utf8'));
config.strategyMode='active';config.learningEnabled=true;config.probeBuyUsd??=100;
config.symbols=['BTC-USD','ETH-USD','SOL-USD','ZEC-USD','PUMP-USD'];
if(config.intervalSeconds===21600){config.intervalSeconds=3600;console.log('Changed 6h interval to 1h for PUMP compatibility.');}
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
JS
chmod +x "$update_target/launch.command" "$update_target/update.command"
echo "Updated your ORIGINAL installation. Wallet preserved; backup: $update_backup"
if [ "${PAPER_UPDATE_NO_LAUNCH:-0}" = '1' ]; then exit 0; fi
exec /bin/bash "$update_target/launch.command"
