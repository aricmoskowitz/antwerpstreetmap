#!/usr/bin/env python3
"""
Build-time preprocessor for Antwerp Inside the Ring.

Reads the raw source data (data/source/*.json) and produces two static
JS data files consumed directly by the app (data/generated/*.js):

  - map-data.js         projected base map: boundary, streets, waterways,
                        neighborhoods (closed polygons), landmarks, parks,
                        each with a ready-to-use SVG path `d` string.
  - curriculum-data.js  the 68-module curriculum, unchanged in structure,
                        wrapped as a JS global.

Re-run this whenever the source data or ring boundary changes:
    python3 build/preprocess.py
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"
OUT = ROOT / "data" / "generated"
OUT.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------
# Load source data
# ------------------------------------------------------------------

with open(SRC / "antwerp-inside-the-ring-data.json") as f:
    base = json.load(f)

with open(SRC / "antwerp-curriculum-data.json") as f:
    curriculum = json.load(f)

# ------------------------------------------------------------------
# Name normalization (for matching curriculum objects to base geometry)
# ------------------------------------------------------------------


def norm(s):
    s = re.sub(r"\s+", " ", s.strip())
    s = s.replace(" )", ")").replace("( ", "(")
    return s.upper()


# ------------------------------------------------------------------
# Projection: equirectangular with cos(lat0) correction
# ------------------------------------------------------------------

def all_coords():
    for pt in base["ring_boundary"]:
        yield pt
    for s in base["streets"]:
        for line in s["lines"]:
            for pt in line:
                yield pt
    for w in base["waterways"]:
        for line in w["lines"]:
            for pt in line:
                yield pt
    for n in base["neighborhoods"]:
        for line in n["lines"]:
            for pt in line:
                yield pt
    for l in base["landmarks"]:
        for pt in l["ring"]:
            yield pt
    for p in base["parks"]:
        for pt in p["ring"]:
            yield pt


lons = []
lats = []
for lon, lat in all_coords():
    lons.append(lon)
    lats.append(lat)

lon_min, lon_max = min(lons), max(lons)
lat_min, lat_max = min(lats), max(lats)

PAD = 0.02
lon_span = lon_max - lon_min
lat_span = lat_max - lat_min
lon_min -= lon_span * PAD
lon_max += lon_span * PAD
lat_min -= lat_span * PAD
lat_max += lat_span * PAD
lon_span = lon_max - lon_min
lat_span = lat_max - lat_min

lat0 = (lat_min + lat_max) / 2.0
COS_LAT0 = math.cos(math.radians(lat0))

VIEW_W = 1000.0
SCALE = VIEW_W / (lon_span * COS_LAT0)
VIEW_H = lat_span * SCALE


def project(pt):
    lon, lat = pt
    x = (lon - lon_min) * COS_LAT0 * SCALE
    y = (lat_max - lat) * SCALE
    return (round(x, 2), round(y, 2))


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


R_EARTH = 6371000.0


def haversine_m(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(x))


def lines_length_m(lines_ll):
    total = 0.0
    for line in lines_ll:
        for i in range(len(line) - 1):
            total += haversine_m(line[i], line[i + 1])
    return round(total)


def ring_area_m2(ring_ll):
    """Shoelace area in m^2 via an equirectangular meters projection."""
    lat0 = ring_ll[0][1]
    cos0 = math.cos(math.radians(lat0))
    pts = [(lon * cos0 * math.pi / 180 * R_EARTH, lat * math.pi / 180 * R_EARTH) for lon, lat in ring_ll]
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    a = 0.0
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        a += x0 * y1 - x1 * y0
    return round(abs(a) / 2)


# ------------------------------------------------------------------
# Path-string builders (operate on projected [x,y] points)
# ------------------------------------------------------------------


def line_path_d(lines_ll):
    """Multi-subpath open polyline path from a list of lon/lat polylines."""
    parts = []
    for line in lines_ll:
        pts = [project(p) for p in line]
        if len(pts) < 2:
            continue
        d = "M " + " L ".join(f"{x},{y}" for x, y in pts)
        parts.append(d)
    return " ".join(parts)


def polygon_path_d(rings_ll):
    """Multi-subpath closed polygon path from a list of lon/lat rings."""
    parts = []
    for ring in rings_ll:
        pts = [project(p) for p in ring]
        if len(pts) < 3:
            continue
        d = "M " + " L ".join(f"{x},{y}" for x, y in pts) + " Z"
        parts.append(d)
    return " ".join(parts)


def bbox_of_lines(lines_ll):
    """[minX,minY,maxX,maxY] in projected space, for camera fitting."""
    xs = []
    ys = []
    for line in lines_ll:
        for p in line:
            x, y = project(p)
            xs.append(x)
            ys.append(y)
    return [min(xs), min(ys), max(xs), max(ys)]


def bbox_of_rings(rings_ll):
    return bbox_of_lines(rings_ll)


def polyline_length_px(line_ll):
    pts = [project(p) for p in line_ll]
    return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def midpoint_of_longest(lines_ll):
    """Representative badge point: the midpoint of the longest sub-line."""
    best = max(lines_ll, key=lambda line: polyline_length_px(line))
    pts = [project(p) for p in best]
    total = sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    if total == 0:
        return pts[0]
    half = total / 2.0
    acc = 0.0
    for i in range(len(pts) - 1):
        seg = dist(pts[i], pts[i + 1])
        if acc + seg >= half:
            t = 0 if seg == 0 else (half - acc) / seg
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t
            y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
            return (round(x, 2), round(y, 2))
        acc += seg
    return pts[-1]


def centroid_of_ring(ring_ll):
    """Area-weighted centroid (shoelace) of a closed lon/lat ring, projected."""
    pts = [project(p) for p in ring_ll]
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    a = cx = cy = 0.0
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a *= 0.5
    if abs(a) < 1e-9:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (round(sum(xs) / len(xs), 2), round(sum(ys) / len(ys), 2))
    cx /= 6 * a
    cy /= 6 * a
    return (round(cx, 2), round(cy, 2))


def centroid_of_rings(rings_ll):
    """Centroid of the largest ring among several (multi-part polygons)."""
    best = max(rings_ll, key=lambda r: abs(_shoelace_area(r)))
    return centroid_of_ring(best)


def _shoelace_area(ring_ll):
    pts = [project(p) for p in ring_ll]
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    a = 0.0
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        a += x0 * y1 - x1 * y0
    return a / 2.0


# ------------------------------------------------------------------
# Neighborhood polygon closure
# ------------------------------------------------------------------
#
# Neighborhood outlines in the source data are open polylines (one or more
# per neighborhood), clipped against the ring boundary. Most single-segment
# outlines are already closed loops. The rest need stitching:
#   1. Greedily chain the nearest available loose endpoints across all of a
#      neighborhood's line segments into as few chains as possible.
#   2. For any chain whose two ends don't already meet, close the gap by
#      splicing in the shorter arc of the ring_boundary between those ends
#      (the same logic used to build the ring boundary itself: real
#      neighborhood-interior edges + a shared ring-boundary edge).
#   3. Multi-part neighborhoods (disconnected chains) are kept as a
#      multi-subpath polygon.
#
# This is a best-effort reconstruction, not a re-import of surveyed
# municipal polygons (the migration brief's original per-neighborhood
# source file was not available) - flagged here and in the project README.

RING = base["ring_boundary"]
CHAIN_MERGE_CUTOFF = 0.02  # degrees (~2.2km) - generous; picks the closest
                            # available pair each round, so this only stops
                            # us from merging two totally unrelated shapes.
CLOSE_TOL = 0.0002  # degrees (~22m) - already-closed chain tolerance


def chain_key(chain):
    return chain[0], chain[-1]


def merge_two(a, b, which):
    """which in {'ee','es','se','ss'} describing which ends touched."""
    if which == "ee":  # a-end meets b-start(reversed b) -> a + reversed(b)
        return a + list(reversed(b))[1:]
    if which == "es":  # a-end meets b-start -> a + b
        return a + b[1:]
    if which == "se":  # a-start meets b-end -> b + a
        return b + a[1:]
    if which == "ss":  # a-start meets b-start -> reversed(b) + a
        return list(reversed(b)) + a[1:]
    raise ValueError(which)


def stitch_chains(lines):
    chains = [list(line) for line in lines]
    while len(chains) > 1:
        best = None  # (distance, i, j, which)
        for i in range(len(chains)):
            for j in range(i + 1, len(chains)):
                a, b = chains[i], chains[j]
                candidates = [
                    (dist(a[-1], b[0]), "es"),
                    (dist(a[-1], b[-1]), "ee"),
                    (dist(a[0], b[-1]), "se"),
                    (dist(a[0], b[0]), "ss"),
                ]
                d, which = min(candidates, key=lambda c: c[0])
                if best is None or d < best[0]:
                    best = (d, i, j, which)
        d, i, j, which = best
        if d > CHAIN_MERGE_CUTOFF:
            break
        merged = merge_two(chains[i], chains[j], which)
        new_chains = [c for k, c in enumerate(chains) if k not in (i, j)]
        new_chains.append(merged)
        chains = new_chains
    return chains


def ring_arc_between(p, q):
    """Shorter arc of the ring boundary connecting near-p to near-q."""
    i = min(range(len(RING)), key=lambda k: dist(RING[k], p))
    j = min(range(len(RING)), key=lambda k: dist(RING[k], q))
    n = len(RING) - 1  # RING[0] == RING[-1]
    ring_open = RING[:-1]

    def arc(a, b):
        if a <= b:
            return ring_open[a:b + 1]
        return ring_open[a:] + ring_open[: b + 1]

    fwd = arc(i, j)
    bwd = list(reversed(arc(j, i)))

    def arc_len(pts):
        return sum(dist(pts[k], pts[k + 1]) for k in range(len(pts) - 1))

    return fwd if arc_len(fwd) <= arc_len(bwd) else bwd


def close_chain(chain):
    if dist(chain[0], chain[-1]) <= CLOSE_TOL:
        ring = chain[:]
        ring[-1] = ring[0]
        return ring
    arc = ring_arc_between(chain[-1], chain[0])
    return chain + arc


def build_neighborhood_rings(neighborhood):
    # Some neighborhoods include a sub-line that is already a closed loop on
    # its own (e.g. a roundabout or an interior island) - split those off
    # before greedy stitching so they don't get wrongly welded onto the
    # main chain via their (identical) start/end point.
    closed_rings = []
    open_lines = []
    for line in neighborhood["lines"]:
        # Require a handful of vertices too, so a short 2-3 point stub in a
        # tiny neighborhood (whose ends are close only because the whole
        # feature is smaller than CLOSE_TOL) doesn't get mistaken for a
        # meaningful closed sub-loop.
        if len(line) >= 4 and dist(line[0], line[-1]) <= CLOSE_TOL:
            ring = line[:]
            ring[-1] = ring[0]
            closed_rings.append(ring)
        else:
            open_lines.append(line)
    if open_lines:
        chains = stitch_chains(open_lines)
        closed_rings.extend(close_chain(c) for c in chains)
    return closed_rings


# ------------------------------------------------------------------
# Assemble output object index, keyed by type -> normalized name
# ------------------------------------------------------------------

objects = {
    "road": {},
    "square": {},
    "waterway": {},
    "building": {},
    "park": {},
    "neighborhood": {},
}

for s in base["streets"]:
    bucket = "square" if s["is_square"] else "road"
    key = norm(s["name"])
    objects[bucket][key] = {
        "name": s["name"],
        "kind": "line",
        "d": line_path_d(s["lines"]),
        "badge": list(midpoint_of_longest(s["lines"])),
        "length_m": lines_length_m(s["lines"]),
        "bbox": bbox_of_lines(s["lines"]),
    }

for w in base["waterways"]:
    key = norm(w["name"])
    objects["waterway"][key] = {
        "name": w["name"],
        "kind": "line",
        "d": line_path_d(w["lines"]),
        "badge": list(midpoint_of_longest(w["lines"])),
        "water_type": w["type"],
        "length_m": lines_length_m(w["lines"]),
        "bbox": bbox_of_lines(w["lines"]),
    }

for l in base["landmarks"]:
    key = norm(l["name"])
    objects["building"][key] = {
        "name": l["name"],
        "kind": "polygon",
        "d": polygon_path_d([l["ring"]]),
        "badge": list(centroid_of_ring(l["ring"])),
        "is_church": l["is_church"],
        "area_m2": ring_area_m2(l["ring"]),
        "bbox": bbox_of_rings([l["ring"]]),
    }

for p in base["parks"]:
    key = norm(p["name"])
    objects["park"][key] = {
        "name": p["name"],
        "kind": "polygon",
        "d": polygon_path_d([p["ring"]]),
        "badge": list(centroid_of_ring(p["ring"])),
        "park_type": p["type"],
        "area_m2": ring_area_m2(p["ring"]),
        "bbox": bbox_of_rings([p["ring"]]),
    }

neighborhood_debug = []
for n in base["neighborhoods"]:
    key = norm(n["name"])
    rings = build_neighborhood_rings(n)
    objects["neighborhood"][key] = {
        "name": n["name"],
        "kind": "polygon",
        "d": polygon_path_d(rings),
        "badge": list(centroid_of_rings(rings)),
        "density": n.get("density"),
        "parts": len(rings),
        "bbox": bbox_of_rings(rings),
    }
    neighborhood_debug.append(
        {
            "name": n["name"],
            "parts": len(rings),
            "orig_segments": len(n["lines"]),
        }
    )

# ------------------------------------------------------------------
# Background context layers (dim, non-interactive)
# ------------------------------------------------------------------

bg_streets_d = line_path_d([seg for s in base["streets"] for seg in s["lines"]])
bg_waterways_d = line_path_d([seg for w in base["waterways"] for seg in w["lines"]])
bg_neighborhoods_d = " ".join(
    objects["neighborhood"][norm(n["name"])]["d"] for n in base["neighborhoods"]
)
boundary_d = polygon_path_d([base["ring_boundary"]])

# ------------------------------------------------------------------
# App icon: a simplified silhouette of the ring boundary itself
# ------------------------------------------------------------------


def rdp(points, epsilon):
    if len(points) < 3:
        return points

    def dist_point_to_seg(p, a, b):
        ax, ay = a
        bx, by = b
        px, py = p
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    dmax, index = 0, 0
    for k in range(1, len(points) - 1):
        d = dist_point_to_seg(points[k], points[0], points[-1])
        if d > dmax:
            index, dmax = k, d
    if dmax > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def build_icon_path(size=180, pad=0.08, epsilon=0.001):
    simplified = rdp(base["ring_boundary"][:-1], epsilon)
    ilons = [p[0] for p in simplified]
    ilats = [p[1] for p in simplified]
    ilon_min, ilon_max = min(ilons), max(ilons)
    ilat_min, ilat_max = min(ilats), max(ilats)
    ilat0 = (ilat_min + ilat_max) / 2
    icos0 = math.cos(math.radians(ilat0))
    ilon_span = (ilon_max - ilon_min) * (1 + 2 * pad)
    ilat_span = (ilat_max - ilat_min) * (1 + 2 * pad)
    ilon_min -= (ilon_max - ilon_min) * pad
    top_lat = ilat_max + (ilat_max - ilat_min) * pad
    iscale = min(size / (ilon_span * icos0), size / ilat_span)
    proj = []
    for lon, lat in simplified:
        x = (lon - ilon_min) * icos0 * iscale
        y = (top_lat - lat) * iscale
        proj.append((x, y))
    xs = [p[0] for p in proj]
    ys = [p[1] for p in proj]
    offx = (size - (max(xs) - min(xs))) / 2 - min(xs)
    offy = (size - (max(ys) - min(ys))) / 2 - min(ys)
    proj = [(round(x + offx, 1), round(y + offy, 1)) for x, y in proj]
    return "M " + " L ".join(f"{x},{y}" for x, y in proj) + " Z"


icon_path = build_icon_path()

map_data = {
    "viewBox": f"0 0 {VIEW_W:.1f} {VIEW_H:.2f}",
    "boundary": boundary_d,
    "bgStreets": bg_streets_d,
    "bgWaterways": bg_waterways_d,
    "bgNeighborhoods": bg_neighborhoods_d,
    "objects": objects,
    "iconPath": icon_path,
}

# ------------------------------------------------------------------
# Write output
# ------------------------------------------------------------------

with open(OUT / "map-data.js", "w") as f:
    f.write("// Generated by build/preprocess.py - do not hand-edit.\n")
    f.write("const MAP_DATA = ")
    f.write(json.dumps(map_data, separators=(",", ":")))
    f.write(";\n")

with open(OUT / "curriculum-data.js", "w") as f:
    f.write("// Copied by build/preprocess.py from data/source - do not hand-edit.\n")
    f.write("const CURRICULUM = ")
    f.write(json.dumps(curriculum, separators=(",", ":")))
    f.write(";\n")

print(f"viewBox: 0 0 {VIEW_W:.1f} {VIEW_H:.2f}   (lat0={lat0:.4f}, cos={COS_LAT0:.4f})")
print(f"map-data.js: {(OUT / 'map-data.js').stat().st_size / 1024:.1f} KB")
print(f"curriculum-data.js: {(OUT / 'curriculum-data.js').stat().st_size / 1024:.1f} KB")
print()
print("neighborhood stitching summary:")
multi_part = [n for n in neighborhood_debug if n["parts"] > 1]
print(f"  {len(neighborhood_debug)} total, {len(multi_part)} resulted in >1 closed part:")
for n in multi_part:
    print(f"    {n['name']}: {n['orig_segments']} source segments -> {n['parts']} closed part(s)")
