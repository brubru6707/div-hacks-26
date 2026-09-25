#!/usr/bin/env python3
"""Build the Pi5 camera+PIR enclosure STLs (base variants + lid) with trimesh."""
import os
import numpy as np
import trimesh
from trimesh.boolean import union, difference

OUT = os.path.join(os.path.dirname(__file__), "stl")
os.makedirs(OUT, exist_ok=True)

# ---- measured component sizes (mm) ----
PI_LEN, PI_WID, PCB_T, COMP_H = 85.0, 56.0, 1.6, 22.0
PISUGAR_H = 15.0
HOLE_DX, HOLE_DY, HOLE_INSET = 58.0, 49.0, 3.5
SCREW_D = 2.5
CAM_LENS_D, CAM_MDX, CAM_MDY, CAM_MD = 9.0, 21.0, 12.5, 2.2
PIR_DOME_D = 23.5
# ---- case ----
WALL, FLOOR_T, CLEAR, LID_LIP = 2.4, 2.4, 1.5, 5.0

def box(size, corner):
    b = trimesh.creation.box(extents=size)
    b.apply_translation([corner[i] + size[i]/2 for i in range(3)])
    return b

def cyl(d, h, cx, cy, z0, n=64):
    c = trimesh.creation.cylinder(radius=d/2, height=h, sections=n)
    c.apply_translation([cx, cy, z0 + h/2])
    return c

def build_base(include_pisugar):
    under = (PISUGAR_H + 2) if include_pisugar else 4.0
    inner_l, inner_w = PI_LEN + 2*CLEAR, PI_WID + 2*CLEAR
    inner_h = under + PCB_T + COMP_H
    ext_l, ext_w = inner_l + 2*WALL, inner_w + 2*WALL

    outer = box([ext_l, ext_w, FLOOR_T + inner_h], [0, 0, 0])
    cavity = box([inner_l, inner_w, inner_h + 1], [WALL, WALL, FLOOR_T])
    base = difference([outer, cavity], engine="manifold")

    cuts = []
    # long edge (y=0): USB x4 + Ethernet band
    cuts.append(box([inner_l - 16, WALL + 2, 17], [WALL + 8, -1, FLOOR_T + under - 1]))
    # short edge (x=0): USB-C power + 2x micro-HDMI band
    cuts.append(box([WALL + 2, inner_w - 12, 12], [-1, WALL + 6, FLOOR_T + under - 1]))
    # vent slots on the y=0 wall near the top
    for i in range(6):
        cuts.append(box([5, WALL + 2, 6], [WALL + 12 + i*11, -1, FLOOR_T + inner_h - 9]))
    base = difference([base] + cuts, engine="manifold")

    # standoffs at Pi hole positions (M2.5 pilot holes)
    x0 = WALL + CLEAR + HOLE_INSET
    y0 = WALL + CLEAR + HOLE_INSET
    posts = []
    for dx in (0, HOLE_DX):
        for dy in (0, HOLE_DY):
            post = cyl(6, under, x0 + dx, y0 + dy, FLOOR_T - 0.01)
            hole = cyl(SCREW_D, min(5, under) + 0.2, x0 + dx, y0 + dy,
                       FLOOR_T + under - min(5, under))
            posts.append(difference([post, hole], engine="manifold"))
    base = union([base] + posts, engine="manifold")
    return base

def build_lid():
    inner_l, inner_w = PI_LEN + 2*CLEAR, PI_WID + 2*CLEAR
    ext_l, ext_w = inner_l + 2*WALL, inner_w + 2*WALL
    top = box([ext_l, ext_w, WALL], [0, 0, 0])
    lip = box([inner_l - 0.6, inner_w - 0.6, LID_LIP], [WALL + 0.3, WALL + 0.3, -LID_LIP])
    hollow = box([inner_l - 6, inner_w - 6, LID_LIP + 0.1], [WALL + 2.7, WALL + 2.7, -LID_LIP - 0.05])
    lid = difference([union([top, lip], engine="manifold"), hollow], engine="manifold")

    cx, px, cy = ext_l * 0.32, ext_l * 0.70, ext_w / 2
    cuts = [cyl(CAM_LENS_D, WALL + LID_LIP + 2, cx, cy, -LID_LIP - 1),
            cyl(PIR_DOME_D, WALL + LID_LIP + 2, px, cy, -LID_LIP - 1)]
    for mx in (-CAM_MDX/2, CAM_MDX/2):
        for my in (-CAM_MDY/2, CAM_MDY/2):
            cuts.append(cyl(CAM_MD, WALL + LID_LIP + 2, cx + mx, cy + my, -LID_LIP - 1))
    return difference([lid] + cuts, engine="manifold")

def save(mesh, name):
    p = os.path.join(OUT, name)
    mesh.export(p)
    print(f"  {name}: watertight={mesh.is_watertight} "
          f"bbox={np.round(mesh.extents,1).tolist()} -> {os.path.getsize(p)//1024} KB")

if __name__ == "__main__":
    print("Building STLs:")
    save(build_base(True),  "base_with_pisugar.stl")
    save(build_base(False), "base_no_pisugar.stl")
    save(build_lid(),       "lid.stl")
    print("Done ->", OUT)
