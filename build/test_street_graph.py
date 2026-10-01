#!/usr/bin/env python3
"""
Unit test for build/graph_core.py (Change Request 4) on a synthetic grid:

    python3 build/test_street_graph.py

    lat
  .002  H2 +---+---+
           |   |   |
  .0015    | -bridge- |        (crosses V1 without sharing a vertex)
  .001  H1 +---+---+---spur---o   (spur = 2 lines, same road, one edge)
           |   |   |
  .000  H0 +---+---+
          V0  V1  V2
         lon .000 .001 .002  .003 .004
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph_core import build_graph, components, haversine_m

LON0, LAT0 = 4.40, 51.20
D = 0.001


def P(i, j):
    """grid point i steps east, j steps north"""
    return [LON0 + i * D, LAT0 + j * D]


def street(name, *lines, square=False):
    return {"name": name, "is_square": square, "lines": [list(l) for l in lines]}


JITTER = 0.0000014  # ~0.1 m east: must still count as the same junction

streets = [
    street("H0", [P(0, 0), P(1, 0), P(2, 0)]),
    street("H1", [P(0, 1), P(1, 1), P(2, 1)]),
    street("H2", [P(0, 2), P(1, 2), P(2, 2)]),
    street("V0", [P(0, 0), P(0, 1), P(0, 2)]),
    street("V1", [P(1, 0), P(1, 1), P(1, 2)]),
    street("V2", [P(2, 0), [P(2, 1)[0] + JITTER, P(2, 1)[1]], P(2, 2)]),
    # same road drawn as two lines meeting at (3,1): should contract to one edge
    street("Spur", [P(2, 1), P(3, 1)], [P(3, 1), P(4, 1)]),
    # crosses V1 at lat .0015 but has no vertex there: not a junction
    street("Bridge", [[LON0 + 0.5 * D, LAT0 + 1.5 * D], [LON0 + 1.5 * D, LAT0 + 1.5 * D]]),
    # excluded by the walkability rule, despite sharing grid vertices
    street("Testtunnel", [P(0, 0), P(2, 2)]),
]


def walkable(name):
    return not name.lower().endswith("tunnel")


def test_grid():
    g = build_graph(streets, walkable)
    nodes, edges = g["nodes"], g["edges"]

    assert "Testtunnel" not in g["roads"], "tunnel should be excluded"
    assert not any(e["road"] == "Testtunnel" for e in edges)

    # 9 grid junctions + spur dead end + 2 bridge dead ends
    assert len(nodes) == 12, f"expected 12 nodes, got {len(nodes)}"
    # 6 streets x 2 blocks + 1 spur + 1 bridge
    assert len(edges) == 14, f"expected 14 edges, got {len(edges)}"

    spur = [e for e in edges if e["road"] == "Spur"]
    assert len(spur) == 1, f"spur should contract to one edge, got {len(spur)}"
    assert len(spur[0]["parts"]) == 2, "contracted spur keeps both source lines as parts"
    expected = haversine_m(P(2, 1), P(4, 1))
    assert abs(spur[0]["len"] - expected) < 0.5, (spur[0]["len"], expected)

    comps = components(len(nodes), edges)
    assert [len(c) for c in comps] == [10, 2], [len(c) for c in comps]

    # the bridge is its own component: it never joined V1
    bridge = next(e for e in edges if e["road"] == "Bridge")
    assert bridge["a"] in comps[1] and bridge["b"] in comps[1]

    # the jittered V2 vertex merged with H1's, so V2 and H1 meet
    h1_nodes = {n for e in edges if e["road"] == "H1" for n in (e["a"], e["b"])}
    v2_nodes = {n for e in edges if e["road"] == "V2" for n in (e["a"], e["b"])}
    assert h1_nodes & v2_nodes, "jittered junction should still connect H1 and V2"

    # block lengths: ~69.7 m east-west, ~111.2 m north-south at this latitude
    h = next(e for e in edges if e["road"] == "H0")
    v = next(e for e in edges if e["road"] == "V0")
    assert 69 < h["len"] < 71 and 110 < v["len"] < 112, (h["len"], v["len"])
    print("PASS: synthetic grid -> 12 nodes, 14 edges, components [10, 2]")


def test_dense_line_does_not_collapse():
    # a roundabout-like line with vertices 0.5 m apart, two spokes touching
    # different vertices of it: the ring must not chain into one node
    step = 0.000007  # ~0.5 m east
    ring = [[LON0 + k * step, LAT0] for k in range(41)]  # ~20 m long
    spoke1 = [[LON0, LAT0 + D], ring[0]]
    spoke2 = [[LON0 + 40 * step, LAT0 + D], ring[40]]
    g = build_graph(
        [street("Ring", ring), street("S1", spoke1), street("S2", spoke2)], walkable
    )
    # nodes: ring ends (= spoke ends) x2, spoke far ends x2
    assert len(g["nodes"]) == 4, f"dense line collapsed: {len(g['nodes'])} nodes"
    ring_edge = next(e for e in g["edges"] if e["road"] == "Ring")
    assert ring_edge["a"] != ring_edge["b"] and 19 < ring_edge["len"] < 21, ring_edge["len"]
    print("PASS: densely digitized line keeps its ends as separate nodes")


if __name__ == "__main__":
    test_grid()
    test_dense_line_does_not_collapse()
    print("All street-graph tests passed.")
