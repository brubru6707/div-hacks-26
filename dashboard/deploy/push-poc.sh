#!/usr/bin/env bash
#
# push-poc.sh -- put the team app (github.com/EthanChen5291/poc) on barn-owl.tech:
# the web app at /, its FastAPI at /api/*. The Pi dashboard moves to /admin
# (see barn-owl.caddy; run push.sh after this the first time so Caddy picks it up).
# Run on the Mac:
#
#     BO_HOST=root@104.248.231.139 ./dashboard/deploy/push-poc.sh [--secrets] [path-to-poc-checkout]
#
# --secrets writes /etc/poc/env: XAI_API_KEY from ~/.barn-owl/xai_key (the Grok assistant) and AGENT_TOKEN
# from dashboard/.env.local (read-only access to the barn-owl dashboard). Over ssh stdin, never argv.
#
# Builds the web app here (the droplet has 1 GB of RAM), then copies the repo
# minus the heavy bits and (re)starts the API. Re-run it to deploy new commits.
set -euo pipefail

BO_HOST="${BO_HOST:?set BO_HOST, e.g. root@104.248.231.139}"
SECRETS=0; [ "${1:-}" = "--secrets" ] && { SECRETS=1; shift; }
POC="${1:-${POC:-}}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ -z "$POC" ]; then
  POC="$(mktemp -d)/poc"
  say "clone"
  git clone -q --depth 1 https://github.com/EthanChen5291/poc.git "$POC"
fi
# The city bake (web/public/city, ~288 MB) is gitignored and ships as a release asset, pinned to a
# tag so a re-bake is a deliberate bump. This runs on this machine, so it uses its gh login.
CITY_BAKE_TAG=city-bake-v1
if [ ! -f "$POC/web/public/city/tiles.json" ]; then
  say "city bake ($CITY_BAKE_TAG)"
  gh release download "$CITY_BAKE_TAG" -R EthanChen5291/poc -p city-bake.tar.gz -D "$POC/web/public" --clobber
  tar -xzf "$POC/web/public/city-bake.tar.gz" -C "$POC/web/public" && rm "$POC/web/public/city-bake.tar.gz"
fi
say "build web ($(git -C "$POC" log -1 --format='%h %s'))"
( cd "$POC/web" && npm ci --no-audit --no-fund --silent && npm run build --silent && node scripts/cell-centres.mjs )
# Same owl tab icon as the dashboard, in place of Vite's default lightning bolt.
cp "$HERE/owl-favicon.svg" "$POC/web/dist/favicon.svg"

say "copy"
ssh "$BO_HOST" 'id poc >/dev/null 2>&1 || useradd --system --home /srv/poc --shell /usr/sbin/nologin poc
  mkdir -p /srv/poc/src /var/lib/poc && chown poc:poc /var/lib/poc'
rsync -a --delete --exclude .git --exclude node_modules --exclude .venv --exclude 'vision/' \
  --exclude 'renders/' --exclude 'api/events.jsonl' --exclude '.env' --exclude '.env.*' --exclude 'imessage/' "$POC/" "$BO_HOST:/srv/poc/src/"

if [ "$SECRETS" = 1 ]; then
  say "secrets"
  { printf 'XAI_API_KEY=%s\n' "$(cat ~/.barn-owl/xai_key)"; grep -E '^AGENT_TOKEN=' "$HERE/../.env.local" | tr -d '"'; } \
    | ssh "$BO_HOST" 'umask 077; mkdir -p /etc/poc; cat > /etc/poc/env; chgrp poc /etc/poc/env; chmod 640 /etc/poc/env; wc -l < /etc/poc/env | sed "s/^/  vars: /"'
fi

say "api"
scp -q "$HERE/poc-api.service" "$BO_HOST:/etc/systemd/system/poc-api.service"
ssh "$BO_HOST" 'set -e
  command -v uv >/dev/null || { curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh >/dev/null; }
  cd /srv/poc/src/api && UV_PROJECT_ENVIRONMENT=.venv uv sync --frozen --no-dev --quiet
  chown -R root:root /srv/poc/src && chmod -R a+rX /srv/poc/src
  systemctl daemon-reload && systemctl enable poc-api >/dev/null 2>&1 && systemctl restart poc-api
  sleep 2; curl -fsS -w "  api on :8772 -> %{http_code}\n" -o /dev/null http://127.0.0.1:8772/health'
