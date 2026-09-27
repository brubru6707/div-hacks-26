#!/usr/bin/env bash
#
# provision.sh -- add the barn-owl dashboard to a droplet that already runs
# Caddy (the jenzombie droplet), without touching the jenzombie site.
# Run ON the droplet, as root, after push.sh has copied the app and secrets:
#
#     BO_SITES="barn-owl.tech, www.barn-owl.tech" bash /srv/barn-owl/src/deploy/provision.sh
#
# Before DNS is delegated, use an sslip.io name so Let's Encrypt can still
# issue a real certificate:  BO_SITES=barn-owl.104-248-231-139.sslip.io
#
# Safe to re-run: every step is idempotent.
set -euo pipefail

BO_SITES="${BO_SITES:?set BO_SITES, e.g. \"barn-owl.tech, www.barn-owl.tech\"}"
SRC=/srv/barn-owl/src
APP=/srv/barn-owl/app

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -f /etc/barn-owl/env ] || { echo "/etc/barn-owl/env missing -- run push.sh first" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
wait_for_apt() {
  for _ in $(seq 1 60); do
    if fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; then
      echo "  waiting for another apt to finish..."; sleep 5
    else
      return 0
    fi
  done
  echo "  apt is still locked after 5 minutes; giving up" >&2; return 1
}

if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; then
  say "node 22"
  wait_for_apt
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  wait_for_apt
  apt-get install -y -qq nodejs
fi
node -v
# Converts the Pi's 15 fps MJPEG recordings to MP4 for the browser.
# zip builds the "Download all" archive of the 15 fps videos.
if ! command -v ffmpeg >/dev/null || ! command -v zip >/dev/null; then
  say "ffmpeg and zip"
  wait_for_apt
  apt-get install -y -qq ffmpeg zip
fi

say "user and app"
id -u barn-owl >/dev/null 2>&1 || useradd --system --home /srv/barn-owl --shell /usr/sbin/nologin barn-owl
mkdir -p "$APP"
rsync -a --delete --exclude node_modules --exclude deploy "$SRC/" "$APP/"
(cd "$APP" && npm ci --omit=dev --silent)
mkdir -p /srv/barn-owl/videos
chown -R root:barn-owl /srv/barn-owl
chmod -R g+rX,o-rwx /srv/barn-owl
# The service writes uploaded videos here, and only here.
chown -R barn-owl:barn-owl /srv/barn-owl/videos
chown root:barn-owl /etc/barn-owl/env
chmod 640 /etc/barn-owl/env

say "service"
install -m 0644 "$SRC/deploy/barn-owl-web.service" /etc/systemd/system/barn-owl-web.service
systemctl daemon-reload
systemctl enable barn-owl-web >/dev/null 2>&1
systemctl restart barn-owl-web

say "caddy"
mkdir -p /etc/caddy/sites
sed "s|__SITES__|${BO_SITES}|" "$SRC/deploy/barn-owl.caddy" > /etc/caddy/sites/barn-owl.caddy
grep -q '^import /etc/caddy/sites/\*.caddy' /etc/caddy/Caddyfile \
  || printf '\nimport /etc/caddy/sites/*.caddy\n' >> /etc/caddy/Caddyfile
# Caddy will not start if it cannot open its log file.
[ -f /var/log/caddy/barn-owl.log ] || install -o caddy -g caddy -m 0644 /dev/null /var/log/caddy/barn-owl.log
# The jenzombie block reads its hostnames from this env file (via the systemd
# unit); load it too or validate fails with a phantom "www." error.
( set -a; [ -f /etc/caddy/jenzombie.env ] && . /etc/caddy/jenzombie.env; set +a
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1 )
systemctl reload caddy

say "check"
sleep 2
systemctl is-active --quiet barn-owl-web && echo "  barn-owl-web: active" \
  || { echo "  barn-owl-web FAILED"; journalctl -u barn-owl-web -n 30 --no-pager; exit 1; }
curl -fsS -o /dev/null -w "  app on :8771 -> %{http_code}\n" http://127.0.0.1:8771/
systemctl is-active --quiet caddy && echo "  caddy: active"
echo "  sites: ${BO_SITES}"
