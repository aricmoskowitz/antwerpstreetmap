#!/usr/bin/env python3
"""
Regenerates data/source/antwerp-curriculum-data.json (and the human-readable
.md alongside it) to satisfy Change Request 1's coverage requirement: every
object in the base map appears in at least one module, and - since Super
Section 8 already reviews every category completely - every object that
gains a new geographic/topical appearance here also gets a second guaranteed
appearance in an expanded Super Section 8.

This is additive, not a redesign: the existing 8 super sections, their
regions, and their neighborhood groupings are all kept exactly as they are.
Two kinds of module get added on top:

  1. Per-section "Other Streets" module(s) - the ordinary roads (not already
     a Foundations-curated longest/kaai/lei street) whose representative
     point falls inside that section's neighborhood(s), via point-in-polygon
     against the closed neighborhood polygons this project already
     reconstructs in build/preprocess.py.
  2. Expanded Super Section 8 road review (8.5.3+) - every ordinary road,
     chunked alphabetically, so the "appears at least twice" guarantee holds
     for the roughly 1,000 streets this newly covers.

Re-run after preprocess.py's neighborhood-polygon logic changes, or if the
source data changes. This script imports preprocess.py directly (running it
in full) to reuse its projection, base data, and neighborhood polygons
rather than re-deriving any of that.
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

MIN_OBJECTS = 5
MAX_OBJECTS = 50

# ------------------------------------------------------------------
# 1. Which roads are already covered anywhere in the curriculum?
# ------------------------------------------------------------------

covered_roads = set()
for ss in curriculum["super_sections"]:
    for sec in ss["sections"]:
        for mod in sec["modules"]:
            for obj in mod["objects"]:
                if obj["type"] == "road":
                    covered_roads.add(norm(obj["name"]))

all_roads = [s for s in base["streets"] if not s["is_square"]]
ordinary_roads = [s for s in all_roads if norm(s["name"]) not in covered_roads]

print(f"roads total: {len(all_roads)}, already covered: {len(covered_roads)}, ordinary (uncovered): {len(ordinary_roads)}")

# ------------------------------------------------------------------
# 2. Point-in-polygon assignment of each ordinary road to a neighborhood
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


def road_representative_point(road):
    xs = []
    ys = []
    for line in road["lines"]:
        for lon, lat in line:
            xs.append(lon)
            ys.append(lat)
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def ring_centroid(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


neighborhood_names = [n["name"] for n in base["neighborhoods"]]
neighborhood_rings = {norm(n): pp.neighborhood_lonlat_rings[norm(n)] for n in neighborhood_names}
neighborhood_centroid = {key: ring_centroid(rings[0]) for key, rings in neighborhood_rings.items()}


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def assign_neighborhood(pt):
    for key, rings in neighborhood_rings.items():
        if point_in_rings(pt, rings):
            return key
    # fallback: nearest neighborhood centroid (roads right on the ring edge
    # or in a reconstruction seam)
    return min(neighborhood_centroid.keys(), key=lambda k: dist(pt, neighborhood_centroid[k]))


# ------------------------------------------------------------------
# 3. Map each region section (super sections 2-7) to its member
#    neighborhoods, by parsing the existing " + "-joined section titles -
#    and redirect the handful of "orphan" neighborhoods (ones the original
#    curriculum excluded from every section because they had zero tracked
#    landmarks/squares/parks/waterways/notable roads) to whichever section
#    their nearest real neighbor belongs to, so their ordinary streets still
#    get a geographic home instead of only ever showing up in review.
# ------------------------------------------------------------------

REGION_SS_IDS = [2, 3, 4, 5, 6, 7]


def section_member_neighborhoods(section_title):
    parts = [p.strip() for p in section_title.split(" + ")]
    keys = []
    for p in parts:
        k = norm(p)
        if k in neighborhood_rings:
            keys.append(k)
        else:
            print(f"  WARNING: could not match neighborhood name from section title part: {p!r}")
    return keys


referenced_keys = set()
for ss in curriculum["super_sections"]:
    if ss["id"] not in REGION_SS_IDS:
        continue
    for sec in ss["sections"]:
        referenced_keys.update(section_member_neighborhoods(sec["title"]))

orphan_keys = set(neighborhood_rings.keys()) - referenced_keys
redirect = {}
for ok in orphan_keys:
    nearest = min(
        referenced_keys, key=lambda k: dist(neighborhood_centroid[ok], neighborhood_centroid[k])
    )
    redirect[ok] = nearest
print(f"redirecting {len(orphan_keys)} orphan neighborhoods (no home section) to their nearest neighbor's section")

road_to_neighborhood = {}
for road in ordinary_roads:
    pt = road_representative_point(road)
    nb = assign_neighborhood(pt)
    road_to_neighborhood[norm(road["name"])] = redirect.get(nb, nb)

# sanity: distribution check
from collections import Counter

dist_counts = Counter(road_to_neighborhood.values())
print(f"assigned across {len(dist_counts)} neighborhoods (post-redirect); min {min(dist_counts.values())}, max {max(dist_counts.values())}")


def chunk(lst, size):
    return [lst[i : i + size] for i in range(0, len(lst), size)]


def road_obj(road):
    return {"name": road["name"], "type": "road", "length_m": pp.lines_length_m(road["lines"])}


roads_by_norm_name = {norm(r["name"]): r for r in ordinary_roads}

new_module_count = 0

for ss in curriculum["super_sections"]:
    if ss["id"] not in REGION_SS_IDS:
        continue
    sections = ss["sections"]
    carry = []  # leftover road-name-keys from undersized sections, deferred forward
    last_section_with_module = None

    for sec in sections:
        member_keys = section_member_neighborhoods(sec["title"])
        pool_keys = sorted(
            [k for k, nb in road_to_neighborhood.items() if nb in member_keys]
        )
        pool_keys = carry + pool_keys
        if len(pool_keys) < MIN_OBJECTS:
            carry = pool_keys
            continue
        carry = []
        roads_sorted = sorted(
            (roads_by_norm_name[k] for k in pool_keys), key=lambda r: -pp.lines_length_m(r["lines"])
        )
        chunks = chunk(roads_sorted, MAX_OBJECTS)
        next_mod_num = max((int(m["id"].split(".")[-1]) for m in sec["modules"]), default=0) + 1
        for i, ch in enumerate(chunks):
            title = "Other Streets" if len(chunks) == 1 else f"Other Streets, Part {i + 1} of {len(chunks)}"
            sec["modules"].append(
                {
                    "id": f"{sec['id']}.{next_mod_num}",
                    "title": title,
                    "objects": [road_obj(r) for r in ch],
                }
            )
            next_mod_num += 1
            new_module_count += 1
        last_section_with_module = sec

    if carry and last_section_with_module is not None:
        # fold any final undersized remainder into the last module we just
        # added for this region, splitting further only if that overflows
        roads_sorted = sorted((roads_by_norm_name[k] for k in carry), key=lambda r: -pp.lines_length_m(r["lines"]))
        last_mod = last_section_with_module["modules"][-1]
        combined_names = {norm(o["name"]) for o in last_mod["objects"]}
        for r in roads_sorted:
            if norm(r["name"]) not in combined_names:
                last_mod["objects"].append(road_obj(r))
        if len(last_mod["objects"]) > MAX_OBJECTS:
            overflow = last_mod["objects"][MAX_OBJECTS:]
            last_mod["objects"] = last_mod["objects"][:MAX_OBJECTS]
            next_mod_num = max(int(m["id"].split(".")[-1]) for m in last_section_with_module["modules"]) + 1
            last_section_with_module["modules"].append(
                {
                    "id": f"{last_section_with_module['id']}.{next_mod_num}",
                    "title": "Other Streets (cont.)",
                    "objects": overflow,
                }
            )
            new_module_count += 1

print(f"added {new_module_count} 'Other Streets' modules across regions")

# ------------------------------------------------------------------
# 4. Expand Super Section 8's road review with every ordinary road
# ------------------------------------------------------------------

ss8 = next(s for s in curriculum["super_sections"] if s["id"] == 8)
sec85 = next(s for s in ss8["sections"] if s["id"] == "8.5")
sec85["title"] = "All Roads"  # was "All Notable Roads" - now covers every road, not just the curated set

all_ordinary_sorted = sorted(ordinary_roads, key=lambda r: norm(r["name"]))
review_chunks = chunk(all_ordinary_sorted, MAX_OBJECTS)
next_mod_num = max(int(m["id"].split(".")[-1]) for m in sec85["modules"]) + 1
for ch in review_chunks:
    # first character of the same sort key used above, so the label always
    # matches the actual alphabetical order of the chunk
    first_letter = norm(ch[0]["name"])[0]
    last_letter = norm(ch[-1]["name"])[0]
    label = first_letter if first_letter == last_letter else f"{first_letter}–{last_letter}"
    sec85["modules"].append(
        {
            "id": f"8.5.{next_mod_num}",
            "title": f"Other Streets ({label}) ({len(ch)})",
            "objects": [road_obj(r) for r in ch],
        }
    )
    next_mod_num += 1

print(f"added {len(review_chunks)} review modules to Super Section 8.5 covering {len(all_ordinary_sorted)} roads")

# ------------------------------------------------------------------
# 5. Safety net: split any non-review module that exceeds the new 50-cap.
#    (1.5.1 "Neighborhoods With Tracked Objects", pre-dating this script,
#    has 87 - the new bound applies to it too even though this script
#    didn't create it.)
# ------------------------------------------------------------------

split_count = 0
for ss in curriculum["super_sections"]:
    if ss["id"] == 8:
        continue
    for sec in ss["sections"]:
        new_modules = []
        for mod in sec["modules"]:
            if len(mod["objects"]) <= MAX_OBJECTS:
                new_modules.append(mod)
                continue
            chunks = chunk(mod["objects"], MAX_OBJECTS)
            base_id = mod["id"]
            for i, ch in enumerate(chunks):
                new_modules.append(
                    {
                        "id": base_id if i == 0 else f"{base_id}-{i + 1}",
                        "title": mod["title"] if len(chunks) == 1 else f"{mod['title']}, Part {i + 1} of {len(chunks)}",
                        "objects": ch,
                    }
                )
            split_count += 1
        sec["modules"] = new_modules

print(f"split {split_count} oversized non-review module(s) to respect the 50-object cap")

# ------------------------------------------------------------------
# 6. Update meta and write out
# ------------------------------------------------------------------

curriculum["meta"]["note"] = (
    curriculum["meta"].get("note", "")
    + " Every road (including squares), waterway, park, building, and neighborhood in the base map "
    "appears in at least one module; most appear in at least two (a geographic/topical module plus "
    "Super Section 8's complete review)."
)

with open(SRC / "antwerp-curriculum-data.json", "w") as f:
    json.dump(curriculum, f, ensure_ascii=False, indent=2)

print("wrote", SRC / "antwerp-curriculum-data.json")

# ------------------------------------------------------------------
# 7. Regenerate the human-readable markdown alongside it
# ------------------------------------------------------------------


def fmt_obj(o):
    extra = ""
    if o["type"] == "road" and "length_m" in o:
        extra = f" — {o['length_m'] / 1000:.2f} km"
    elif "area_m2" in o:
        extra = f" — {o['area_m2']:,} m²"
    return f"- {o['name']} ({o['type']}){extra}"


md_lines = [
    "# Antwerp Inside the Ring — Learning Curriculum\n",
    "*A curriculum for learning the streets, squares, waterways, buildings, parks, and "
    "neighborhoods of Antwerp's historic core, built from the reference map. Numbering follows "
    "Super Section.Section.Module (e.g. 4.2.1). An object may appear in more than one module — "
    "a long boulevard, for instance, belongs both to the city-wide roads module and to every "
    "neighborhood it passes through; the goal, since Super Section 8 reviews every category "
    "completely, is that every object appears at least twice (once geographically/topically, "
    "once in review). Super Section 1 uses curated, filtered lists to keep the foundations "
    "manageable; Super Section 8 holds the complete, unfiltered lists of every category, "
    "including every ordinary street not already covered by a Foundations or neighborhood "
    "module.*\n",
    "*This document is generated from `antwerp-curriculum-data.json` by "
    "`build/rebuild_curriculum.py` — edit the JSON (or the generator), not this file directly.*\n",
    "---\n",
]
for ss in curriculum["super_sections"]:
    md_lines.append(f"## Super Section {ss['id']} — {ss['title']}\n")
    for sec in ss["sections"]:
        md_lines.append(f"### {sec['id']} {sec['title']}\n")
        for mod in sec["modules"]:
            md_lines.append(f"#### {mod['id']} {mod['title']} ({len(mod['objects'])})\n")
            for o in mod["objects"]:
                md_lines.append(fmt_obj(o))
            md_lines.append("")
    md_lines.append("---\n")

with open(SRC / "antwerp-curriculum.md", "w") as f:
    f.write("\n".join(md_lines))

print("wrote", SRC / "antwerp-curriculum.md")
