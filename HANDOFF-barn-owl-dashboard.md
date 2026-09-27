# Barn Owl: dashboard, recording pipeline, and training data

Handoff for everything built on top of the Pi 5 camera node on 2026-09-26
(DivHacks). The hardware bring-up is in `HANDOFF-pi5-camera-pir-node.md`; this
file covers what came after: the web dashboard, how footage is recorded and
stored, and where the training data stands.

This repo is public. Secrets are **not** in this file; it says where each one
lives instead.

---

## 1. What exists, in one minute

| Thing | Where |
|---|---|
| Dashboard (primary) | **https://barn-owl.tech** (DigitalOcean droplet, shared with jenzombie) |
| Dashboard (backup) | https://barn-owl.vercel.app (same code, same database, no 15 fps features) |
| Dashboard login | ask Bruno. Stored as `DASH_USER` / `DASH_PASS` in the Vercel project env and `/etc/barn-owl/env` on the droplet |
| Pi program | `pi/agent.py`, runs as systemd service `barn-owl` on the Pi, starts at boot |
| Web app code | `dashboard/` (Node, no framework) |
| Databases | MongoDB Atlas free tier (512 MB), database `barn_owl` (media + live state), and **Tiger Data** (Tiger Cloud, TimescaleDB) for the time series, see 5 |
| All 15 fps videos as one zip | https://barn-owl.tech/api/videos-zip (must be logged in) |

What the dashboard does:

- **Live** tab: camera view at **1 fps** (default) or **15 fps** (barn-owl.tech only), zoom presets **1× / 1.5× / 2× / 2.5×**, rotate, PIR motion status + "last motion", IR light toggle, **● Record / ■ Stop**.
- **Recordings** tab: every recording as a MongoDB entry, with a 1 fps preview player, the raw document (`{ } Entry`), delete, and storage used out of 512 MB.
- **Videos (15 fps)** tab: each recording's full-rate video next to the matching 1 fps preview (synced by time), plus downloads: MP4, original MJPEG, frame-times `.txt`, and **Download all (.zip)**.
- **Totals bar** (every tab): recordings count/time, Pi frames/time/size, MongoDB preview frames/size.
- The page **dims** and the top-right says **Pi offline** when the Pi stops checking in (15 s grace).
- A browser stays logged in for a year (signed cookie).

---

## 2. How it fits together

```
                    campus Wi-Fi ("Columbia University", open)
   Raspberry Pi 5  ─────────────────────────────────────────────►  barn-owl.tech (droplet, Caddy → Node :8771)
   pi/agent.py                                                     │  /api/pi          state + 1 fps preview (every 1–3 s)
     • camera: one rpicam-vid, 640×480 @ 15 fps MJPEG              │  /api/stream-in   15 fps live push (only while watched)
     • PIR GPIO23, IR GPIO4                                        │  /api/video-in    finished 15 fps recordings
     • writes 15 fps recordings to ~/barn-owl/recordings           │  /srv/barn-owl/videos  (.mjpeg .txt .mp4)
     • uploads them when done                                      ▼
                     └── falls back to barn-owl.vercel.app ──► MongoDB Atlas (barn_owl) ◄── both sites read/write
```

The Pi is behind campus NAT, so nothing can connect *to* it. The Pi always
calls out: it POSTs its state every 3 s when idle, every 1 s while someone is
watching or recording. The site answers with "is anyone watching", "is a
recording on", pending IR command, and zoom.

Both sites share one MongoDB, so whichever the Pi reaches, both dashboards
show the same thing. If barn-owl.tech is down the Pi switches to Vercel within
a second and retries the droplet every 60 s.

---

## 3. Training data (the important part)

### 3.1 How to record a clip

1. Open https://barn-owl.tech → **Live**.
2. Pick the **zoom** first (it is locked during a recording, and stored on the entry).
3. Turn the **IR light** on if shooting dark (it auto-offs after 2 min to avoid overheating; clips longer than that need it re-toggled).
4. **● Record**. Move the prop. **■ Stop**.
5. A few seconds later the clip appears on **Videos (15 fps)**. Recording keeps going even if you close the page or Wi-Fi drops (it uploads when the Pi is back online). Hard cap: 30 min per recording.

