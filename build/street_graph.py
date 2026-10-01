#!/usr/bin/env python3
"""
Builds data/street-graph.json for the Walk game (Change Request 4): the
walkable street network as junction nodes + edge lengths, plus which roads
count as "being at" each endpoint object. Run after preprocess.py:

    python3 build/street_graph.py

Geometry is not duplicated. Each edge stores which subpath(s) of the
existing MAP_DATA.bgStreets path (one subpath per source line, in base-data
order) and which vertex range it covers; walk.js parses bgStreets once and
draws edges from it. Node coordinates are kept (projected, 0.1 px) because
routing needs them for the map fit and distractor distances.

Walkability: the base data carries no access/highway tags (streets only
have name, is_square, lines), so the rule is name-based - a road is excluded
if its name ends in "tunnel". "Contains tunnel" would also drop Tunnelplaats,
a walkable square. Both lists are printed for review.

Object -> road attachment:
  street:            the street itself
  square:            the square plus every road sharing a node with it
  building / park:   every walkable road within ATTACH_M of the footprint
                     (0 if the road enters it), else the single nearest road
Neighborhoods and waterways are not endpoints. Only roads in the largest
connected component are attached; objects left with none are orphans.

Anchors - where on those roads a walk actually starts or ends. The round's
rules are road-level (you're "at" B the moment you turn onto one of its
attached roads), but the distance and the drawn walk run to the object
itself, otherwise a building next to one end of a long boulevard would be
"reached" from the boulevard's far end. Streets anchor anywhere along
themselves and squares at their own junctions (both derivable from the
graph, so not stored); buildings and parks anchor at the two ends of each
attached road's edge that runs closest to the footprint (stored as "a").
"""
import importlib.util
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"

spec = importlib.util.spec_from_file_location("preprocess", ROOT / "build" / "preprocess.py")
pp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph_core import build_graph, components, haversine_m

ATTACH_M = 40.0
REVIEW_SECTION_ID = 8

base = pp.base
norm = pp.norm
streets = base["streets"]

with open(SRC / "antwerp-curriculum-data.json") as f:
    curriculum = json.load(f)


def is_walkable(name):
    return not name.strip().lower().endswith("tunnel")


all_names = sorted({s["name"] for s in streets})
excluded = [n for n in all_names if not is_walkable(n)]
kept_despite_match = [n for n in all_names if "tunnel" in n.lower() and is_walkable(n)]

# ------------------------------------------------------------------
# 1. Graph
# ------------------------------------------------------------------

g = build_graph(streets, is_walkable)
nodes_ll, edges = g["nodes"], g["edges"]

comps = components(len(nodes_ll), edges)
lcc = set(comps[0])

# global bgStreets subpath index for each (street, line), matching
# preprocess.py's line_path_d (lines with < 2 points are skipped there)
subpath_of = {}
k = 0
for si, s in enumerate(streets):
    for li, line in enumerate(s["lines"]):
        if len(line) >= 2:
            subpath_of[(si, li)] = k
            k += 1

road_names = sorted(g["roads"].keys(), key=lambda n: norm(n))
road_index = {n: i for i, n in enumerate(road_names)}
road_index_by_norm = {norm(n): i for n, i in road_index.items()}

nodes_px = [[round(c, 1) for c in pp.project(p)] for p in nodes_ll]

edges_out = []
road_nodes = [set() for _ in road_names]
for e in edges:
    flat = []
    for (lk, i0, i1) in e["parts"]:
        flat += [subpath_of[lk], i0, i1]
    edges_out.append([e["a"], e["b"], road_index[e["road"]], round(e["len"], 1), flat])
    road_nodes[road_index[e["road"]]].update((e["a"], e["b"]))

road_in_lcc = [bool(ns & lcc) for ns in road_nodes]

# sanity check: every edge's endpoints line up with the bgStreets geometry
bg_subpaths = [
    [tuple(float(v) for v in xy.split(",")) for xy in sp.strip().split(" L ")]
    for sp in pp.bg_streets_d.split("M ")
    if sp.strip()
]
for a, b, r, length, flat in edges_out:
    first = bg_subpaths[flat[0]][flat[1]]
    last = bg_subpaths[flat[-3]][flat[-1]]
    for node, pt in ((a, first), (b, last)):
        nx, ny = nodes_px[node]
        # nodes are clustered within 1.2 m (~0.2 px); allow a little slack
        assert abs(nx - pt[0]) < 0.5 and abs(ny - pt[1]) < 0.5, (road_names[r], node, pt)

