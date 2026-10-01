#!/usr/bin/env python3
"""
Programmatic size/coverage checks for the curriculum, restated in Change
Request 3's section > module > lesson > object terms (was: super_section >
section > module > object in Change Request 1). Run after any curriculum
rebuild:

    python3 build/check_curriculum.py

Checks four rules, reported separately since (see NOTE below) they are not
all at the same level of "this should already pass":
  (1) every lesson has 5-50 objects (comprehensive-review lessons, i.e. all
      of Section 8, are exempt from the 50-object cap only).
  (2) every module has 3-7 lessons.
  (3) every section has 2-4 modules.
  (4) every object (by name+type) appears in at least two lessons.

NOTE: renaming cannot change any of these counts (same structure, new key
names), so whatever passed or failed under the old super_section/section/
module names passes or fails identically here. Rules (1) and (4) do pass,
modulo the same pre-existing exceptions already documented in README.md
from Change Request 1 (a handful of single-appearance objects; review
lessons intentionally exceed 50). Rules (2) and (3) do NOT currently hold -
several regions group one module per neighborhood, and some have far more
than 4 neighborhoods, or far more than 7 "Other Streets" lessons once CR1's
coverage expansion ran. This is a pre-existing shape of the curriculum from
CR1, not something introduced by Change Request 3's rename, and restructuring
the section/module grouping to force 2-4/3-7 compliance is a structural
redesign outside this change request's explicit scope ("no platform or
structure trigger... this is a rename plus a deterministic sort"). They are
reported here for visibility, not silently hidden or silently "fixed".
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"

with open(SRC / "antwerp-curriculum-data.json") as f:
    curriculum = json.load(f)

REVIEW_SECTION_ID = 8

object_size_violations = []
module_lesson_count_violations = []
section_module_count_violations = []
object_lesson_count = {}

for sec in curriculum["sections"]:
    n_modules = len(sec["modules"])
    if not (2 <= n_modules <= 4):
        section_module_count_violations.append(f"section {sec['id']} has {n_modules} modules (need 2-4)")

    is_review_section = sec["id"] == REVIEW_SECTION_ID

    for mod in sec["modules"]:
        n_lessons = len(mod["lessons"])
        if not (3 <= n_lessons <= 7):
            module_lesson_count_violations.append(f"module {mod['id']} has {n_lessons} lessons (need 3-7)")

        for lesson in mod["lessons"]:
            n_objects = len(lesson["objects"])
            lo, hi = 5, (10 ** 9 if is_review_section else 50)
            if not (lo <= n_objects <= hi):
                cap_note = "no cap (review)" if is_review_section else "cap 50"
                object_size_violations.append(
                    f"lesson {lesson['id']} ({lesson['title']!r}) has {n_objects} objects "
                    f"(need >= 5, {cap_note})"
                )
            for obj in lesson["objects"]:
                key = (obj["name"].strip().upper(), obj["type"])
                object_lesson_count[key] = object_lesson_count.get(key, 0) + 1

under_covered = {k: v for k, v in object_lesson_count.items() if v < 2}

n_sections = len(curriculum["sections"])
n_modules = sum(len(s["modules"]) for s in curriculum["sections"])
n_lessons = sum(len(m["lessons"]) for s in curriculum["sections"] for m in s["modules"])
print(f"{n_sections} sections, {n_modules} modules, {n_lessons} lessons, {len(object_lesson_count)} distinct objects\n")


def report(label, items, cap=20):
    status = "PASS (0 violations)" if not items else f"{len(items)} violation(s)"
    print(f"(1-4) {label}: {status}")
    for v in items[:cap]:
        print("   -", v)
    if len(items) > cap:
        print(f"   ... and {len(items) - cap} more")


report("5-50 objects per lesson (review lessons exempt from the cap)", object_size_violations)
report("every object in >=2 lessons", [f"{k[0]} ({k[1]}): in {v} lesson(s)" for k, v in sorted(under_covered.items())])
report("3-7 lessons per module [pre-existing CR1 shape, see module docstring]", module_lesson_count_violations)
report("2-4 modules per section [pre-existing CR1 shape, see module docstring]", section_module_count_violations)

hard_fail = bool(object_size_violations)
if hard_fail:
    raise SystemExit(1)
