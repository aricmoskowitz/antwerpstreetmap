#!/usr/bin/env python3
"""
Generates data/street-cards.json: one fact-only record per road (including
squares), waterway, park and building in the base map, for the Scroll feed
(Change Request 2). Geometry
itself is NOT duplicated here - the app draws from the already-projected
paths in data/generated/map-data.js; this file only adds derived facts
(orientation, intersections, nearby streets, neighborhood, curriculum
lessons) that aren't cheap to recompute in the browser. Every record has a
"kind": road, square, waterway, park or building.

Run after build/preprocess.py (it imports that module to reuse the
projection, base data, and reconstructed neighborhood polygons):

    python3 build/street_cards.py
"""
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"

spec = importlib.util.spec_from_file_location("preprocess", ROOT / "build" / "preprocess.py")
pp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp)

base = pp.base
norm = pp.norm

with open(SRC / "antwerp-curriculum-data.json") as f:
    curriculum = json.load(f)

streets = base["streets"]
R_EARTH = pp.R_EARTH


def haversine_m(a, b):
    return pp.haversine_m(a, b)


def all_points(s):
    pts = []
    for line in s["lines"]:
        pts.extend(line)
    return pts


def line_endpoints(s):
    """(point, line_index) for the first and last vertex of every line -
    the candidate set for "the two segment endpoints farthest apart"."""
    out = []
    for li, line in enumerate(s["lines"]):
        out.append((tuple(line[0]), li))
        out.append((tuple(line[-1]), li))
    return out


# ------------------------------------------------------------------
# 1. Grid index of every street's vertices, for exact-vertex intersection
#    lookups. The source data is noded (verified separately): streets that
#    truly meet share identical/near-identical coordinates, so a small grid
#    cell (~1.1m) with a 3x3 neighbor check is enough - no need for a full
#    tolerance-radius spatial index.
# ------------------------------------------------------------------

GRID = 0.00001  # ~1.1m at this latitude


def cell(pt):
    return (round(pt[0] / GRID), round(pt[1] / GRID))


def neighbor_cells(c):
    cx, cy = c
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            yield (cx + dx, cy + dy)


vertex_cells = {}  # cell -> list of (street_idx, point)
for i, s in enumerate(streets):
    for p in all_points(s):
        vertex_cells.setdefault(cell(p), []).append((i, tuple(p)))


def touching_streets_with_point(street_idx, pt):
    """{other_street_idx: shared_point} for streets sharing a vertex near pt."""
    out = {}
    for nc in neighbor_cells(cell(pt)):
        for j, p2 in vertex_cells.get(nc, []):
            if j == street_idx:
                continue
            if haversine_m(pt, p2) <= 1.2 and j not in out:
                out[j] = p2
    return out


# ------------------------------------------------------------------
# 2. Neighborhood assignment via point-in-polygon, reusing the same
#    reconstructed neighborhood outlines build/rebuild_curriculum.py uses.
# ------------------------------------------------------------------


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_rings(pt, rings):
    return any(point_in_ring(pt, r) for r in rings)


neighborhood_rings = {norm(n["name"]): pp.neighborhood_lonlat_rings[norm(n["name"])] for n in base["neighborhoods"]}


def ring_centroid(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


neighborhood_centroid = {k: ring_centroid(v[0]) for k, v in neighborhood_rings.items()}


def planar_dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def assign_neighborhood(pt):
    for key, rings in neighborhood_rings.items():
        if point_in_rings(pt, rings):
            return key
    return min(neighborhood_centroid, key=lambda k: planar_dist(pt, neighborhood_centroid[k]))


neighborhood_display_name = {norm(n["name"]): n["name"] for n in base["neighborhoods"]}

# ------------------------------------------------------------------
# 3. Which lessons reference each (name, type) object, from the curriculum.
# ------------------------------------------------------------------

lessons_by_object = {}
for sec in curriculum["sections"]:
    for mod in sec["modules"]:
        for lesson in mod["lessons"]:
            for obj in lesson["objects"]:
                if obj["type"] in ("road", "square", "waterway", "park", "building"):
                    key = (norm(obj["name"]), obj["type"])
                    lessons_by_object.setdefault(key, []).append(lesson["id"])

# ------------------------------------------------------------------
# 4. Grote Markt reference point, for the "nearest end is start" heuristic
# ------------------------------------------------------------------

grote_markt = next(s for s in streets if norm(s["name"]) == "GROTE MARKT")
gm_centroid = ring_centroid(all_points(grote_markt))


def bearing_deg(p1, p2):
    lon1, lat1 = p1
    lon2, lat2 = p2
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlon)
    theta = math.degrees(math.atan2(y, x))
    return (theta + 360) % 360


COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]


def direction(bearing):
    """Directional, start -> end: (from_side, to_side, "from–to"). A street
    heading north from its start reads "south–north" - it starts at its
    south end - not the undirected "north–south"."""
    i = int(round(bearing / 45.0)) % 8
    to_side = COMPASS[i]
    from_side = COMPASS[(i + 4) % 8]
    return from_side, to_side, f"{from_side}–{to_side}"


def bbox_of(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


# ------------------------------------------------------------------
# 5. Build one record per street
# ------------------------------------------------------------------

cards = []
stats = {"dead_ends": 0, "zero_intersections": 0, "name_explanations": 0, "curved": 0}

for idx, s in enumerate(streets):
    name = s["name"]
    is_square = s["is_square"]
    pts = all_points(s)
    bbox = bbox_of(pts)

    key = (norm(name), "square" if is_square else "road")
    lessons = sorted(set(lessons_by_object.get(key, [])))

    rep_pt = pts[len(pts) // 2] if not is_square else ring_centroid(pts)
    nb_key = assign_neighborhood(rep_pt)
    neighborhood = neighborhood_display_name.get(nb_key, nb_key)

    # every street this one shares a vertex with, across its whole length
    touching = {}
    for p in pts:
        for j, shared_pt in touching_streets_with_point(idx, p).items():
            touching.setdefault(j, shared_pt)

    if not touching:
        stats["zero_intersections"] += 1

    record = {
        "name": name,
        "kind": "square" if is_square else "road",
        "is_square": is_square,
        "bbox": bbox,
        "neighborhood": neighborhood,
        "lessons": lessons,
    }

    if is_square:
        record["intersections"] = sorted({streets[j]["name"] for j in touching})
    else:
        candidates = line_endpoints(s)
        best_pair = None
        best_d = -1
        for a_i in range(len(candidates)):
            for b_i in range(a_i + 1, len(candidates)):
                d = haversine_m(candidates[a_i][0], candidates[b_i][0])
                if d > best_d:
                    best_d = d
                    best_pair = (candidates[a_i], candidates[b_i])
        (pt_a, line_a), (pt_b, line_b) = best_pair

        # orient start = nearest Grote Markt (Belgian house-numbering
        # heuristic: numbers start at the end nearest the centre)
        if haversine_m(pt_a, gm_centroid) <= haversine_m(pt_b, gm_centroid):
            start_pt, end_pt, start_line, end_line = pt_a, pt_b, line_a, line_b
        else:
            start_pt, end_pt, start_line, end_line = pt_b, pt_a, line_b, line_a

        bearing = bearing_deg(start_pt, end_pt)
        from_side, to_side, axis = direction(bearing)

        shape = "straight"
        if start_line == end_line:
            line = s["lines"][start_line]
            path_len = sum(haversine_m(line[k], line[k + 1]) for k in range(len(line) - 1))
            straight = haversine_m(start_pt, end_pt)
            if straight > 0 and path_len / straight > 1.3:
                shape = "curved"
        if shape == "curved":
            stats["curved"] += 1

        def project_t(pt):
            # parametric position of pt's component along the start->end axis
            dx, dy = end_pt[0] - start_pt[0], end_pt[1] - start_pt[1]
            denom = dx * dx + dy * dy
            if denom == 0:
                return 0
            return ((pt[0] - start_pt[0]) * dx + (pt[1] - start_pt[1]) * dy) / denom

        ordered = sorted(touching.items(), key=lambda kv: project_t(kv[1]))
        seen_names = set()
        intersections = []
        for j, _ in ordered:
            nm = streets[j]["name"]
            if nm not in seen_names:
                seen_names.add(nm)
                intersections.append(nm)

        def crosses_near(pt):
            found = set()
            px, py = pt
            for j, s2 in enumerate(streets):
                if j == idx:
                    continue
                b = s2.get("_bbox")
                if b is None:
                    b = bbox_of(all_points(s2))
                    s2["_bbox"] = b
                if px < b[0] - 0.00025 or px > b[2] + 0.00025 or py < b[1] - 0.00025 or py > b[3] + 0.00025:
                    continue
                for p2 in all_points(s2):
                    if haversine_m(pt, p2) <= 20:
                        found.add(s2["name"])
                        break
            return sorted(found)

        start_crosses = crosses_near(start_pt)
        end_crosses = crosses_near(end_pt)
        if not start_crosses:
            stats["dead_ends"] += 1
        if not end_crosses:
            stats["dead_ends"] += 1

        record.update(
            {
                "orientation": {"axis": axis, "from": from_side, "to": to_side, "bearing": round(bearing), "shape": shape},
                # "pixel" is the same projected space as data/generated/map-data.js
                # (two numbers, not geometry) so the Scroll card can place a
                # start/end marker without re-deriving the projection in JS.
                "start": {"point": list(start_pt), "pixel": list(pp.project(start_pt)), "crosses": start_crosses},
                "end": {"point": list(end_pt), "pixel": list(pp.project(end_pt)), "crosses": end_crosses},
                "intersections": intersections,
            }
        )

    # Name-history explanations: none exist in this project's curriculum
    # data today (checked: no free-text field anywhere in
    # antwerp-curriculum-data.json). Per the CR, never invent one - look
    # for an optional "about" field and only include it if present.
    about = None
    for sec in curriculum["sections"]:
        for mod in sec["modules"]:
            for lesson in mod["lessons"]:
                for obj in lesson["objects"]:
                    if norm(obj["name"]) == key[0] and obj["type"] == key[1] and obj.get("about"):
                        about = obj["about"]
    if about:
        record["about"] = about
        stats["name_explanations"] += 1

    cards.append(record)

# ------------------------------------------------------------------
# 6. Cards for places: waterways, parks and buildings (churches included).
#    Instead of orientation and junctions, each lists the streets around it
#    (parks, buildings - the same 40 m the Walk game uses to attach them to
#    roads) or along and across it (waterways: quays and bridges), and a
#    couple of facts: the kind of water, park or building, and its size.
# ------------------------------------------------------------------

LAT0 = 51.215
COS0 = math.cos(math.radians(LAT0))


def to_m(p):
    return (p[0] * COS0 * 111320.0, p[1] * 111320.0)


def seg_point_m(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def segs_cross(a, b, c, d):
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def seg_seg_m(a, b, c, d):
    if segs_cross(a, b, c, d):
        return 0.0
    return min(seg_point_m(a, c, d), seg_point_m(b, c, d), seg_point_m(c, a, b), seg_point_m(d, a, b))


street_segs = []  # per street: (bbox in metres, [segments in metres], [vertices in metres])
for st in streets:
    segs, verts = [], []
    for line in st["lines"]:
        m = [to_m(p) for p in line]
        verts.extend(m)
        segs.extend(zip(m, m[1:]))
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    street_segs.append(((min(xs), min(ys), max(xs), max(ys)), segs, verts))


def streets_near(target_segs, radius, inside_ring=None):
    """{street index: distance m} for streets within `radius` of the target's
    segments (or with a vertex inside its footprint, e.g. a path in a park)"""
    xs = [p[0] for s in target_segs for p in s]
    ys = [p[1] for s in target_segs for p in s]
    tb = (min(xs) - radius, min(ys) - radius, max(xs) + radius, max(ys) + radius)
    found = {}
    for j, (b, segs, verts) in enumerate(street_segs):
        if b[2] < tb[0] or b[0] > tb[2] or b[3] < tb[1] or b[1] > tb[3]:
            continue
        if inside_ring and any(point_in_ring(v, inside_ring) for v in verts):
            found[j] = 0.0
            continue
        best = min(seg_seg_m(a, b2, c, d) for a, b2 in segs for c, d in target_segs)
        if best <= radius:
            found[j] = best
    return found


def ordered_names(found, key):
    out, seen = [], set()
    for j in sorted(found, key=key):
        nm = streets[j]["name"]
        if nm not in seen:
            seen.add(nm)
            out.append(nm)
    return out


def place_record(name, kind, pts_ll, rep_pt, facts, near):
    return {
        "name": name,
        "kind": kind,
        "is_square": False,
        "bbox": bbox_of(pts_ll),
        "neighborhood": neighborhood_display_name.get(assign_neighborhood(rep_pt)),
        "lessons": sorted(set(lessons_by_object.get((norm(name), kind), []))),
        "facts": facts,
        "near": near,
    }


WATER_NEAR_M = 25  # quays alongside, bridges across
# The data's Schelde line runs mid-river, 200-260 m out from the quays and
# by a varying amount, so no distance threshold separates the quays from
# the streets behind them. For the river, take the streets facing it
# instead: from a point every 25 m along the river, look straight inland
# (perpendicular, away from the water) and keep the first street in sight -
# plus anything crossing the river line itself (the tunnels under it).
RIVER_STEP_M = 25
RIVER_SIGHT_M = 450


def river_front(lines_m):
    ring_m = [to_m(p) for p in base["ring_boundary"]]
    keep = {}
    pos = 0.0
    for m in lines_m:
        for a, c in zip(m, m[1:]):
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            if L == 0:
                continue
            tx, ty = (c[0] - a[0]) / L, (c[1] - a[1]) / L
            n = int(L // RIVER_STEP_M) + 1
            for i in range(n):
                t = i / n
                o = (a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)
                # inland = the side of the line that's inside the ring
                nx, ny = ty, -tx
                if not point_in_ring((o[0] + nx * 40, o[1] + ny * 40), ring_m):
                    nx, ny = -nx, -ny
                far = (o[0] + nx * RIVER_SIGHT_M, o[1] + ny * RIVER_SIGHT_M)
                hit, hit_d = None, None
                for j, (b, ssegs, verts) in enumerate(street_segs):
                    if b[2] < min(o[0], far[0]) or b[0] > max(o[0], far[0]) or b[3] < min(o[1], far[1]) or b[1] > max(o[1], far[1]):
                        continue
                    for s1, s2 in ssegs:
                        if segs_cross(o, far, s1, s2):
                            # distance along the sight line to the crossing
                            d = seg_point_m(o, s1, s2)
                            if hit_d is None or d < hit_d:
                                hit, hit_d = j, d
                if hit is not None and hit not in keep:
                    keep[hit] = pos + t * L
            pos += L
    # tunnels: streets crossing the river line itself
    river_segs = [s for m in lines_m for s in zip(m, m[1:])]
    for j, (b, ssegs, verts) in enumerate(street_segs):
        if j not in keep and any(segs_cross(s1, s2, r1, r2) for s1, s2 in ssegs for r1, r2 in river_segs):
            keep[j] = 0.0
    return keep
AREA_NEAR_M = 40  # streets around a park or building

place_cards = []

# waterways: the source can split one waterway over several entries (the
# Schelde has three) - one card per name
water = {}
for w in base["waterways"]:
    entry = water.setdefault(w["name"], {"type": w["type"], "lines": [], "longest": 0})
    entry["lines"].extend(w["lines"])
    length = pp.lines_length_m(w["lines"])
    if length > entry["longest"]:  # typed by its longest piece, as in preprocess.py
        entry["type"], entry["longest"] = w["type"], length
for name, w in water.items():
    lines_m = [[to_m(p) for p in line] for line in w["lines"]]
    segs = [s for m in lines_m for s in zip(m, m[1:])]
    pts_ll = [p for line in w["lines"] for p in line]
    longest = max(w["lines"], key=len)
    # order the streets along the waterway: by position along its main axis
    a_m, b_m = to_m(pts_ll[0]), to_m(pts_ll[-1])
    ux, uy = b_m[0] - a_m[0], b_m[1] - a_m[1]
    # docks drawn along their water's edge can sit further from the quay
    # road than a bridge does: widen the search until something turns up
    if w["type"] == "river":
        found = river_front(lines_m)
    else:
        for radius in (WATER_NEAR_M, 50, 100):
            found = streets_near(segs, radius)
            if found:
                break

    def along(j, a_m=a_m, ux=ux, uy=uy):
        vx = sum(v[0] for v in street_segs[j][2]) / len(street_segs[j][2])
        vy = sum(v[1] for v in street_segs[j][2]) / len(street_segs[j][2])
        return (vx - a_m[0]) * ux + (vy - a_m[1]) * uy

    place_cards.append(
        place_record(
            name, "waterway", pts_ll, longest[len(longest) // 2],
            {"water_type": w["type"], "length_m": round(pp.lines_length_m(w["lines"]))},
            ordered_names(found, along),
        )
    )


def area_card(name, kind, ring_ll, facts):
    ring_m = [to_m(p) for p in ring_ll]
    segs = list(zip(ring_m, ring_m[1:] + ring_m[:1]))
    found = streets_near(segs, AREA_NEAR_M, inside_ring=ring_m)
    cx = sum(p[0] for p in ring_m) / len(ring_m)
    cy = sum(p[1] for p in ring_m) / len(ring_m)

    # streets around it, clockwise from north
    def angle(j):
        vs = street_segs[j][2]
        nearest = min(vs, key=lambda v: math.hypot(v[0] - cx, v[1] - cy))
        return math.atan2(nearest[0] - cx, nearest[1] - cy) % (2 * math.pi)

    rep = ring_centroid(ring_ll)
    return place_record(name, kind, ring_ll, rep, facts, ordered_names(found, angle))


for pk in base["parks"]:
    place_cards.append(
        area_card(pk["name"], "park", pk["ring"], {"park_type": pk["type"], "area_m2": round(pp.ring_area_m2(pk["ring"]))})
    )
for lm in base["landmarks"]:
    place_cards.append(
        area_card(lm["name"], "building", lm["ring"], {"is_church": lm["is_church"], "area_m2": round(pp.ring_area_m2(lm["ring"]))})
    )

no_near = [c["name"] for c in place_cards if not c["near"]]
cards.extend(place_cards)

# ------------------------------------------------------------------
# 6. Write output + QA summary
# ------------------------------------------------------------------

out_path = ROOT / "data" / "street-cards.json"
with open(out_path, "w") as f:
    json.dump(cards, f, ensure_ascii=False, indent=2)

# Also wrap as a plain global for <script src> loading, matching how
# map-data.js / curriculum-data.js are consumed (avoids fetch()/CORS
# friction when opened directly from disk). data/street-cards.json above
# remains the canonical fact-only deliverable this script produces.
gen_dir = ROOT / "data" / "generated"
gen_dir.mkdir(parents=True, exist_ok=True)
with open(gen_dir / "street-cards.js", "w") as f:
    f.write("// Generated by build/street_cards.py from data/street-cards.json - do not hand-edit.\n")
    f.write("const STREET_CARDS = ")
    f.write(json.dumps(cards, ensure_ascii=False, separators=(",", ":")))
    f.write(";\n")

print(f"wrote {out_path} ({len(cards)} cards)")
print(f"wrote {gen_dir / 'street-cards.js'}")
print(f"dead ends (empty crosses at an endpoint): {stats['dead_ends']}")
print(f"streets/squares with 0 intersections (check these): {stats['zero_intersections']}")
print(f"curved streets: {stats['curved']}")
print(f"name/history explanations found in curriculum data: {stats['name_explanations']}")
print(f"place cards: {len(place_cards)} (" + ", ".join(f"{k} {sum(1 for c in place_cards if c['kind'] == k)}" for k in ("waterway", "park", "building")) + f"); with no street nearby: {no_near or 'none'}")

import random

random.seed(7)
print("\n--- 10 random records for spot-check ---")
for r in random.sample(cards, 10):
    print(json.dumps(r, ensure_ascii=False)[:300])
