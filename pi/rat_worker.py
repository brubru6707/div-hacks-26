#!/usr/bin/env python3
"""Rat detector for agent.py: runs the team's ONNX model (poc vision/pi/detect.py) on the frames the agent hands it.

agent.py starts this when "Rat detection" is switched on in the dashboard and stops it when switched off. It
runs in its own venv (numpy, OpenCV, ONNX Runtime; see poc vision/pi/README.md) so the agent's system Python
stays as it is.

stdin:  frames, each a 4-byte big-endian length and a JPEG. The agent sends one only when the previous
        result has come back, so this always works on the newest frame and never builds a backlog.
stdout: one JSON line per frame:
        {"rats": [[x, y, w, h, conf], ...], "persons": [...], "ms": 58.1,
         "event": {"conf": 0.87, "box": [x, y, w, h], "hits": 3} | null}
        Boxes are normalised, top-left + size. "event" is set when the model's three-hits-in-a-second gate
        fires (the same rule the team's live worker uses), so a sighting is one confirmed rat, not one frame.
        The first line is {"ready": true, "model": "<sha256 prefix>"} once the model has loaded.

Env: OWL_DETECT_DIR (holds detect.py and the model), OWL_DETECT_MODEL (default rat.onnx), OWL_DETECT_SHA256
(refuse to run a different model file), OWL_DETECT_CONF (default 0.70, the threshold the team locked).
"""
import hashlib
import json
import os
import struct
import sys
import time

DIR = os.path.expanduser(os.environ.get("OWL_DETECT_DIR", "~/barn-owl-candidates/v5-652a05e8"))
MODEL = os.path.join(DIR, os.environ.get("OWL_DETECT_MODEL", "rat.onnx"))
SHA256 = os.environ.get("OWL_DETECT_SHA256", "")
CONF = float(os.environ.get("OWL_DETECT_CONF", 0.70))

sys.path.insert(0, DIR)
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import detect  # noqa: E402  (the team's detector: preprocessing, decoding, person rules, event gate)


def out(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main():
    digest = hashlib.sha256(open(MODEL, "rb").read()).hexdigest()
    if SHA256 and digest != SHA256:
        out({"error": f"model hash {digest[:12]} is not the expected {SHA256[:12]}"})
        return 1
    det = detect.Detector(MODEL, conf=CONF, iou=detect.IOU)
    gate = detect.EventGate()
    out({"ready": True, "model": digest[:12]})
    inp = sys.stdin.buffer
    while True:
        head = inp.read(4)
        if len(head) < 4:
            return 0
        (n,) = struct.unpack(">I", head)
        jpeg = inp.read(n)
        if len(jpeg) < n:
            return 0
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            out({"rats": [], "persons": [], "ms": 0, "event": None})
            continue
        t0 = time.perf_counter()
        rats, persons = detect.apply_rules(det.infer(img))
        ms = (time.perf_counter() - t0) * 1000
        best = max(rats, key=lambda d: d.conf) if rats else None
        fired = gate.update(time.monotonic(), best)
        out({
            "rats": [d.bbox + [round(d.conf, 3)] for d in rats],
            "persons": [d.bbox + [round(d.conf, 3)] for d in persons],
            "ms": round(ms, 1),
            "event": {"conf": round(fired[0].conf, 3), "box": fired[0].bbox, "hits": fired[1]} if fired else None,
        })


if __name__ == "__main__":
    sys.exit(main())
