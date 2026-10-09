"""
Writes data/source/antwerp-curriculum.md, the human-readable view of
antwerp-curriculum-data.json. Called by number_lesson_objects.py after it
assigns each object's reading-order number, so the markdown always matches
the JSON (it used to be written one step earlier and lagged a run behind).
"""


def fmt_obj(o):
    extra = ""
    if o["type"] == "road" and "length_m" in o:
        extra = f" — {o['length_m'] / 1000:.2f} km"
    elif "area_m2" in o:
        extra = f" — {o['area_m2']:,} m²"
    num = f"{o['number']}. " if "number" in o else ""
    return f"- {num}{o['name']} ({o['type']}){extra}"


def write_markdown(curriculum, path):
    lines = [
        "# Antwerp Inside the Ring — Learning Curriculum\n",
        "*A curriculum for learning the streets, squares, waterways, buildings, parks, and "
        "neighborhoods of Antwerp's historic core, built from the reference map. Numbering follows "
        "Section.Module.Lesson (e.g. 4.2.1). An object may appear in more than one lesson — "
        "a long boulevard, for instance, belongs both to the city-wide roads lesson and to every "
        "neighborhood it passes through; the goal, since Section 8 reviews every category "
        "completely, is that every object appears at least twice (once geographically/topically, "
        "once in review). Section 1 uses curated, filtered lists to keep the foundations "
        "manageable; Section 8 holds the complete, unfiltered lists of every category, "
        "including every ordinary street not already covered by a Foundations or neighborhood "
        "lesson. Within each lesson, objects are numbered in reading order (north to south, "
        "west to east within each row) - see build/number_lesson_objects.py.*\n",
        "*This document is generated from `antwerp-curriculum-data.json` by "
        "`build/rebuild_curriculum.py` and `build/number_lesson_objects.py` — edit the JSON "
        "(or the generator), not this file directly.*\n",
        "---\n",
    ]
    for sec in curriculum["sections"]:
        lines.append(f"## Section {sec['id']} — {sec['title']}\n")
        for mod in sec["modules"]:
            lines.append(f"### {mod['id']} {mod['title']}\n")
            for lesson in mod["lessons"]:
                lines.append(f"#### {lesson['id']} {lesson['title']} ({len(lesson['objects'])})\n")
                for o in lesson["objects"]:
                    lines.append(fmt_obj(o))
                lines.append("")
        lines.append("---\n")
    with open(path, "w") as f:
        f.write("\n".join(lines))
