#!/usr/bin/env python3
"""
Generates data/street-cards.json: one fact-only record per road (including
squares) in the base map, for the Scroll feed (Change Request 2). Geometry
itself is NOT duplicated here - the app draws from the already-projected
paths in data/generated/map-data.js; this file only adds derived facts
(orientation, intersections, neighborhood, curriculum lessons) that aren't
cheap to recompute in the browser.

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
                if obj["type"] in ("road", "square"):
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

print(f"wrote {out_path} ({len(cards)} cards, expect 1230)")
print(f"wrote {gen_dir / 'street-cards.js'}")
print(f"dead ends (empty crosses at an endpoint): {stats['dead_ends']}")
print(f"streets/squares with 0 intersections (check these): {stats['zero_intersections']}")
print(f"curved streets: {stats['curved']}")
print(f"name/history explanations found in curriculum data: {stats['name_explanations']}")

import random

random.seed(7)
print("\n--- 10 random records for spot-check ---")
for r in random.sample(cards, 10):
    print(json.dumps(r, ensure_ascii=False)[:300])