# ------------------------------------------------------------------
# 2. Lessons per object (for the "lessons I've started" filter and for
#    picking plausible distractors from the same lesson)
# ------------------------------------------------------------------

lessons_of = {}
for sec in curriculum["sections"]:
    for mod in sec["modules"]:
        for lesson in mod["lessons"]:
            for o in lesson["objects"]:
                lessons_of.setdefault((norm(o["name"]), o["type"]), []).append(lesson["id"])


def geo_lessons(ids):
    # Section 8 review lessons are alphabetical chunks - sharing one says
    # nothing about two streets being near each other.
    return sorted({i for i in ids if not i.startswith(f"{REVIEW_SECTION_ID}.")})


# ------------------------------------------------------------------
# 3. Object -> road attachment
# ------------------------------------------------------------------

LAT0 = 51.2164
KX = math.cos(math.radians(LAT0)) * math.pi / 180 * pp.R_EARTH
KY = math.pi / 180 * pp.R_EARTH


def m(p):
    return (p[0] * KX, p[1] * KY)


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def segs_intersect(a, b, c, d):
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    return orient(a, b, c) * orient(a, b, d) < 0 and orient(c, d, a) * orient(c, d, b) < 0


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# every walkable segment, in metres, tagged with its road index
segments = []
for si, s in enumerate(streets):
    if not is_walkable(s["name"]):
        continue
    ri = road_index[s["name"]]
    if not road_in_lcc[ri]:
        continue
    for line in s["lines"]:
        pts = [m(p) for p in line]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            segments.append((ri, a, b, min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])))


def edge_metric_pts(e):
    pts = []
    for (si, li), i0, i1 in e["parts"]:
        line = streets[si]["lines"][li]
        stepdir = 1 if i1 >= i0 else -1
        seg = [line[i] for i in range(i0, i1 + stepdir, stepdir)]
        pts.extend(seg if not pts else seg[1:])
    return [m(p) for p in pts]


road_lcc_edges = [[] for _ in road_names]
for e in edges:
    if e["a"] in lcc:
        road_lcc_edges[road_index[e["road"]]].append(e)
_edge_pts_cache = {}


