"""Small preview helpers for the v2 patch scripts: a numpy z-buffer render
(orthographic, flat shaded, correct hidden surfaces) and exact 2D sections
through manifold3d solids.  Only numpy + matplotlib."""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _tris(man):
    m = man.to_mesh()
    v = np.asarray(m.vert_properties)[:, :3]
    return v[np.asarray(m.tri_verts)]


def _basis(view_dir, up=(0, 0, 1)):
    """Rows: screen right, screen up, depth (forward = direction the camera looks)."""
    f = np.asarray(view_dir, float); f /= np.linalg.norm(f)
    r = np.cross(f, np.asarray(up, float)); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return np.array([r, u, f])


def render(parts, view_dir, px=900, pad=1.06, light=(-0.35, 0.45, -0.82)):
    """parts: [(manifold, (r,g,b)), ...]; view_dir: world direction the camera
    looks along.  Orthographic z-buffer, flat shading with a view-space light
    (default: over the camera's left shoulder).  Returns an (px, px, 3) image."""
    B = _basis(view_dir)
    tris, cols = [], []
    for man, col in parts:
        t = _tris(man)
        tris.append(t)
        cols.append(np.tile(np.asarray(col, float), (len(t), 1)))
    T = np.concatenate(tris)
    C = np.concatenate(cols)
    V = (T.reshape(-1, 3) @ B.T).reshape(-1, 3, 3)          # (right, up, depth)
    # (right, up, depth) is left-handed, so negate the cross product: n[:, 2] < 0 faces the camera
    n = -np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    L = np.asarray(light, float); L /= np.linalg.norm(L)
    shade = 0.3 + 0.7 * np.clip(n @ L, 0, 1)
    C = C * shade[:, None]
    lo, hi = V[:, :, :2].reshape(-1, 2).min(0), V[:, :, :2].reshape(-1, 2).max(0)
    c, r = (lo + hi) / 2, (hi - lo).max() / 2 * pad
    scale = px / (2 * r)
    P = (V[:, :, :2] - c) * scale + px / 2
    D = V[:, :, 2]
    img = np.ones((px, px, 3))
    zbuf = np.full((px, px), np.inf)
    front = np.where(n[:, 2] < 0)[0]                        # faces whose normal points at the camera
    for i in front:
        p = P[i]
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, px - 1), min(y1, px - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-9:
            continue
        l0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / det
        l1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / det
        l2 = 1 - l0 - l1
        inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        if not inside.any():
            continue
        d = l0 * D[i, 0] + l1 * D[i, 1] + l2 * D[i, 2]
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        upd = inside & (d < sub)
        sub[upd] = d[upd]
        img[y0:y1 + 1, x0:x1 + 1][upd] = C[i]
    return img[::-1]


def render_sheet(views, path, cols=2):
    """views: [(title, parts, view_dir), ...] -> one PNG."""
    rows = int(np.ceil(len(views) / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(7 * cols, 7 * rows))
    for ax, (title, parts, view_dir) in zip(np.ravel(axes), views):
        ax.imshow(render(parts, view_dir))
        ax.set_title(title)
        ax.set_axis_off()
    for ax in np.ravel(axes)[len(views):]:
        ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)


def section_polys(man, axis, value):
    """Exact section; returns [(points Nx2 in (h, v) plot coords, is_outer)] where
    h/v are (y, z) for axis x, (x, z) for axis y, (x, y) for axis z."""
    if axis == "x":
        cs = man.rotate([0, -90, 0]).slice(value)      # coords (-z, y)
        conv = lambda p: np.c_[p[:, 1], -p[:, 0]]
    elif axis == "y":
        cs = man.rotate([90, 0, 0]).slice(value)       # coords (x, -z)
        conv = lambda p: np.c_[p[:, 0], -p[:, 1]]
    else:
        cs = man.slice(value)
        conv = lambda p: p
    out = []
    for poly in cs.to_polygons():
        p = np.array(poly)
        a = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
        out.append((conv(p), a > 0))
    return out


def section_sheet(sections, path, cols=3):
    """sections: [(title, [(manifold, color, alpha)], axis, value, hlim, vlim, hlabel, vlabel)]"""
    from matplotlib.path import Path
    from matplotlib.patches import PathPatch
    rows = int(np.ceil(len(sections) / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(6 * cols, 6 * rows))
    for ax, (title, parts, axis, value, hlim, vlim, hl, vl) in zip(np.ravel(axes), sections):
        for man, col, alpha in parts:
            polys = section_polys(man, axis, value)
            if not polys:
                continue
            verts, codes = [], []
            for p, _outer in polys:
                verts.extend(p.tolist() + [p[0].tolist()])
                codes.extend([Path.MOVETO] + [Path.LINETO] * (len(p) - 1) + [Path.CLOSEPOLY])
            ax.add_patch(PathPatch(Path(verts, codes), facecolor=col, edgecolor="k", lw=0.5, alpha=alpha))
        ax.set_xlim(*hlim); ax.set_ylim(*vlim); ax.set_aspect("equal")
        ax.set_xlabel(f"{hl} (mm)"); ax.set_ylabel(f"{vl} (mm)")
        ax.grid(True, lw=0.3); ax.set_title(title)
    for ax in np.ravel(axes)[len(sections):]:
        ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)
