#!/usr/bin/env python3
"""Barn Owl agent: keeps the dashboard up to date and takes IR commands from it.

The Pi sits behind campus NAT, so the dashboard can't reach it; instead this
POSTs to /api/pi on a loop. Idle it syncs every IDLE_INTERVAL seconds (a
heartbeat, so the site knows it's online). When someone has the dashboard
open, the site says so and this switches to streaming camera frames.

One camera stream runs at full rate (15 fps). While a recording is on, every
frame goes to a file under OWL_REC_DIR, which is then uploaded to the droplet
for the dashboard's Videos tab (see Uploader). The dashboard normally gets a small
1 fps preview; when someone picks "15 fps" on barn-owl.tech, every frame is
also pushed over one long-lived connection to the droplet (see Streamer).
"""
import base64
import glob
import http.client
import io
import json
import os
import shlex
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from gpiozero import DigitalOutputDevice, MotionSensor

try:
    from PIL import Image
except ImportError:  # previews are then sent full size
    Image = None

# Comma-separated, primary first (the droplet), then backups (Vercel). Both
# sites share one database, so whichever the Pi reaches, both dashboards update.
URLS = [u.strip().rstrip("/") + "/api/pi" for u in
        os.environ.get("OWL_URLS", os.environ.get("OWL_URL", "")).split(",") if u.strip()]
RETRY_PRIMARY_AFTER = 60  # seconds on a backup before trying the primary again
TOKEN = os.environ["OWL_TOKEN"]
PIR_PIN = int(os.environ.get("OWL_PIR_PIN", 23))
IR_PIN = int(os.environ.get("OWL_IR_PIN", 4))
IR_MAX_ON = float(os.environ.get("OWL_IR_MAX_ON", 120))  # overheat guard, seconds
IDLE_INTERVAL = 3  # also how fast it notices a viewer or a recording starting
LIVE_INTERVAL = 1  # dashboard preview rate: 1 fps
PREVIEW_SIZE = (480, 360)
PREVIEW_QUALITY = 60  # ~12 KB a frame, vs ~37 KB for the full-rate recording
# The 15 fps live view needs a server that can hold a connection open: the
# droplet, not Vercel. Defaults to the first URL.
STREAM_URL = os.environ.get("OWL_STREAM_URL", URLS[0][:-len("/api/pi")] if URLS else "").rstrip("/")
ZOOMS = (1.0, 1.5, 2.0, 2.5)
FPS = int(os.environ.get("OWL_CAM_FPS", 15))
REC_DIR = os.path.expanduser(os.environ.get("OWL_REC_DIR", "~/barn-owl/recordings"))
REC_MAX = 30 * 60  # seconds; the dashboard enforces the same limit
# --mode picks the full-sensor 2x2-binned mode. Without it, asking for 640x480
# selects the sensor's 640x480 mode, which reads only the central 1280x960 of
# the 3280x2464 sensor -- the "zoomed in" look. OWL_CAM_EXTRA adds options such
# as "--gain 8 --shutter 30000 --awb greyworld".
# Zoom is a centred crop (--roi) of that binned image. Up to 2.5x the crop is
# still at least 640x480 sensor pixels, so it is real detail, not an upscale.
def cam_args(zoom):
    args = ["rpicam-vid", "-n", "-t", "0", "--codec", "mjpeg", "--quality", "80",
            "--mode", "1640:1232:10:P", "--width", "640", "--height", "480",
            "--framerate", str(FPS)]
    if zoom > 1:
        side = 1 / zoom
        off = (1 - side) / 2
        args += ["--roi", f"{off:.4f},{off:.4f},{side:.4f},{side:.4f}"]
    return args + shlex.split(os.environ.get("OWL_CAM_EXTRA", "")) + ["-o", "-"]


def preview(jpeg):
    """Shrink a frame for the dashboard (and the copies MongoDB keeps)."""
    if Image is None:
        return jpeg
    try:
        im = Image.open(io.BytesIO(jpeg)).convert("RGB").resize(PREVIEW_SIZE, Image.BILINEAR)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=PREVIEW_QUALITY)
        return out.getvalue()
    except Exception:
        return jpeg


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


