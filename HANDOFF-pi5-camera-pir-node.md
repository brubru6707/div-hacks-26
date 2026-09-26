# Handoff — Pi 5 Camera + PIR Motion Node (DivHacks 2026)

You're getting a Raspberry Pi 5 set up as a motion-triggered camera node. Everything below is what it is, how to get into it, and the few gotchas that will otherwise cost you an hour.

## What it does (already built and tested)
A PIR motion sensor triggers the camera to take a photo. The camera is a NoIR (no infrared filter), so with an IR light it sees in the dark. All four hardware checks passed on 2026-09-23:

| Check | Status |
|---|---|
| Pi 5 boots, 64-bit OS, no undervoltage | working |
| IMX219 camera detected and captures | working |
| PIR sensor reports motion on GPIO4 | working |
| Motion triggers a photo (25 IR-lit frames captured) | working |

Sample photos are in `captures/` in this folder. `trig_081020.jpg` shows a hand lit by infrared.

## What's in the box
- Raspberry Pi 5 with the microSD card already imaged (Raspberry Pi OS Lite, 64-bit).
- Arducam IMX219 NoIR camera, ribbon into the **CAM0** connector.
- HC-SR501 PIR sensor, wired to the Pi: OUT → GPIO4 (physical pin 7), VCC → 5V (pin 2 or 4), GND → pin 6.
- One 850nm IR LED board with its own power bank (this is a light, it does **not** connect to the Pi).
- **PiSugar battery pack** mounted under the Pi so the node can run untethered. It is removable — pop it off and power the Pi straight from USB-C. The case has two variants for exactly this (see the enclosure section).
- Camera ribbon is ~12 cm, so the camera can sit up to that far from the Pi.

## Login
```
username: pi
password: YOURPASSWORD
```
`sudo` uses the same password. Please change it once you're in (`passwd`).

## Powering it
Use a **5V/3A USB-C supply minimum**; a 5V/5A (27 W) official Pi 5 supply is better and gives headroom for the camera. A phone charger rated only 2A will not boot a Pi 5 reliably. It ran clean on 3A during testing.

## Getting into the Pi — pick the easiest for your setup

**Option A — monitor + keyboard (simplest).** Plug a monitor into the **micro-HDMI port nearest the USB-C jack**, add a USB keyboard, power on, and log in with the credentials above. No network needed.

**Option B — network with a router/switch (best for headless).** Plug the Pi's Ethernet into any router or switch that hands out addresses (DHCP). SSH is already enabled. From another computer on that network:
```
ssh pi@raspberrypi.local
```
If the name doesn't resolve, find the Pi's IP in your router's device list and use `ssh pi@<ip>`.

**Option C — direct cable straight to a laptop (what we did, and it's fiddly).** With no router there's no DHCP, so both ends fall back to link-local addressing, which is flaky and OS-specific. On macOS it took IPv6 link-local gymnastics (see `README.md` in this folder for the exact commands). **Avoid this if you can.** Use Option A or B instead.

**Wi-Fi is not configured.** If you want wireless, connect by Option A or B first, then run `sudo raspi-config` (or `nmcli`) to add your network.

## Running the demo
The test scripts are on the Pi in `~/node-test/` (copies are also in this folder):
```
python3 ~/node-test/pir_test.py          # prints MOTION / clear as you wave at the PIR
python3 ~/node-test/trigger_capture.py   # takes a photo on each motion event
```
Stop either with Ctrl+C. For the camera-in-the-dark demo, power the IR board, aim it where the camera looks, dim the room, and wave your hand in view.

## 3D-printed enclosure
Case files are in `enclosure/`. Two base variants share one lid:

| File | Fits | Outer size (mm) |
|---|---|---|
| `stl/base_with_pisugar.stl` | Pi **with** the PiSugar under it | 93 × 64 × 43 |
| `stl/base_no_pisugar.stl` | Pi only (PiSugar removed) | 93 × 64 × 30 |
| `stl/lid.stl` | camera + PIR mount on top | 93 × 64 × 7 |

The only difference between the two bases is height: the PiSugar variant is ~13 mm taller to make room for the pack. The lid has a lens hole plus four Arducam (M2) mount holes near one end, and a 23.5 mm hole for the PIR dome near the other. Port openings are cut for the USB/Ethernet edge and the USB-C/HDMI edge.

Re-render after any change with either tool:
- `enclosure/enclosure.scad` in OpenSCAD (parametric; `include_pisugar` toggle), or
- `python3 enclosure/build_stl.py` (needs `pip install trimesh manifold3d numpy`).

Key parameters: `pisugar_h` (default 15 mm), wall thickness, clearances, and the port-window positions.

**Print + verify first.** The STLs are watertight and printable, but the dimensions were typed from measurements, not imported from a CAD model of the boards. Before a full print, dry-fit or print a test and check: the PiSugar height, the port windows against your board's actual orientation, and the camera/PIR hole placement. Nudge the parameters and re-render as needed.

## Gotchas that will bite you
- **microSD write-protect lock.** If you ever re-flash the card and writes are "permission denied," check the tiny slider switch on the card/adapter. It must be unlocked.
- **Camera needs an overlay.** `dtoverlay=imx219,cam0` is already in `/boot/firmware/config.txt` (backup at `config.txt.bak`). Auto-detect alone did not find the camera. If you swap SD images, you'll need to add that line again and reboot.
- **`picamera2` is not installed** and the Pi had no internet during setup, so the trigger script uses `rpicam-still`. If you want `picamera2`, put the Pi on internet once and run `sudo apt install python3-picamera2`.
- **The OS is Debian 13 (Trixie), 64-bit** — newer than the Bookworm most guides assume. Package names occasionally differ.
- **Verify the IR board is on** by pointing a phone camera at it; you'll see a purple-white glow. Your eyes can't see 850nm.

## Quick sanity check once you're in
```
cat /proc/device-tree/model        # Raspberry Pi 5 ...
vcgencmd get_throttled             # want throttled=0x0
rpicam-hello --list-cameras        # should list imx219
```
