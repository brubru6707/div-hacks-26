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

"Rat detection" on the dashboard runs the team's rat model on the live frames
(see RatDetector): boxes are drawn on the preview and the 15 fps view (never on
the recordings, which stay clean training data), and each confirmed sighting is
POSTed to /api/detections.
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
    from PIL import Image, ImageDraw
except ImportError:  # previews are then sent full size, and without boxes
    Image = ImageDraw = None

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
# The rat model runs in its own venv (numpy, OpenCV, ONNX Runtime) via pi/rat_worker.py; see RatDetector.
DETECT_PY = os.path.expanduser(os.environ.get("OWL_DETECT_PY", "~/barn-owl-candidates/v3-3214f2a0/.venv/bin/python"))
DETECT_WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rat_worker.py")
DETECT_MODEL_NAME = os.environ.get("OWL_DETECT_NAME", "rat-litroom-v5")
BOX_HOLD = 0.6  # seconds a box stays drawn after the frame it was found in
# The model confirms a rat every couple of seconds while it stays in view; one saved sighting (a
# Tiger Data row and a Solana anchor, which costs a fee) per this many seconds is plenty.
SIGHTING_GAP = float(os.environ.get("OWL_DETECT_GAP", 30))
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


class RatDetector:
    """Runs rat_worker.py while the dashboard has "Rat detection" on. The camera
    thread hands it a frame only when it is idle (the newest frame, never a
    queue), so detection can't slow the camera, the stream or a recording.
    Boxes from the latest result are drawn onto frames shown on the dashboard."""

    def __init__(self):
        self.proc = None
        self.busy = False
        self.want = False
        self.lock = threading.Lock()
        self.rats = []           # [[x, y, w, h, conf], ...] from the latest result
        self.boxes_at = 0.0
        self.ms = None           # inference time of the latest frame
        self.times = []          # result times over the last few seconds, for fps
        self.events = 0
        self.last_event = None
        self.error = None
        self.model = None

    @property
    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def set(self, on):
        self.want = on
        if on and not self.running:
            self.start()
        elif not on and self.proc:
            self.stop()

    def start(self):
        if not os.path.exists(DETECT_PY):
            self.error = f"detector venv not found ({DETECT_PY})"
            return
        log("rat detection on")
        self.error, self.model, self.busy = None, None, True  # busy until the model reports ready
        self.proc = subprocess.Popen([DETECT_PY, "-u", DETECT_WORKER], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        threading.Thread(target=self._read, args=(self.proc,), daemon=True).start()
        threading.Thread(target=self._errors, args=(self.proc,), daemon=True).start()

    def stop(self):
        log("rat detection off")
        proc, self.proc = self.proc, None
        try:
            proc.stdin.close()
            proc.terminate()
            proc.wait(3)
        except Exception:
            proc.kill()
        with self.lock:
            self.rats, self.ms, self.times = [], None, []

    def feed(self, jpeg):
        """Camera thread: hand over this frame if the worker is free."""
        if self.busy or not self.running:
            return
        self.busy = True
        try:
            self.proc.stdin.write(len(jpeg).to_bytes(4, "big") + jpeg)
            self.proc.stdin.flush()
        except Exception:
            self.busy = False

    def _read(self, proc):
        for line in proc.stdout:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            now = time.monotonic()
            if r.get("ready"):
                self.model = r.get("model")
                log(f"rat model {self.model} loaded")
            elif r.get("error"):
                self.error = r["error"]
            else:
                with self.lock:
                    self.rats, self.ms = r["rats"], r["ms"]
                    if self.rats:
                        self.boxes_at = now
                    self.times = [t for t in self.times if now - t < 3] + [now]
                if r.get("event"):
                    self.sighting(r["event"])
            self.busy = False
        if self.proc is proc and self.want:  # died on its own: the next sync restarts it
            self.error = self.error or f"detector exited ({proc.poll()})"
            self.proc = None

    def _errors(self, proc):
        for line in proc.stderr:
            text = line.decode(errors="replace").strip()
            if text:
                log("detector:", text)
                self.error = text[-200:]

    def sighting(self, ev):
        now = time.monotonic()
        if self.last_event is not None and now - self.last_event < SIGHTING_GAP:
            return
        self.events += 1
        self.last_event = now
        x, y, w, h = ev["box"]
        log(f"rat sighted ({ev['conf']:.2f}, {ev['hits']} frames)")
        rec = recorder.report()
        body = {"label": "rat", "confidence": ev["conf"], "box": [x, y, w, h], "model": DETECT_MODEL_NAME,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
                **({"recording": rec["id"], "frame": rec["frames"]} if rec and not rec["done"] else {})}
        threading.Thread(target=self._post, args=(body,), daemon=True).start()

    def _post(self, body):
        url = URLS[current][:-len("/api/pi")] + "/api/detections"
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
        try:
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:
            log("could not save the sighting:", e)

    def annotate(self, jpeg):
        """The frame with the latest rat boxes drawn on, or the frame untouched."""
        with self.lock:
            rats = self.rats if self.running and time.monotonic() - self.boxes_at < BOX_HOLD else []
        if not rats or Image is None:
            return jpeg
        try:
            im = Image.open(io.BytesIO(jpeg)).convert("RGB")
            d = ImageDraw.Draw(im)
            W, H = im.size
            for x, y, w, h, conf in rats:
                box = (x * W, y * H, (x + w) * W, (y + h) * H)
                d.rectangle(box, outline=(255, 64, 64), width=3)
                label = f"rat {conf:.0%}"
                tw = d.textlength(label) + 8
                ty = box[1] - 14 if box[1] >= 14 else box[3]
                d.rectangle((box[0], ty, box[0] + tw, ty + 14), fill=(255, 64, 64))
                d.text((box[0] + 4, ty + 1), label, fill=(255, 255, 255))
            out = io.BytesIO()
            im.save(out, "JPEG", quality=80)
            return out.getvalue()
        except Exception:
            return jpeg

    def status(self):
        with self.lock:
            fps = (len(self.times) - 1) / (self.times[-1] - self.times[0]) if len(self.times) > 2 else None
            return {
                "on": self.running, "ready": self.model is not None, "model": self.model,
                "fps": round(fps, 1) if fps else None, "ms": self.ms, "rats": len(self.rats),
                "sightings": self.events,
                "lastSightingAgo": None if self.last_event is None else time.monotonic() - self.last_event,
                "error": self.error,
            }


pir = MotionSensor(PIR_PIN)
ir = DigitalOutputDevice(IR_PIN, initial_value=False)
recorder = Recorder()
uploader = Uploader()
streamer = Streamer()
detector = RatDetector()
# The recorder gets the raw frame; only what is shown on the dashboard gets boxes.
cam = Camera(on_frame=(recorder.write, lambda f: streamer.push(detector.annotate(f)) if streamer.want else None,
                       detector.feed))
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
        "detect": detector.status(),
        **vitals(),
    }
    if frame:
        body["frame"] = base64.b64encode(preview(detector.annotate(frame))).decode()
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
        detector.set(bool(resp.get("detect")))
        if resp.get("viewer") or recorder.active or detector.want:
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
        detector.set(False)
        recorder.stop()
        cam.stop()
        ir.off()