### 3.2 What a recording produces

| Copy | Resolution / rate | Where | Use |
|---|---|---|---|
| Original | 640×480, **15 fps**, MJPEG (quality 80), full sensor field of view | Pi: `~/barn-owl/recordings/<local-time>_<id>.mjpeg` and droplet: `/srv/barn-owl/videos/<id>.mjpeg` | **training** |
| Frame times | one line per frame: ms since start | `<same name>.txt` | exact timing; the camera can drop frames |
| MP4 | H.264, same frames, ~40× smaller | droplet only | watching |
| Preview | 480×360, ~1 fps, JPEG q60 (~14 KB) | MongoDB `frames` collection | browsing on the dashboard |

`<id>` is the MongoDB recording id. It matches across the Pi file, the droplet
file, the zip, and the dashboard entry.

### 3.3 Getting the data

- **Everything, from anywhere:** https://barn-owl.tech/api/videos-zip. Built fresh on each click. Files are named `<UTC start>Z_<id>.{mjpeg,txt,mp4}` and there is a `manifest.csv` (file, id, start, duration, frames, fps, zoom, sizes).
- **One clip:** Videos tab → download links on its card.
- **Straight off the Pi** (same network): `./pi/pull_recordings.sh` → `recordings/` in this repo (git-ignored).

Extracting frames:

```bash
# every frame of an original, as JPEGs
ffmpeg -f mjpeg -i clip.mjpeg -q:v 2 frames/clip_%05d.jpg
# every 5th frame (3 fps) to cut near-duplicates
ffmpeg -f mjpeg -i clip.mjpeg -vf "select=not(mod(n\,5))" -vsync vfr -q:v 2 frames/clip_%05d.jpg
```

The MJPEG is a plain concatenation of JPEGs, so `extract_frames.py`-style
readers that split on `FFD8…FFD9` also work.

### 3.4 Dataset status (as of 2026-09-26 ~20:15 UTC)

- **28 recordings at 15 fps → 17,288 frames, ~19 min**, 530 MB on the Pi. Zoom: 25 at 1×, 2 at 1.5×, 1 at 2×.
- **13 older recordings (18:00–18:40 UTC) are NOT usable alongside the rest**: they were captured before the fixes below, at 480×360, ~1 fps, and a **cropped (zoomed-in) field of view**. They exist only as 1 fps previews in MongoDB, not as videos.

### 3.5 Camera facts that matter for training

