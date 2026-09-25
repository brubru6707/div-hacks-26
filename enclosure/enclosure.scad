// DivHacks 2026 — Pi 5 Camera + PIR node enclosure (parametric)
// Renders a base tray + lid. Camera and PIR mount on the lid.
// Two build variants via include_pisugar:
//   true  -> taller base to fit a PiSugar battery pack under the Pi
//   false -> shorter base, Pi mounts low
//
// Render from CLI, e.g.:
//   openscad -D 'part="base"' -D 'include_pisugar=true'  -o base_pisugar.stl   enclosure.scad
//   openscad -D 'part="base"' -D 'include_pisugar=false' -o base_nopisugar.stl enclosure.scad
//   openscad -D 'part="lid"'                              -o lid.stl           enclosure.scad
//
// !! Verify PiSugar height and port positions against the real hardware before printing. !!

/* ---------- what to render ---------- */
part = "all";           // "base", "lid", or "all" (all = preview both, side by side)
include_pisugar = true; // battery-pack variant

/* ---------- measured component sizes ---------- */
pi_len   = 85;   // Pi 5 PCB length (mm)
pi_wid   = 56;   // Pi 5 PCB width
pi_pcb_t = 1.6;  // PCB thickness
pi_comp_h = 20;  // clearance needed above the PCB for USB/Ethernet/GPIO stack

pisugar_h = 15;  // battery pack height under the Pi  (MEASURE YOURS)

// Pi 5 mounting holes: 58 x 49 mm spacing, 3.5 mm in from the board edges, M2.5
hole_dx = 58;
hole_dy = 49;
hole_inset = 3.5;
screw_d = 2.5;   // self-tapping into plastic standoff; use 2.8 for M2.5 heat-inserts

// Arducam IMX219 module ~ 25 x 24 mm; lens in the middle
cam_body = 26;       // you measured 2.6 cm
cam_lens_hole = 9;   // hole for the lens barrel
cam_mount_dx = 21;   // Arducam mount hole spacing X
cam_mount_dy = 12.5; // Arducam mount hole spacing Y
cam_mount_d = 2.2;   // M2

// HC-SR501 PIR: PCB ~32 x 24, white dome ~23 mm diameter sticks through
pir_dome_d = 23.5;

/* ---------- case parameters ---------- */
wall = 2.4;
floor_t = 2.4;
clear = 1.5;             // gap around the board
under_gap = include_pisugar ? (pisugar_h + 2) : 4;  // floor-to-PCB gap
inner_l = pi_len + 2*clear;
inner_w = pi_wid + 2*clear;
inner_h = under_gap + pi_pcb_t + pi_comp_h;          // internal clear height
lid_lip = 6;             // depth of lid lip that inserts into the base
eps = 0.01;

/* ---------- helpers ---------- */
module standoff(h) {
    difference() {
        cylinder(h=h, d=6, $fn=40);
        translate([0,0,h-5]) cylinder(h=6, d=screw_d, $fn=30);
    }
}

// four corner-ish standoffs at the Pi hole positions
module standoffs(h) {
    x0 = wall + clear + hole_inset;
    y0 = wall + clear + hole_inset;
    for (dx=[0,hole_dx], dy=[0,hole_dy])
        translate([x0+dx, y0+dy, floor_t-eps]) standoff(h);
}

// a rectangular port window cut through a wall
module port_window(w, h, zoff) {
    translate([-eps, -eps, floor_t+zoff]) cube([w, wall+2*eps, h]);
}

module base() {
    ext_l = inner_l + 2*wall;
    ext_w = inner_w + 2*wall;
    difference() {
        // solid outer shell
        cube([ext_l, ext_w, floor_t + inner_h]);
        // hollow it
        translate([wall, wall, floor_t])
            cube([inner_l, inner_w, inner_h + eps]);

        // PORT WINDOWS  (adjust to your board orientation before printing)
        // long edge (y=0): USB x4 + Ethernet band
        translate([wall+8, 0, 0]) port_window(inner_l-16, 17, under_gap-1);
        // short edge (x=0): USB-C power + 2x micro-HDMI band
        translate([0, wall+6, 0])
            rotate([0,0,90]) port_window(inner_w-12, 12, under_gap-1);

        // side vent slots
        for (i=[0:5])
            translate([wall+12+i*11, -eps, floor_t+inner_h-9])
                cube([5, wall+2*eps, 6]);
    }
    standoffs(under_gap);
}

module lid() {
    ext_l = inner_l + 2*wall;
    ext_w = inner_w + 2*wall;
    cx = ext_l*0.32;   // camera cluster near one end
    px = ext_l*0.70;   // PIR near the other end
    cy = ext_w/2;
    difference() {
        union() {
            // top plate
            cube([ext_l, ext_w, wall]);
            // inner lip that drops into the base
            translate([wall+0.3, wall+0.3, -lid_lip])
                cube([inner_l-0.6, inner_w-0.6, lid_lip]);
        }
        // camera lens hole + mount holes
        translate([cx, cy, -lid_lip-eps]) cylinder(h=wall+lid_lip+1, d=cam_lens_hole, $fn=50);
        for (mx=[-cam_mount_dx/2, cam_mount_dx/2], my=[-cam_mount_dy/2, cam_mount_dy/2])
            translate([cx+mx, cy+my, -lid_lip-eps]) cylinder(h=wall+lid_lip+1, d=cam_mount_d, $fn=30);
        // PIR dome hole
        translate([px, cy, -lid_lip-eps]) cylinder(h=wall+lid_lip+1, d=pir_dome_d, $fn=60);
        // hollow the lip so it is a rim, not a block
        translate([wall+2.7, wall+2.7, -lid_lip-eps]) cube([inner_l-6, inner_w-6, lid_lip]);
    }
}

/* ---------- output ---------- */
if (part == "base") base();
else if (part == "lid") lid();
else { // "all": preview
    base();
    translate([0, inner_w + 3*wall + 8, 0]) lid();
}