class Camera:
    """Runs rpicam-vid only while someone is watching and keeps the newest JPEG."""

    def __init__(self, on_frame=()):
        self.proc = None
        self.frame = None
        self.frame_id = 0
        self.on_frame = on_frame
        self.zoom = 1.0

    @property
    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self, zoom=None):
        if zoom is not None and zoom != self.zoom:
            self.zoom = zoom
            if self.running:  # the crop is fixed at launch, so relaunch
                log(f"zoom {zoom}x")
                self.stop()
        if self.running:
            return
        log(f"camera on ({self.zoom}x)")
        self.proc = subprocess.Popen(cam_args(self.zoom), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        threading.Thread(target=self._read, args=(self.proc,), daemon=True).start()

    def stop(self):
        if self.proc:
            log("camera off")
            self.proc.terminate()
            try:
                self.proc.wait(3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

    def _read(self, proc):
        # Each MJPEG frame is a complete JPEG: FFD8 ... FFD9.
        buf = b""
        while True:
            chunk = proc.stdout.read1(65536)
            if not chunk:
                return
            buf += chunk
            while True:
                start = buf.find(b"\xff\xd8")
                end = buf.find(b"\xff\xd9", start + 2) if start >= 0 else -1
                if end < 0:
                    buf = buf[start:] if start >= 0 else b""
                    break
                self.frame = buf[start:end + 2]
                self.frame_id += 1
                for fn in self.on_frame:
                    fn(self.frame)
                buf = buf[end + 2:]


class Recorder:
    """Writes every camera frame to <REC_DIR>/<time>_<id>.mjpeg while the
    dashboard says a recording is on, plus a .txt with each frame's time in ms
    since the start (the camera can drop frames, so don't assume exactly FPS)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.f = self.times = None
        self.info = None  # reported to the dashboard; kept until "done" is delivered

    @property
    def active(self):
        return self.f is not None

    def start(self, rec_id):
        with self.lock:
            if self.info and self.info["id"] == rec_id:
                return
            self._close()
            os.makedirs(REC_DIR, exist_ok=True)
            path = os.path.join(REC_DIR, time.strftime("%Y%m%d-%H%M%S") + f"_{rec_id}.mjpeg")
            self.f = open(path, "wb")
            self.times = open(path[:-len(".mjpeg")] + ".txt", "w")
            self.t0 = time.monotonic()
            self.info = {"id": rec_id, "file": path, "frames": 0, "bytes": 0, "fps": FPS, "done": False}
            log("recording to", path)

    def write(self, jpeg):
        with self.lock:
            if not self.f:
                return
            self.f.write(jpeg)
            self.times.write(f"{(time.monotonic() - self.t0) * 1000:.1f}\n")
            self.info["frames"] += 1
            self.info["bytes"] += len(jpeg)

    def stop(self):
        with self.lock:
            self._close()

    def expired(self):
        return self.active and time.monotonic() - self.t0 > REC_MAX

    def _close(self):
        if self.f:
            self.f.close()
            self.times.close()
            self.f = self.times = None
            self.info["done"] = True
            log(f"recording saved: {self.info['file']} ({self.info['frames']} frames)")
            uploader.kick()

    def writing(self, path):
        with self.lock:
            return bool(self.f) and self.info["file"] == path

    def report(self):
        with self.lock:
            return dict(self.info) if self.info else None

    def delivered(self, report):
        with self.lock:
            if report and report["done"] and self.info and self.info["id"] == report["id"] and self.info["done"]:
                self.info = None


class Streamer:
    """Pushes every frame to STREAM_URL/api/stream-in over one chunked POST
    while someone has the 15 fps view open. The droplet fans the frames out
    to viewers and hangs up once nobody is watching."""

    def __init__(self):
        self.want = False
        self.thread = None
        self.cond = threading.Condition()
        self.latest = None
        self.latest_id = 0

    def push(self, jpeg):
        if self.want:
            with self.cond:
                self.latest, self.latest_id = jpeg, self.latest_id + 1
                self.cond.notify_all()

    def set(self, on):
        self.want = on and bool(STREAM_URL)
        if self.want and not (self.thread and self.thread.is_alive()):
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()
        if not self.want:
            with self.cond:
                self.cond.notify_all()

    def _run(self):
        u = urllib.parse.urlsplit(STREAM_URL)
        conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(u.netloc, timeout=15)
        sent = self.latest_id
        try:
            conn.putrequest("POST", "/api/stream-in")
            conn.putheader("Authorization", f"Bearer {TOKEN}")
            conn.putheader("Content-Type", "application/octet-stream")
            conn.putheader("Transfer-Encoding", "chunked")
            conn.endheaders()
            log("15 fps stream on")
            while self.want:
                with self.cond:
                    self.cond.wait_for(lambda: self.latest_id != sent or not self.want, timeout=5)
                    if not self.want or self.latest_id == sent:
                        continue
                    data, sent = self.latest, self.latest_id
                conn.send(b"%x\r\n" % len(data) + data + b"\r\n")
            conn.send(b"0\r\n\r\n")
            conn.getresponse().read()
        except Exception as e:  # the droplet hangs up when nobody is watching
            log("15 fps stream ended:", e)
        finally:
            conn.close()
            log("15 fps stream off")


class Uploader:
    """Sends each finished recording (.txt, then .mjpeg) to the droplet so the
    dashboard can play it at 15 fps. Retries until it works, so recordings made
    offline go up later; a .uploaded marker next to the file means done. The
    Pi keeps its own copy either way."""

    def __init__(self):
        self.wake = threading.Event()
        self.wake.set()  # catch up on anything left from before a restart
        threading.Thread(target=self._run, daemon=True).start()

    def kick(self):
        self.wake.set()

    def _run(self):
        while True:
            self.wake.wait(120)
            self.wake.clear()
            for mjpeg in sorted(glob.glob(os.path.join(REC_DIR, "*.mjpeg"))):
                base = mjpeg[:-len(".mjpeg")]
                if os.path.exists(base + ".uploaded") or recorder.writing(mjpeg):
                    continue
                rec_id = base.rsplit("_", 1)[-1]
                try:
                    status = self._put(rec_id, "txt", base + ".txt")
                    if status == 200:
                        status = self._put(rec_id, "mjpeg", mjpeg)
                    if status in (200, 404):  # 404: deleted on the dashboard
                        open(base + ".uploaded", "w").write(str(status))
                        log(f"upload {os.path.basename(mjpeg)}: {'done' if status == 200 else 'skipped (deleted)'}")
                    else:
                        raise RuntimeError(f"HTTP {status}")
                except Exception as e:
                    log(f"upload {os.path.basename(mjpeg)} failed, will retry: {e}")
                    break

    def _put(self, rec_id, kind, path):
        if not os.path.exists(path):
            return 200
        u = urllib.parse.urlsplit(STREAM_URL)
        conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(u.netloc, timeout=60)
        try:
            conn.putrequest("POST", f"/api/video-in?id={rec_id}&kind={kind}")
            conn.putheader("Authorization", f"Bearer {TOKEN}")
            conn.putheader("Content-Type", "application/octet-stream")
            conn.putheader("Content-Length", str(os.path.getsize(path)))
            conn.endheaders()
            with open(path, "rb") as f:
                while chunk := f.read(1 << 20):
                    conn.send(chunk)
            r = conn.getresponse()
            r.read()
            return r.status
        finally:
            conn.close()


pir = MotionSensor(PIR_PIN)
ir = DigitalOutputDevice(IR_PIN, initial_value=False)
recorder = Recorder()
uploader = Uploader()
streamer = Streamer()
cam = Camera(on_frame=(recorder.write, streamer.push))
wake = threading.Event()
last_motion = None
motion_seen = False  # latched between syncs so short motion isn't missed
ir_timer = None
ir_until = None


def on_motion():
    global last_motion, motion_seen
    last_motion = time.monotonic()
    motion_seen = True
    wake.set()


pir.when_motion = on_motion
pir.when_no_motion = wake.set


def set_ir(on):
    global ir_timer, ir_until
    if ir_timer:
        ir_timer.cancel()
        ir_timer = ir_until = None
    if on:
        ir.on()
        ir_until = time.monotonic() + IR_MAX_ON
        ir_timer = threading.Timer(IR_MAX_ON, lambda: (log("IR auto-off"), set_ir(False), wake.set()))
        ir_timer.daemon = True
        ir_timer.start()
    else:
        ir.off()
    log("IR", "on" if on else "off")


current = 0          # index into URLS
on_backup_since = 0.0


def vitals():
    """CPU temperature (C) and Wi-Fi signal (dBm), logged as time series."""
    out = {}
    try:
        out["cpuTemp"] = int(open("/sys/class/thermal/thermal_zone0/temp").read()) / 1000
    except Exception:
        pass
    try:
        for line in open("/proc/net/wireless").read().splitlines()[2:]:
            if line.strip().startswith("wlan0:"):
                out["wifiDbm"] = float(line.split()[3].rstrip("."))
    except Exception:
        pass
    return out


def sync(frame, rec):
    """POST to the current site; on failure fall through to the next one."""
    global current, on_backup_since
    if current and time.monotonic() - on_backup_since > RETRY_PRIMARY_AFTER:
        current = 0
    for i in list(range(current, len(URLS))) + list(range(0, current)):
        try:
            resp = sync_to(URLS[i], frame, rec)
        except Exception as e:
            log(f"sync to {URLS[i]} failed: {e}")
            continue
        if i != current:
            log(f"now using {URLS[i]}")
            current = i
            if i:
                on_backup_since = time.monotonic()
        return resp
    raise RuntimeError("no site reachable")


def sync_to(url, frame, rec):
    global motion_seen, last_motion
    now = time.monotonic()
    seen, motion_seen = motion_seen, False
    if pir.motion_detected:
        # when_motion only fires on a rising edge; if the pin was already high
        # at startup it never fires, so count "high right now" as motion.
        last_motion = now
    body = {
        "pir": bool(pir.motion_detected or seen),
        "lastMotionAgo": None if last_motion is None else now - last_motion,
        "ir": bool(ir.value),
        "irLeft": None if ir_until is None else max(0, ir_until - now),
        "interval": LIVE_INTERVAL if cam.running else IDLE_INTERVAL,
        "host": socket.gethostname(),
        "zoom": cam.zoom,
        **vitals(),
    }
    if frame:
        body["frame"] = base64.b64encode(preview(frame)).decode()
    if rec:
        body["rec"] = rec
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)
    except Exception:
        motion_seen = motion_seen or seen
        raise
    finally:
        took = time.monotonic() - t0
        if took > 2:
            log(f"slow sync: {took:.1f}s")


def main():
    log(f"barn owl agent -> {', '.join(URLS)} (PIR GPIO{PIR_PIN}, IR GPIO{IR_PIN})")
    sent_id = 0
    while True:
        frame = None
        if cam.running and cam.frame_id != sent_id:
            frame, sent_id = cam.frame, cam.frame_id
        if recorder.expired():
            recorder.stop()
        rec = recorder.report()
        try:
            resp = sync(frame, rec)
        except Exception as e:  # every site unreachable: Wi-Fi down, etc.
            log("sync failed:", e)
            if not recorder.active:  # a recording keeps going offline
                cam.stop()
            time.sleep(5)
            continue
        recorder.delivered(rec)
        if resp.get("ir") in ("on", "off"):
            set_ir(resp["ir"] == "on")
        if resp.get("record"):
            recorder.start(resp["record"])
        else:
            recorder.stop()
        zoom = resp.get("zoom")
        zoom = float(zoom) if zoom in ZOOMS else None
        if resp.get("viewer") or recorder.active:
            cam.start(zoom)
        else:
            cam.stop()
            if zoom is not None:
                cam.zoom = zoom
        streamer.set(bool(resp.get("fast")) and cam.running)
        wake.clear()
        wake.wait(LIVE_INTERVAL if cam.running else IDLE_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    finally:
        streamer.set(False)
        recorder.stop()
        cam.stop()
        ir.off()
