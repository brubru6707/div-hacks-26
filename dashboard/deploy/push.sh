#!/usr/bin/env bash
#
# push.sh -- copy the dashboard (and, with --secrets, its env file) to the
# droplet, then run provision.sh there. Run on the Mac from anywhere:
#
#     BO_HOST=root@104.248.231.139 BO_SITES="barn-owl.tech, www.barn-owl.tech" \
#       ./dashboard/deploy/push.sh [--secrets]
#
# --secrets builds /etc/barn-owl/env from dashboard/.env.local (the values
# `vercel env pull` wrote), so both sites share one database and one login.
# It goes over ssh stdin -- never on a command line or in a URL.
set -euo pipefail

BO_HOST="${BO_HOST:?set BO_HOST, e.g. root@104.248.231.139}"
BO_SITES="${BO_SITES:?set BO_SITES}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ "${1:-}" = "--secrets" ]; then
  say "secrets"
  [ -f "$HERE/.env.local" ] || { echo "no $HERE/.env.local -- run: vercel env pull" >&2; exit 1; }
  grep -E '^(MONGODB_URI|TIGER_DATABASE_URL|DASH_USER|DASH_PASS|SESSION_SECRET|PI_TOKEN|AGENT_TOKEN|SOLANA_[A-Z_]+)=' "$HERE/.env.local" \
    | ssh "$BO_HOST" 'umask 077; mkdir -p /etc/barn-owl; cat > /etc/barn-owl/env; wc -l < /etc/barn-owl/env | sed "s/^/  vars: /"'
fi

say "app"
ssh "$BO_HOST" 'mkdir -p /srv/barn-owl/src'
rsync -a --delete --exclude node_modules --exclude .vercel --exclude '.env*' "$HERE/" "$BO_HOST:/srv/barn-owl/src/"

say "provision"
ssh "$BO_HOST" "BO_SITES='$BO_SITES' bash /srv/barn-owl/src/deploy/provision.sh"
