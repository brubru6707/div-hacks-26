# DivHacks 2026 — Pi 5 Demo Node

Camera + PIR motion node on a Raspberry Pi 5, verified 2026-09-23. All four hardware tests pass.

## Hardware
- Raspberry Pi 5 Model B Rev 1.1, Raspberry Pi OS Lite, Debian 13 (Trixie), 64-bit.
- Arducam IMX219 NoIR camera on **CAM0**.
- HC-SR501 PIR sensor: OUT → GPIO4 (pin 7), VCC → 5V, GND → pin 6.
- One 850nm IR LED board, powered by its own power bank (not wired to the Pi).
- Powered by a 5V/3A USB-C supply (held fine, `throttled=0x0`). A 5V/5A supply is recommended for headroom.

## Test results
| Test | Result | Notes |
|---|---|---|
| 1. System health | PASS | Pi 5, 64-bit, no undervoltage |
| 2. Camera | PASS | needed `dtoverlay=imx219,cam0` + reboot |
| 3. PIR sensor | PASS | clean MOTION/clear on GPIO4 |
| 4. PIR triggers camera | PASS | 25 captures on motion, IR-lit (see `captures/`) |

## Key fixes
- `camera_auto_detect=1` alone did **not** bind the IMX219. Added `dtoverlay=imx219,cam0` to `/boot/firmware/config.txt` and rebooted.
- `picamera2` is not installed and the Pi has no internet (802.1X Wi-Fi blocks macOS Internet Sharing). Use `rpicam-still` instead, or `sudo apt install python3-picamera2` on a non-802.1X network.

## Reaching the Pi
Login: `pi` / `YOURPASSWORD` (sudo uses the same password).

It's on a direct Mac→Pi Ethernet cable (interface `en8`) with no DHCP, so link-local only. IPv4 self-assign is unreachable from macOS; use IPv6 link-local:
```
for i in 1 2 3; do ping6 -c1 ff02::1%en8 >/dev/null; done   # warm the link
ndp -an | grep 2c:cf:67 | grep %en8                          # find fe80::…%en8
ssh pi@<that-address>
```
The neighbor entry goes stale fast; warm before each connect, or hold an `ssh -M` ControlMaster with `ServerAliveInterval=5`. For the event, put the Pi on a switch/router with DHCP or set static IPs on both ends to end the flakiness.

## Files
- `captures/` — 25 PIR-triggered frames (`trig_*.jpg`) plus `cam_test.jpg` (plain Test 2 still). `trig_081020.jpg` clearly shows a hand lit by IR.
- `pir_test.py` — Test 3: prints MOTION/clear on GPIO4.
- `trigger_capture.py` — Test 4: captures a photo (via `rpicam-still`) on each motion event.
- `enclosure/` — parametric 3D-printable case. `enclosure.scad` (OpenSCAD) and `build_stl.py` (trimesh) generate `stl/`: `base_with_pisugar.stl`, `base_no_pisugar.stl`, and `lid.stl`. The node includes a PiSugar battery pack under the Pi; it's removable, hence the two base variants.
- `enclosure/v2/` — the current case (sensors on the front wall, IR light + camera + PIR in a row). `stl/` is the print set: `v2_base_usb.stl` (no PiSugar) or `v2_base_pisugar.stl`, plus lid, stand, shroud, diffuser and a front-wall test plate. The IR light pocket is cut to the vendor drawing by `fit_ir_light.py`; see `V2_NOTES.md`.
- `HANDOFF-pi5-camera-pir-node.md` — full handoff for whoever receives the hardware.

Scripts live in `~/node-test/` on the Pi.
