#!/usr/bin/env python3
"""Fit the real 850 nm IR light board into the v2 node case.

The v2 sensor wall was drawn from a guess (IR board 21 mm wide, no
photoresistor).  The vendor drawing gives the real part:

    PCB          19.82 wide x 27.94 tall x 1.00 thick, D-shaped (R10 top)
    LED lens     dia 19.00, front face 14.05 in front of the PCB (15.05 total)
    photoresistor dia 5.00, tip 8.35 in front of the PCB, lower right of the
                 lens when you look at the lens
    solder pads  VCC / GND, 13.66 apart at the bottom ears

node_v2.scad is not on this machine, only its STLs, so this script patches
the STLs: it removes the old IR rails, cuts the photoresistor hole, and adds
rails + stops that seat the PCB so the photoresistor tip is flush with the
outside of the wall and the lens stands proud by ~5.7 mm, like the PIR
collar and camera hood.  Both bases share the wall, so both are patched.

    python3 fit_ir_light.py            # original/ -> stl/  (+ preview/)

Needs: pip install trimesh manifold3d numpy matplotlib   (preview.py alongside)
"""

from pathlib import Path

import numpy as np
import trimesh
from manifold3d import Manifold, Mesh

HERE = Path(__file__).resolve().parent
SRC = HERE / "original"
OUT = HERE / "stl"
PREVIEW = HERE / "preview"

# ---------------------------------------------------------------- v2 case facts (measured from the STLs)
WALL = 2.4          # front (sensor) wall, x = 0..2.4; outside is x < 0
SIDE_WALL = 2.4     # port-side wall, y = 0..2.4
FLOOR = 2.4         # floor top, z = 2.4
IR_Y, IR_Z = 15.4, 21.4        # lens axis (shared sensor row height)
LENS_HOLE_D = 19.8             # existing through hole, kept
CAM_RAIL_Y = 27.9              # camera's near rail starts here; must stay
OLD_RAIL_X = 7.6               # old IR rails run x = 2.4..7.39

# ---------------------------------------------------------------- IR board (vendor drawing)
PCB_W, PCB_H, PCB_T = 19.82, 27.94, 1.00
PCB_ABOVE_AXIS = 10.0          # R10 arc on top: axis is 10 below the top edge
LENS_D, LENS_LEN = 19.0, 14.05 # in front of the PCB face
LDR_D, LDR_LEN = 5.0, 8.35     # photoresistor, in front of the PCB face
LDR_DX, LDR_DY = 7.0, 9.3      # from lens axis, seen from the front: right and DOWN
                               # (scaled off the drawing; the test plate checks it)
PAD_DX = 13.66                 # solder pad spacing

# ---------------------------------------------------------------- fit
LDR_HOLE_D = 6.4               # generous: absorbs the LDR_DX/DY estimate
SIDE_CLEAR = 0.3               # per side, PCB to rail
PCB_FACE_X = LDR_LEN           # PCB front face here => LDR tip flush with x=0
RAIL_T = 1.6
RAIL_DEPTH = 13.0              # rails run x = WALL .. RAIL_DEPTH
RAIL_TOP = IR_Z + 1.5          # sides of the D are straight below ~axis+1.3
LIP_W = 1.2                    # stop lip catching the PCB edge
POST_W = 4.0                   # centre stop post, sits above the pad notch
POST_TOP = 10.5                # below the lens barrel (bottom at IR_Z - 9.5)
EPS = 0.01

LENS_PROUD = LENS_LEN - PCB_FACE_X       # lens front outside the wall


def box(x0, x1, y0, y1, z0, z1):
    return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def xcyl(d, y, z, x0, x1, n=96):
    """Cylinder along +x."""
    c = Manifold.cylinder(x1 - x0, d / 2, d / 2, n)      # along +z
    return c.rotate([0, 90, 0]).translate([x0, y, z])


def load(name):
    m = trimesh.load(SRC / name)
    return Manifold(Mesh(vert_properties=np.asarray(m.vertices, np.float32),
                         tri_verts=np.asarray(m.faces, np.uint32)))


