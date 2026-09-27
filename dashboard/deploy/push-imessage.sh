#!/usr/bin/env bash
# Run the Barn Owl iMessage bot (poc/imessage, Photon Spectrum) on the droplet as a service.
#
#     BO_HOST=root@104.248.231.139 ./dashboard/deploy/push-imessage.sh [--secrets] path-to-poc-checkout
#
# --secrets copies poc/imessage/.env (PROJECT_ID, PROJECT_SECRET) plus NIGHT_OWL_CHAT_BOT_TOKEN (~/.barn-owl/chat_bot_token,
# the same value push-poc.sh --secrets gives the API) to /etc/poc/imessage.env over ssh
# stdin, so it never lands in argv or in the synced tree. Only one copy of the bot may run at a time:
# stop any local `npm start` first, or every text gets two answers.
set -euo pipefail

BO_HOST="${BO_HOST:?set BO_HOST, e.g. root@104.248.231.139}"
SECRETS=0; [ "${1:-}" = "--secrets" ] && { SECRETS=1; shift; }
POC="${1:?path to the poc checkout}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "copy"
ssh "$BO_HOST" 'id poc >/dev/null 2>&1 || useradd --system --home /srv/poc --shell /usr/sbin/nologin poc; mkdir -p /srv/poc/imessage'
rsync -a --delete --exclude node_modules --exclude '.env' --exclude '.env.*' --exclude '.claude' \
  "$POC/imessage/" "$BO_HOST:/srv/poc/imessage/"

if [ "$SECRETS" = 1 ]; then
  say "secrets"
  ssh "$BO_HOST" 'umask 077; mkdir -p /etc/poc; cat > /etc/poc/imessage.env; chgrp poc /etc/poc/imessage.env; chmod 640 /etc/poc/imessage.env
    grep -c "^[A-Z_]*=" /etc/poc/imessage.env | sed "s/^/  vars: /"' \
    < <(grep -v '^NIGHT_OWL_CHAT_BOT_TOKEN=' "$POC/imessage/.env"; printf 'NIGHT_OWL_CHAT_BOT_TOKEN=%s\n' "$(cat ~/.barn-owl/chat_bot_token)")
fi

say "install + start"
scp -q "$HERE/barn-owl-imessage.service" "$BO_HOST:/etc/systemd/system/barn-owl-imessage.service"
ssh "$BO_HOST" 'set -e
  cd /srv/poc/imessage && npm ci --no-audit --no-fund --silent
  chown -R root:root /srv/poc/imessage && chmod -R a+rX /srv/poc/imessage
  systemctl daemon-reload && systemctl enable barn-owl-imessage >/dev/null 2>&1 && systemctl restart barn-owl-imessage
  sleep 6; systemctl is-active barn-owl-imessage | sed "s/^/  service: /"
  journalctl -u barn-owl-imessage -n 3 --no-pager -o cat | grep -E "agent up|rror" || true'
