from gpiozero import MotionSensor
from datetime import datetime
from signal import pause
import subprocess, threading, os

os.chdir(os.path.expanduser("~/node-test"))
pir = MotionSensor(4)
lock = threading.Lock()

def snap():
    if not lock.acquire(blocking=False):
        return
    try:
        name = datetime.now().strftime("trig_%H%M%S.jpg")
        subprocess.run(["rpicam-still", "-o", name, "--immediate", "-n", "-t", "1"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        sz = os.path.getsize(name) if os.path.exists(name) else 0
        print(f"Captured {name} ({sz} bytes)", flush=True)
    finally:
        lock.release()

pir.when_motion = snap
print("Armed. Waiting for motion on GPIO4.", flush=True)
pause()