def save(man, name):
    OUT.mkdir(exist_ok=True)
    mesh = man.to_mesh()
    tm = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts), process=True)
    tm.export(OUT / name)
    tm = trimesh.load(OUT / name)   # re-read: STL drops vertex sharing, so this is what a slicer sees
    bb = np.round(np.array(man.bounding_box()).reshape(2, 3), 1)
    print(f"  {name:28s} watertight={tm.is_watertight} bbox={bb[0].tolist()}..{bb[1].tolist()} "
          f"vol={man.volume():.0f} mm3")
    return tm


def ir_pocket_cut():
    """Everything to remove: old rails and the photoresistor hole."""
    old_rails = box(WALL, OLD_RAIL_X, SIDE_WALL + EPS, CAM_RAIL_Y, FLOOR + EPS, 40)
    ldr = xcyl(LDR_HOLE_D, IR_Y - LDR_DX, IR_Z - LDR_DY, -6, WALL + 1)
    return old_rails + ldr


def ir_pocket_add():
    """Rails + stops for the real board.

    The stops set the PCB face at x = PCB_FACE_X.  They have to stay clear of
    the lens barrel (dia 19, 14 mm long), the photoresistor and the solder
    pads, so they sit low: a centre post over the pad notch, a tall lip on the
    right, a short lip on the left above the photoresistor hole.
    """
    half = PCB_W / 2 + SIDE_CLEAR              # 10.21
    y_in_l, y_in_r = IR_Y - half, IR_Y + half  # rail inner faces: 5.19 / 25.61
    lens_r = LENS_D / 2
    lip_off = half - LIP_W                     # lip inner face, from the axis
    lip_top = IR_Z - np.sqrt(lens_r**2 - lip_off**2) - 0.3   # lens bottom at that y, minus margin
    ldr_top = IR_Z - LDR_DY + LDR_HOLE_D / 2 + 0.8
    parts = [
        # left rail, merged into the side wall
        box(WALL - EPS, RAIL_DEPTH, SIDE_WALL - EPS, y_in_l, FLOOR - EPS, RAIL_TOP),
        # right rail, merged into the camera rail
        box(WALL - EPS, RAIL_DEPTH, y_in_r, CAM_RAIL_Y + EPS, FLOOR - EPS, RAIL_TOP),
        # stops between wall and PCB face
        box(WALL - EPS, PCB_FACE_X, IR_Y - POST_W / 2, IR_Y + POST_W / 2, FLOOR - EPS, POST_TOP),
        box(WALL - EPS, PCB_FACE_X, y_in_r - LIP_W, y_in_r + EPS, FLOOR - EPS, lip_top),
        box(WALL - EPS, PCB_FACE_X, y_in_l - EPS, y_in_l + LIP_W, ldr_top, lip_top),
    ]
    out = parts[0]
    for p in parts[1:]:
        out = out + p
    return out


def patch(man):
    return man - ir_pocket_cut() + ir_pocket_add()


def diffuser():
    """Clear PETG cap over the lens, sized for the new protrusion."""
    od, bore, end = 22.4, LENS_D + 0.8, 1.0
    h = LENS_PROUD + end + 0.5
    return (Manifold.cylinder(h, od / 2, od / 2, 96)
            - Manifold.cylinder(h, bore / 2, bore / 2, 96).translate([0, 0, end]))


def ir_board_model():
    """Rough model of the board, for the previews and the fit check."""
    face = PCB_FACE_X
    pcb = (box(face, face + PCB_T, IR_Y - PCB_W / 2, IR_Y + PCB_W / 2, IR_Z - (PCB_H - PCB_ABOVE_AXIS), IR_Z)
           + xcyl(2 * PCB_ABOVE_AXIS, IR_Y, IR_Z, face, face + PCB_T)
           ^ box(face, face + PCB_T, IR_Y - PCB_W / 2, IR_Y + PCB_W / 2, IR_Z - 20, IR_Z + 20))
    lens = xcyl(LENS_D, IR_Y, IR_Z, face - LENS_LEN, face)
    ldr = xcyl(LDR_D, IR_Y - LDR_DX, IR_Z - LDR_DY, face - LDR_LEN, face)
    return pcb + lens + ldr


