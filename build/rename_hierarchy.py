#!/usr/bin/env python3
"""
One-time structural rename for Change Request 3: super_section -> section,
section -> module, module -> lesson. The numbers (e.g. "4.2.1") don't
change - only what each level is called.

This builds a brand-new object graph by explicit old-key -> new-key access
(not a sequential string find-and-replace, which would double-convert:
section -> module -> lesson if run as three passes in order). Run once:

    python3 build/rename_hierarchy.py

After this, antwerp-curriculum-data.json uses the new names, and
build/rebuild_curriculum.py / build/street_cards.py / build/preprocess.py
all read and write the new schema going forward.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"
PATH = SRC / "antwerp-curriculum-data.json"

with open(PATH) as f:
    old = json.load(f)

if "sections" in old and "super_sections" not in old:
    print("already renamed - nothing to do")
    raise SystemExit(0)


def rename_lesson(old_mod):
    # "module" (finest grain) -> "lesson"; id/title/objects are unchanged
    return {"id": old_mod["id"], "title": old_mod["title"], "objects": old_mod["objects"]}


def rename_module(old_sec):
    # "section" (middle grain) -> "module"
    return {
        "id": old_sec["id"],
        "title": old_sec["title"],
        "lessons": [rename_lesson(m) for m in old_sec["modules"]],
    }


def rename_section(old_ss):
    # "super_section" (top grain) -> "section"
    return {
        "id": old_ss["id"],
        "title": old_ss["title"],
        "modules": [rename_module(s) for s in old_ss["sections"]],
    }


new_meta = dict(old["meta"])
new_meta["numbering"] = "section.module.lesson"

new = {
    "meta": new_meta,
    "sections": [rename_section(ss) for ss in old["super_sections"]],
}

with open(PATH, "w") as f:
    json.dump(new, f, ensure_ascii=False, indent=2)

n_sections = len(new["sections"])
n_modules = sum(len(s["modules"]) for s in new["sections"])
n_lessons = sum(len(m["lessons"]) for s in new["sections"] for m in s["modules"])
print(f"renamed: {n_sections} sections, {n_modules} modules, {n_lessons} lessons")
print(f"wrote {PATH}")