- **Field of view.** Asking rpicam for 640×480 used to select the sensor's 640×480 mode, which reads only the central 1280×960 of the 3280×2464 sensor (≈39 % of the view). The agent now forces `--mode 1640:1232:10:P` (full sensor, 2×2 binned) and scales to 640×480. Everything recorded from 18:52 UTC on uses the full view; earlier footage is the cropped one.
- **Zoom presets** are centred `--roi` crops of that full-view image. Up to 2.5× the crop is still ≥ 640×480 sensor pixels, so it is real detail, not an upscale. Keep the subject near the centre when zoomed.
- **Exposure is automatic** right now. To lock it (e.g. your teammate's IR-night settings) set `OWL_CAM_EXTRA="--gain 8 --shutter 30000 --awb greyworld"` in `/etc/barn-owl.env` on the Pi and `sudo systemctl restart barn-owl`. That applies to the live view, recordings and the demo alike. Those IR settings were tuned for a dark room and may blow out the steel table under room lights.
- NoIR camera: colours have a magenta cast; black synthetic fabric (and the prop) can glow under 850 nm IR. Training in grayscale sidesteps both.

### 3.6 Review of the footage so far, and what to shoot next

What's good: strong contrast between the black prop and the brushed steel,
many positions/headings, partial (edge) views, empty-table frames, a
string-only/cable negative, no clipped highlights (mean brightness ≈110/255).

What to change:

1. **Variety of background.** The same spot of the same table with the same bright lamp reflection and the same black box is in nearly every frame. The model can memorise those. Move the prop around the table, add the floor if the demo might be there, add distractors (hoodie, bag, hands, shoes, cables near the prop).
2. **Distances.** Record a set at each zoom preset (1×, 1.5×, 2×, 2.5×) or at three real camera heights. Match whatever the demo mount will be.
3. **Motion vs. near-duplicates.** Static-prop clips add frames but little information. Keep the prop moving; subsample static clips (every 5th frame).
4. **Negatives.** Empty table, string only, hands only, dark objects that aren't the rat.
5. **IR / dark footage.** None yet. Lights off, IR on (from the dashboard).
6. **Demo location.** If you find out where you present, record a couple of minutes there right before.
7. **Split by recording, not by frame.** Hold out whole recordings (whole sessions ideally) for validation; adjacent frames are near-identical and leak across a random split.

### 3.7 The string

The prop is pulled on a string for now. Options, best first:

1. **Label only the rat** (never the string) and include **string-only** clips as negatives. The model learns the string isn't the rat, no editing needed. If the demo also pulls the prop on a string, this is the right choice, because the model will see the string live.
2. **Clear fishing line** for future clips: close to invisible, especially under IR.
3. **Remove it afterwards** (thin dark line → mask → OpenCV `inpaint`). If you do, do it to *every* frame including negatives, or the inpainting smudge itself becomes a "rat is here" cue.

---

## 4. The Pi

| | |
|---|---|
| Model | Raspberry Pi 5, Raspberry Pi OS Lite (Debian 13), hostname `raspberrypi` |
| Login | user `pi` (password in `CREDENTIALS.txt` locally; it's also in `README.md`, so **change it**) |
| Wi-Fi | "Columbia University" (open network; the Pi's chip can't do the OWE variant, so the NetworkManager profile is plain open). Power saving **off** (it caused multi-second stalls). Address seen: `10.206.18.8` |
| Ethernet | `eth0` is link-local only (it used to wait for DHCP forever and reset the link) |
| SSH from a Mac on campus Wi-Fi | `ssh pi@10.206.18.8` (key auth set up from Bruno's Mac) |
| SSH over the cable | IPv6 link-local, see the older handoff. macOS keeps turning IPv6 off on the USB adapter: `networksetup -setv6LinkLocal "USB 10/100/1000 LAN"` |
| Service | `barn-owl` (`/etc/systemd/system/barn-owl.service`), code in `~/barn-owl/agent.py`, logs: `journalctl -u barn-owl -f` |
| Config | `/etc/barn-owl.env` (root-only): `OWL_URLS`, `OWL_TOKEN`, `OWL_PIR_PIN=23`, `OWL_IR_PIN=4`, `OWL_IR_MAX_ON=120`, optional `OWL_CAM_EXTRA`, `OWL_CAM_FPS`, `OWL_REC_DIR`, `OWL_STREAM_URL` |
| Extra package | `python3-pil` (shrinks previews) |

**Wiring (HC-SR501 PIR):** VCC → pin 2 or 4 (5 V), OUT (middle pin) → **pin 16 (GPIO23)**, GND → pin 6.
It was stuck on "Motion" for hours because **VCC and GND were swapped**; fixed.
Knobs: time-delay fully counter-clockwise (~3 s hold), jumper on **L**; the
sensitivity knob sets range. **IR light:** switched by **GPIO4**, auto-off after
2 min (`OWL_IR_MAX_ON`) because it overheats.

Deploying agent changes: copy `pi/agent.py` to `~/barn-owl/agent.py` and
`sudo systemctl restart barn-owl`.

---

## 5. Hosting

### Droplet (barn-owl.tech)

- The existing **jenzombie** droplet `104.248.231.139` (nyc1). barn-owl runs next to jenzombie; jenzombie is untouched except one line appended to `/etc/caddy/Caddyfile`: `import /etc/caddy/sites/*.caddy` (backup: `Caddyfile.pre-barn-owl`). **If jenzombie's own `provision.sh` is re-run it overwrites the Caddyfile and barn-owl disappears**; re-run barn-owl's provision (below) or add that import line to the jenzombie repo's `server/Caddyfile`.
- Node service `barn-owl-web` on `127.0.0.1:8771` (hardened unit; writes only `/srv/barn-owl/videos`). Secrets in `/etc/barn-owl/env`.
- Caddy site file `/etc/caddy/sites/barn-owl.caddy` (from `dashboard/deploy/barn-owl.caddy`): TLS, `flush_interval -1` for the live stream, and a log filter that deletes `Authorization`, `Cookie` and `Set-Cookie` (verified: 0 hits for the token in the log).
- DNS: DigitalOcean zone `barn-owl.tech`, A records for apex + `www` → droplet, TTL 300. Registrar (get.tech/Namify) nameservers → `ns1/ns2/ns3.digitalocean.com`. Let's Encrypt certs for both names.
- Deploy from a Mac:
  ```bash
  cd dashboard
  BO_HOST=root@104.248.231.139 BO_SITES="barn-owl.tech, www.barn-owl.tech, barn-owl.104-248-231-139.sslip.io" ./deploy/push.sh
  # add --secrets to (re)write /etc/barn-owl/env from dashboard/.env.local
  ```
  `push.sh` rsyncs the app and runs `deploy/provision.sh` on the droplet (idempotent: Node 22, ffmpeg, zip, user, service, Caddy, checks).

### Vercel (backup)

- Project `barn-owl` in the `brubru6707s-projects` team. `cd dashboard && vercel deploy --prod`.
- Env: `DASH_USER`, `DASH_PASS`, `SESSION_SECRET`, `PI_TOKEN`, `MONGODB_URI` (the last from the MongoDB Atlas integration). `vercel env pull` writes them to `dashboard/.env.local` (git-ignored).
- Vercel functions can't hold connections open, so **15 fps live, Videos and the zip only work on barn-owl.tech**. Vercel shows 1 fps and links to the droplet for videos.

### MongoDB (`barn_owl`)

| Collection | Contents |
|---|---|
| `node` | one document `{_id:'node'}`: Pi state, latest preview frame, viewer timestamps, pending IR command, zoom, recording in progress |
| `recordings` | one entry per Record→Stop: start/end/duration, zoom, preview count/bytes, `pi` (file/frames/fps/bytes), `video` (status/frames/fps/sizes) |
| `frames` | 1 fps preview JPEGs `{rec, ts, jpeg}` (kept out of `recordings` because a document is capped at 16 MB) |

Live viewing never adds storage (the `node` document is overwritten). Only
recording previews accumulate, ~14 KB/s of recording.

---

### Tiger Data (time series, for the "Best Use of Tiger Data" track)

MongoDB keeps media and live state; **Tiger Data (TimescaleDB on Postgres,
Tiger Cloud service `db-41897`, us-east-1)** keeps everything that happens over
time. Code: `dashboard/lib/tiger.js` (schema is created on first use, idempotent).

| Object | Kind | What |
|---|---|---|
| `readings` | hypertable (1 h chunks), **compressed** after 1 h (columnstore policy) | one row per Pi check-in: pir, ir, zoom, camera_on, recording, cpu_temp_c, wifi_dbm |
| `motion_events` | hypertable | one row per stretch of PIR motion (written on the rising edge, closed on the falling edge) |
| `detections` | hypertable | rat detections: ts, recording, frame, label, confidence, box x/y/w/h (0–1), model |
| `recordings` | table | same ids as MongoDB (41 backfilled with `deploy/backfill-tiger.js`); joins detections/motion to clips |
| `activity_1m`, `activity_1h` | continuous aggregates (hierarchical) | motion share, IR share, CPU temp per minute / hour |
| `detections_1m` | continuous aggregate | detections and best confidence per minute |

The dashboard's **Activity** tab reads only the continuous aggregates and
shows rows stored, compression saved, motion events, detections and query time.

**Posting detections (for the model):**
```bash
curl -X POST https://barn-owl.tech/api/detections \
  -H "Authorization: Bearer $PI_TOKEN" -H "Content-Type: application/json" \
  -d '[{"recording":"<recording id>","frame":123,"confidence":0.91,"box":[0.40,0.35,0.12,0.08],"model":"yolo-v1"}]'
```
Send one object or an array (a whole clip at once is one insert). `ts`
defaults to now; for offline runs over a downloaded clip, pass the frame's
real time (recording start + the `.txt` offset). `GET /api/detections` (logged
in) returns the latest 100.

Useful SQL (connect with the string in `~/.barn-owl/tiger_url` on Bruno's Mac):
```sql
-- rats per clip, best confidence
select r.id, r.started_at, count(d.*) as rats, max(d.confidence) as best
from recordings r left join detections d on d.recording = r.id
group by r.id order by r.started_at desc;
-- clips where the model saw a rat but the PIR never fired
select distinct d.recording from detections d
where not exists (select 1 from readings x where x.recording = d.recording and x.pir);
-- compression
select * from chunk_compression_stats('readings');
```

TLS: Tiger Cloud signs with its own root (`ca.timescale.com`), pinned in
`dashboard/lib/timescale-ca.pem` (expires 2027-10-20), so the connection is
verified rather than `rejectUnauthorized: false`. `TIGER_DATABASE_URL` is set
in Vercel and `/etc/barn-owl/env` on the droplet; without it the site runs as
before and the Activity tab says Tiger isn't configured.

## 6. Gotchas we hit (so you don't)

- The HC-SR501 read HIGH forever: VCC/GND swapped. Pulling OUT off pin 16 made the pin read LOW, which proved the Pi side was fine.
- The dashboard flickered offline: Wi-Fi power saving on the Pi's Broadcom chip. Disabled in the NetworkManager profile.
- "Zoomed in" camera: the 640×480 sensor mode is a centre crop (see 3.5).
- This Mac's resolver answers `127.0.0.1` for `barn-owl.tech` (something local intercepts DNS). Chrome works; `curl` on the Mac may not. Verify from the droplet instead.
- Chrome won't load `<video>` in a background tab, so automated checks of the Videos tab can look stuck when they aren't.
- Deleting a recording on the dashboard removes MongoDB + droplet copies but **not** the Pi original (on purpose).
- Zoom is locked during a recording; changing zoom restarts the camera (~2 s).

---

## 7. Costs and cleanup

- **Money:** only the droplet (~$6/mo), which was already running for jenzombie. The DO account had $3.65 signup credit on 2026-09-26 (≈17 days); after that the card on file is billed. Powering a droplet off does not stop billing; destroying it does. Vercel Hobby and MongoDB Atlas free tier: $0. `barn-owl.tech` is paid until 2027-09-26, **auto-renew off** ($29.99/yr).
- **To move off the droplet later for $0:** add `barn-owl.tech` to the Vercel project, point DNS at Vercel, destroy the droplet (only once jenzombie is done too). You'd lose 15 fps live/Videos/zip unless reworked.
- **Tiger Cloud:** 30-day trial ($1,000 credit, no card). Delete service `db-41897` when done or it will need a plan.
- **Secrets to rotate/revoke when done:** the Tiger Cloud `tsdbadmin` password (it was pasted into a chat); `PI_TOKEN` (Vercel env, droplet `/etc/barn-owl/env`, Pi `/etc/barn-owl.env`, Bruno's Mac `~/.barn-owl/pi_token`); `SESSION_SECRET`; the MongoDB Atlas user; the Pi password (public in `README.md`); the dashboard password (it's short, so change it before anything public).
- **Not committed yet (as of writing):** `dashboard/`, `pi/`, this file. `dashboard/.env.local` and `recordings/` are git-ignored.
