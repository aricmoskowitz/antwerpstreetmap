#!/usr/bin/env python3
"""
Computes each lesson's reading-order object numbering (Change Request 3,
Change 2) and writes it into antwerp-curriculum-data.json as a "number"
field on every object. Run after rebuild_curriculum.py and before
preprocess.py (preprocess.py copies the curriculum JSON into
curriculum-data.js verbatim, so the numbers must already be in the file):

    python3 build/number_lesson_objects.py

Reference point per object: reuses the exact same point preprocess.py
already computes for that object's map badge (MAP_DATA.objects[type][name]
.badge) - the midpoint of its longest line/segment for roads, squares and
waterways, or a pole-of-inaccessibility point-on-surface (not a centroid,
which can fall outside a concave shape) for buildings, parks and
neighborhoods. Reusing it, rather than recomputing a second reference point
independently, guarantees the numbered badge the app draws always sits
exactly on the point used to number it.

Grouping into rows and numbering 1..n is build/reading_order.py's job; this
script only resolves each object's badge point and writes the numbering
back. Badge points are in projected pixel space (y increases southward, x
increases eastward - see preprocess.py's project()), so north/south here
means smaller/larger y; reading_order() expects "higher = north", so y is
negated before grouping.
"""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"

spec = importlib.util.spec_from_file_location("preprocess", ROOT / "build" / "preprocess.py")
pp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp)

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reading_order import reading_order

norm = pp.norm

with open(SRC / "antwerp-curriculum-data.json") as f:
    curriculum = json.load(f)


def badge_point(obj):
    bucket = pp.objects.get(obj["type"])
    if bucket is None:
        raise ValueError(f"unknown object type {obj['type']!r} for {obj['name']!r}")
    entry = bucket[norm(obj["name"])]
    x, y = entry["badge"]
    return (x, -y)  # negate y: reading_order() expects "higher value = north"


# ------------------------------------------------------------------
# Number every lesson's objects
# ------------------------------------------------------------------

lesson_count = 0
object_count = 0
size_min, size_max = None, None

for sec in curriculum["sections"]:
    for mod in sec["modules"]:
        for lesson in mod["lessons"]:
            objs = lesson["objects"]
            points = [badge_point(o) for o in objs]
            numbers = reading_order(points)
            for o, num in zip(objs, numbers):
                o["number"] = num
            lesson_count += 1
            object_count += len(objs)
            n = len(objs)
            size_min = n if size_min is None else min(size_min, n)
            size_max = n if size_max is None else max(size_max, n)

with open(SRC / "antwerp-curriculum-data.json", "w") as f:
    json.dump(curriculum, f, ensure_ascii=False, indent=2)

print(f"numbered {object_count} objects across {lesson_count} lessons")
print(f"lesson sizes: min {size_min}, max {size_max}")
print(f"wrote {SRC / 'antwerp-curriculum-data.json'}")
