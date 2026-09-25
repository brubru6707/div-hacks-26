from gpiozero import MotionSensor
from datetime import datetime
from signal import pause

pir = MotionSensor(4)
pir.when_motion = lambda: print(datetime.now().strftime("%H:%M:%S"), "MOTION", flush=True)
pir.when_no_motion = lambda: print(datetime.now().strftime("%H:%M:%S"), "clear", flush=True)
print("Waiting for motion on GPIO4. Ctrl+C to stop.", flush=True)
pause()
