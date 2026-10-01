"""
Pure street-graph construction (Change Request 4), with no file I/O and no
dependency on preprocess.py, so build/test_street_graph.py can exercise it
on a synthetic grid. build/street_graph.py is the driver that feeds it the
real base map and writes data/street-graph.json.

Input: a list of streets, each {"name", "is_square", "lines"} with lines as
lists of [lon, lat] - the same shape as antwerp-inside-the-ring-data.json.

Nodes are locations where the walk can branch:
  - a vertex shared by two or more lines (different roads meeting, or one
    road forking/crossing itself - e.g. a dual carriageway splitting), or
  - a line endpoint.
Vertices from different lines closer than TOL_M are the same location (the
source data is noded: real junctions share coordinates to within
centimetres). Vertices of the same line are never merged - otherwise a
densely digitized line (a roundabout, vertices < 1 m apart) chains
transitively into one giant node. A bridge or tunnel that crosses a street
without sharing a vertex is NOT a junction.

Then degree-2 nodes where the same road simply continues from one line into
the next are contracted away, so what remains is junctions between
different roads, same-road forks, and dead ends - the graph only branches
where a walker could actually choose a direction.

Each edge records which source line(s) and vertex range(s) it covers
("parts"), so the app can draw it from geometry it already has instead of
the graph duplicating coordinates.
"""
import math

R_EARTH = 6371000.0
TOL_M = 0.25
GRID_DEG = 0.00001  # ~1.1 m (> TOL_M, so a 3x3 cell check is enough)


def haversine_m(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(x))


class _UnionFind:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def build_graph(streets, is_walkable):
    """Returns {"nodes": [[lon, lat]], "edges": [{"a","b","road","len","parts"}],
    "roads": {name: is_square}}. parts are (line_key, i0, i1) in a->b order,
    where line_key = (street_index, line_index); i0 > i1 means reversed."""

    # 1. every vertex of every walkable line
    verts = []  # (lon, lat, line_key, idx)
    line_pts = {}
    for si, s in enumerate(streets):
        if not is_walkable(s["name"]):
            continue
        for li, line in enumerate(s["lines"]):
            if len(line) < 2:
                continue
            line_pts[(si, li)] = line
            for vi, p in enumerate(line):
                verts.append((p[0], p[1], (si, li), vi))

    # 2. cluster vertices within TOL_M into locations
    uf = _UnionFind(len(verts))
    grid = {}
    for k, (lon, lat, _, _) in enumerate(verts):
        grid.setdefault((round(lon / GRID_DEG), round(lat / GRID_DEG)), []).append(k)
    for (cx, cy), members in grid.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((cx + dx, cy + dy), ()):
                    for i in members:
                        if i < j and verts[i][2] != verts[j][2] and haversine_m(verts[i][:2], verts[j][:2]) <= TOL_M:
                            uf.union(i, j)

    loc_of = {}  # (line_key, vi) -> location root
    loc_lines = {}  # root -> set of line keys
    loc_roads = {}  # root -> set of road names
    for k, (lon, lat, lk, vi) in enumerate(verts):
        r = uf.find(k)
        loc_of[(lk, vi)] = r
        loc_lines.setdefault(r, set()).add(lk)
        loc_roads.setdefault(r, set()).add(streets[lk[0]]["name"])

    # 3. which locations are nodes
    is_node = set()
    for lk, line in line_pts.items():
        is_node.add(loc_of[(lk, 0)])
        is_node.add(loc_of[(lk, len(line) - 1)])
    for r, lines in loc_lines.items():
        if len(lines) >= 2:
            is_node.add(r)

    # 4. split every line at node locations into raw edges
    raw = []  # {"a","b","road","len","parts"}
    for lk, line in line_pts.items():
        name = streets[lk[0]]["name"]
        start = 0
        length = 0.0
        for vi in range(1, len(line)):
            length += haversine_m(line[vi - 1], line[vi])
            if loc_of[(lk, vi)] in is_node:
                a, b = loc_of[(lk, start)], loc_of[(lk, vi)]
                if a != b or length > TOL_M:
                    raw.append({"a": a, "b": b, "road": name, "len": length, "parts": [(lk, start, vi)]})
                start = vi
                length = 0.0

    # 5. contract same-road pass-through nodes (degree 2, both edges the
    #    same road, no other road at that location)
    incident = {}
    for ei, e in enumerate(raw):
        incident.setdefault(e["a"], []).append(ei)
        incident.setdefault(e["b"], []).append(ei)
    alive = [True] * len(raw)

    def reversed_parts(parts):
        return [(lk, i1, i0) for (lk, i0, i1) in reversed(parts)]

    for loc in list(incident.keys()):
        eis = [ei for ei in incident[loc] if alive[ei]]
        if len(eis) != 2 or eis[0] == eis[1] or len(loc_roads[loc]) != 1:
            continue
        e1, e2 = raw[eis[0]], raw[eis[1]]
        if e1["road"] != e2["road"] or e1["a"] == e1["b"] or e2["a"] == e2["b"]:
            continue
        # orient e1 to end at loc, e2 to start at loc
        p1 = e1["parts"] if e1["b"] == loc else reversed_parts(e1["parts"])
        a1 = e1["a"] if e1["b"] == loc else e1["b"]
        p2 = e2["parts"] if e2["a"] == loc else reversed_parts(e2["parts"])
        b2 = e2["b"] if e2["a"] == loc else e2["a"]
        if a1 == loc or b2 == loc:
            continue
        merged = {"a": a1, "b": b2, "road": e1["road"], "len": e1["len"] + e2["len"], "parts": p1 + p2}
        alive[eis[0]] = alive[eis[1]] = False
        raw.append(merged)
        alive.append(True)
        new_i = len(raw) - 1
        for end in (a1, b2):
            incident[end] = [new_i if x in eis else x for x in incident[end]]
        incident[loc] = []

    edges = [e for ei, e in enumerate(raw) if alive[ei]]

    # 6. renumber the surviving node locations 0..n-1
    used = sorted({e["a"] for e in edges} | {e["b"] for e in edges})
    index = {loc: i for i, loc in enumerate(used)}
    rep = {}
    for k, (lon, lat, lk, vi) in enumerate(verts):
        r = uf.find(k)
        if r in index and r not in rep:
            rep[r] = [lon, lat]
    nodes = [rep[loc] for loc in used]
    for e in edges:
        e["a"] = index[e["a"]]
        e["b"] = index[e["b"]]

    roads = {}
    for s in streets:
        if is_walkable(s["name"]):
            roads[s["name"]] = roads.get(s["name"], False) or bool(s["is_square"])
    return {"nodes": nodes, "edges": edges, "roads": roads}


def components(n_nodes, edges):
    """Connected components as a list of node-index lists, largest first."""
    uf = _UnionFind(n_nodes)
    for e in edges:
        uf.union(e["a"], e["b"])
    groups = {}
    for i in range(n_nodes):
        groups.setdefault(uf.find(i), []).append(i)
    return sorted(groups.values(), key=len, reverse=True)