def footprint_roads(ring_ll):
    ring = [m(p) for p in ring_ll]
    edges_r = [(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]
    minx = min(p[0] for p in ring)
    maxx = max(p[0] for p in ring)
    miny = min(p[1] for p in ring)
    maxy = max(p[1] for p in ring)

    def dist_to_footprint(a, b):
        if point_in_ring(a, ring) or point_in_ring(b, ring):
            return 0.0
        best = float("inf")
        for c, d in edges_r:
            if segs_intersect(a, b, c, d):
                return 0.0
            best = min(best, seg_dist(a, c, d), seg_dist(b, c, d), seg_dist(c, a, b), seg_dist(d, a, b))
        return best

    def anchors_for(roads):
        out = []
        for ri in roads:
            def edge_dist(e):
                key = id(e)
                if key not in _edge_pts_cache:
                    _edge_pts_cache[key] = edge_metric_pts(e)
                pts = _edge_pts_cache[key]
                return min(dist_to_footprint(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

            best = min(road_lcc_edges[ri], key=edge_dist)
            out += [best["a"], ri, best["b"], ri]
        return out

    near = {}
    for ri, a, b, x0, y0, x1, y1 in segments:
        if x1 < minx - ATTACH_M or x0 > maxx + ATTACH_M or y1 < miny - ATTACH_M or y0 > maxy + ATTACH_M:
            continue
        dd = dist_to_footprint(a, b)
        if dd <= ATTACH_M:
            near[ri] = min(near.get(ri, dd), dd)
    if near:
        roads = sorted(near)
        return roads, False, anchors_for(roads)
    nearest = min(segments, key=lambda sg: dist_to_footprint(sg[1], sg[2]))
    return [nearest[0]], True, anchors_for([nearest[0]])


def badge_px(kind, name):
    return [round(c, 1) for c in pp.objects[kind][norm(name)]["badge"]]


objects_out = []
orphans = []
fallbacks = []
seen = set()


def add_object(name, kind, roads, anchors=None):
    key = (norm(name), kind)
    if key in seen:
        return
    seen.add(key)
    roads = sorted({r for r in roads if road_in_lcc[r]})
    if not roads:
        orphans.append(f"{name} ({kind})")
        return
    obj = {"n": name, "t": kind, "r": roads, "p": badge_px(kind, name), "l": lessons_of.get(key, [])}
    if anchors is not None:
        obj["a"] = anchors
    objects_out.append(obj)


for s in streets:
    if not is_walkable(s["name"]):
        continue
    ri = road_index[s["name"]]
    if s["is_square"]:
        meets = {
            rj for rj, ns in enumerate(road_nodes) if rj != ri and ns & road_nodes[ri]
        }
        add_object(s["name"], "square", {ri} | meets)
    else:
        add_object(s["name"], "road", {ri})

for l in base["landmarks"]:
    roads, fell_back, anchors = footprint_roads(l["ring"])
    if fell_back:
        fallbacks.append(f"{l['name']} (building)")
    add_object(l["name"], "building", roads, anchors)

for p in base["parks"]:
    roads, fell_back, anchors = footprint_roads(p["ring"])
    if fell_back:
        fallbacks.append(f"{p['name']} (park)")
    add_object(p["name"], "park", roads, anchors)

# ------------------------------------------------------------------
# 4. Write
# ------------------------------------------------------------------

roads_out = []
for i, name in enumerate(road_names):
    sq = g["roads"][name]
    ids = lessons_of.get((norm(name), "square" if sq else "road"), [])
    roads_out.append({"n": name, "sq": 1 if sq else 0, "l": geo_lessons(ids)})

M_PER_PX = (math.pi / 180 * pp.R_EARTH) / pp.SCALE  # y: 1 px = this many metres

graph = {
    "meta": {
        "generated_by": "build/street_graph.py",
        "m_per_px": round(M_PER_PX, 4),
        "edge_format": "[nodeA, nodeB, roadIndex, lengthMetres, [bgStreetsSubpath, fromVertex, toVertex, ...]]",
        "walkability_rule": "excluded if the road name ends in 'tunnel' (no access tags in the source data)",
        "excluded_roads": excluded,
        "attach_metres": ATTACH_M,
        "anchor_format": "buildings/parks only: [node, road, node, road, ...]; streets anchor on all their nodes, squares on the square's own nodes",
    },
    "roads": roads_out,
    "nodes": nodes_px,
    "edges": edges_out,
    "objects": objects_out,
}

out_json = ROOT / "data" / "street-graph.json"
with open(out_json, "w") as f:
    json.dump(graph, f, ensure_ascii=False, separators=(",", ":"))
gen = ROOT / "data" / "generated" / "street-graph.js"
with open(gen, "w") as f:
    f.write("// Generated by build/street_graph.py from data/street-graph.json - do not hand-edit.\n")
    f.write("const STREET_GRAPH = ")
    f.write(json.dumps(graph, ensure_ascii=False, separators=(",", ":")))
    f.write(";\n")

# ------------------------------------------------------------------
# 5. Report
# ------------------------------------------------------------------

print("\n=== Walk graph ===")
print(f"walkability rule: name ends in 'tunnel' (no access/highway tags in the data)")
print(f"excluded ({len(excluded)}): {', '.join(excluded)}")
print(f"kept although the name contains 'tunnel': {', '.join(kept_despite_match) or '-'}")
print(f"nodes {len(nodes_px)}, edges {len(edges_out)}, roads {len(road_names)}")
sizes = [len(c) for c in comps]
print(f"components: {len(comps)}; largest {sizes[0]} nodes ({sizes[0] / len(nodes_px):.1%}); "
      f"next sizes {sizes[1:12]}")
outside = [road_names[i] for i in range(len(road_names)) if not road_in_lcc[i]]
print(f"roads entirely outside the largest component ({len(outside)}): {', '.join(outside)}")
by_type = ", ".join(
    "%s %d" % (t, sum(1 for o in objects_out if o["t"] == t)) for t in ("road", "square", "building", "park")
)
print(f"endpoint objects kept: {len(objects_out)} ({by_type})")
print(f"orphans ({len(orphans)}): {', '.join(orphans) or '-'}")
print(f"footprints with no road within {ATTACH_M:.0f} m (attached to nearest instead) ({len(fallbacks)}): "
      f"{', '.join(fallbacks) or '-'}")
print(f"wrote {out_json} ({out_json.stat().st_size / 1024:.0f} KB) and {gen.name}")