def previews(usb, board):
    """3D renders and exact sections of the IR zone."""
    from preview import render_sheet, section_sheet
    PREVIEW.mkdir(exist_ok=True)
    zone = usb ^ box(-8, RAIL_DEPTH + 0.5, -1, 32, -1, 44)     # sensor wall around the IR light
    case_c, board_c = (0.24, 0.55, 0.58), (0.2, 0.62, 0.25)
    render_sheet([
        ("IR zone from outside, board fitted", [(zone, case_c), (board, board_c)], (1, 0.45, -0.35)),
        ("IR zone from inside (behind), board fitted", [(zone, case_c), (board, board_c)], (-1, 0.5, -0.5)),
        ("IR zone from inside, empty pocket", [(zone, case_c)], (-1, 0.5, -0.5)),
        ("USB base, from the rear opening", [(usb, case_c), (board, board_c)], (-0.7, 0.45, -0.55)),
    ], PREVIEW / "v2_ir_fit_3d.png")
    print("  preview/v2_ir_fit_3d.png")

    parts = [(usb, case_c, 1.0), (board, board_c, 0.85)]
    ldr_z = IR_Z - LDR_DY
    lip_y = IR_Y + PCB_W / 2 + SIDE_CLEAR - LIP_W / 2
    section_sheet([
        ("plan section through the lens axis (z=%.1f)" % IR_Z, parts, "z", IR_Z, (-8, 16), (0, 32), "x", "y"),
        ("plan section through the photoresistor (z=%.1f)" % ldr_z, parts, "z", ldr_z, (-8, 16), (0, 32), "x", "y"),
        ("plan section through the stops (z=6)", parts, "z", 6.0, (-8, 16), (0, 32), "x", "y"),
        ("side section on the lens axis (y=%.1f)" % IR_Y, parts, "y", IR_Y, (-8, 16), (0, 36), "x", "z"),
        ("side section through the right lip (y=%.1f)" % lip_y, parts, "y", lip_y, (-8, 16), (0, 36), "x", "z"),
        ("wall elevation seen from OUTSIDE (x=1.2), board behind", parts, "x", 1.2, (32, 0), (0, 36), "y (mirrored: viewed from outside)", "z"),
    ], PREVIEW / "v2_ir_fit_sections.png")
    print("  preview/v2_ir_fit_sections.png")


def fit_check(case, board):
    """The board must not intersect the case; report clearances."""
    hit = case ^ board
    print(f"  board/case intersection volume: {hit.volume():.3f} mm3  ({'OK' if hit.volume() < 1e-3 else 'COLLISION'})")
    print(f"  lens front at x={PCB_FACE_X - LENS_LEN:.2f} (proud {LENS_PROUD:.1f} mm), LDR tip at x={PCB_FACE_X - LDR_LEN:.2f}")
    print(f"  PCB bottom edge z={IR_Z - (PCB_H - PCB_ABOVE_AXIS):.2f}, floor z={FLOOR} -> {IR_Z - (PCB_H - PCB_ABOVE_AXIS) - FLOOR:.2f} mm clearance")


if __name__ == "__main__":
    print("Patching v2 STLs for the real IR light board:")
    board = ir_board_model()
    usb = patch(load("v2_base_usb.stl"))
    save(usb, "v2_base_usb.stl")
    fit_check(usb, board)
    pis = patch(load("v2_base_pisugar.stl"))
    save(pis, "v2_base_pisugar.stl")
    fit_check(pis, board)

    # test plate = the sensor wall of the USB base, deep enough to include the new rails
    plate = usb ^ box(-6, RAIL_DEPTH + 0.5, -1, 100, -1, 50)
    save(plate, "v2_test_plate.stl")

    save(diffuser(), "v2_led_diffuser.stl")
    for n in ("v2_lid.stl", "v2_stand.stl", "v2_pir_shroud.stl"):
        save(load(n), n)   # unchanged, copied so stl/ is the complete print set

    print("Previews:")
    previews(usb, board)
    print("Done ->", OUT)
