# Antwerp Inside the Ring

A static, data-driven learning app for the streets, squares, waterways,
buildings, parks, and neighborhoods of Antwerp's historic core (everything
inside the R1 ring road). Browse a hand-derived map by curriculum lesson,
then quiz yourself by tapping the right place on the map.

The curriculum is organized section &gt; module &gt; lesson &gt; object (e.g.
lesson `4.2.1` is section 4, module 4.2, lesson 1 of that module) - see
"Curriculum hierarchy" below.

Live app: `index.html` (deployed via GitHub Pages from `main`).

## Pages

The app is three plain HTML pages, not a single-page app with routes — each
is its own entry point, sharing `style.css` and the map-rendering code:

- **`index.html`** — the home menu. Two choices, Learn and Scroll, each with
  a progress line read from existing localStorage (lesson count for Learn,
  last card seen for Scroll). Loads only `curriculum-data.js` (to count
  lessons) and `menu.js`; no map data, so it's light.
- **`learn.html`** — the original curriculum app (lessons, Learn/Quiz, the
  pan/zoom map). This is what `index.html` used to be before Change Request
  2 added the home menu in front of it.
- **`scroll.html`** — the Scroll feed: one card per street/square (1,233 of
  them, including 3 duplicate-named-but-physically-distinct entries — see
  "Scroll feed" below), browsable as a vertical swipe list.

All three keep the same Add-to-Home-Screen icon and meta tags, and are
same-origin, so an already-installed home-screen app keeps working.

## How it's built

- **No backend, no client-side build step.** Each page loads `style.css`
  and its own script plus the generated data files it needs as plain
  `<script>` tags.
- **Map rendering is a single inline SVG**, projected with an equirectangular
  + `cos(latitude)` correction, no tile server or mapping library. One shared
  base map is reused across all 136 lessons and all 1,233 Scroll cards; every
  screen also renders the full scenery layer (streets, waterways,
  neighborhood outlines, parks, buildings, tram/rail lines, and both tree
  species) dimmed for context, then overlays just its own objects as bright
  interactive (Learn/Quiz) or labeled (Scroll) targets.
- **`map-render.js`** holds everything both pages need: the scenery-layer
  builder, the tree icon defs, viewport-fitting math, and the pan/pinch-zoom
  controller (`app.js` uses the controller; `scroll.js` only uses the
  fitting/scenery helpers, since each Scroll card is a small static map, not
  an interactive one). It's loaded as a global (`MapRender`) before
  `app.js`/`scroll.js`, and depends on `map-data.js` being loaded first.
- **Tap targets:** line objects (roads, waterways, squares) get an invisible
  16px-wide hit-stroke on top of their thin visual line, since a raw 2-3px
  SVG stroke is not a reliable touch target. Polygon objects (buildings,
  parks, neighborhoods) are hit-tested by their own fill area plus a small
  stroke buffer.
- **The map frames itself to each lesson's own objects on open** (padded,
  floor and ceiling clamped) rather than always showing the whole ring at a
  fixed zoom, and is a real pan/pinch-zoom viewport from there (Pointer
  Events, so touch and mouse share one code path) with a recenter button
  back to that fitted view.
- **Objects are numbered in reading order within each lesson** (Change
  Request 3): rows north to south, west to east within a row, computed once
  at build time (`build/number_lesson_objects.py`) and stored on each
  object as `number`. Learn mode shows the number as a small notebook-corner
  badge at the object's reference point (the same point used for its map
  badge) and sorts its object list by that number; Quiz mode hides every
  badge, so the number can't become an answer shortcut. Badges that would
  otherwise overlap are nudged apart with a short leader line back to the
  true point - the number itself never changes to resolve an overlap.

## Curriculum hierarchy

Change Request 3 renamed the curriculum's nesting, in place: `super_section`
&rarr; `section`, `section` &rarr; `module`, `module` &rarr; `lesson`. The
numbers didn't change - lesson `4.2.1` is the exact unit this app used to
call module `4.2.1`, just renamed. `build/rename_hierarchy.py` did this
rename once (a single explicit old-key &rarr; new-key pass over the whole
JSON, not three sequential find-and-replace passes, which would double
-convert section &rarr; module &rarr; lesson); `build/rebuild_curriculum.py`,
`build/street_cards.py`, and `build/number_lesson_objects.py` all read and
write the new schema from here on.

`build/check_curriculum.py` re-checks the size/coverage rules from Change
Request 1 in the new terms (every lesson has 5-50 objects, review lessons
exempt from the cap only; every object appears in at least 2 lessons; each
module has 3-7 lessons; each section has 2-4 modules). The first two hold,
modulo the same pre-existing documented exceptions below. The last two do
not, and never did under the old names either - renaming can't change a
count. Several region modules group one lesson per neighborhood and have
far more than 4, and some modules have far more or fewer than 7 lessons
once Change Request 1's coverage expansion ran. Restructuring the grouping
to force that compliance is a structural redesign outside Change Request
3's explicit scope ("no platform or structure trigger... this is a rename
plus a deterministic sort") and hasn't been done here.

No localStorage key or field name actually contains the old terms
(`antwerpRing.v1`'s `progress`/`lastOpened`/`openSections`,
`antwerpScroll.v1`'s fields) - they're generic, and lesson/module/section
IDs are unchanged strings like `"4.2.1"`. So no migration was needed for
existing saved progress to keep working; this was verified with real
pre-existing progress data rather than assumed.

## Data pipeline

Raw source data lives in `data/source/` (from the official street register,
OSM extracts, and the city's neighborhood/parks layers, already filtered to
the ring). `build/preprocess.py` projects every geometry into a shared SVG
coordinate space and bakes ready-to-use path strings, producing
`data/generated/map-data.js` and `data/generated/curriculum-data.js`.

Re-run it after touching source data or the ring boundary:

```
python3 build/preprocess.py
```

### Curriculum coverage

`build/rebuild_curriculum.py` regenerates `antwerp-curriculum-data.json` (and
the `.md` alongside it) so that **every object in the base map — every road,
square, waterway, park, building, and neighborhood — appears in at least one
lesson**, and almost all of them in at least two (once geographically, once
in Section 8's review). The original curriculum only covered the curated
subset of roads (longest/kaai/lei); this script assigns the remaining
~1,020 ordinary streets to a neighborhood via point-in-polygon against the
reconstructed neighborhood outlines, adds an "Other Streets" lesson per
module (chunked to the 50-object cap, with small leftovers carried forward
to the next module so nothing drops below the 5-object floor), and adds
matching review lessons to Section 8. It's additive to the existing 8
sections and their neighborhood groupings, not a restructure. Run it before
`number_lesson_objects.py`/`preprocess.py` if you've changed the source
curriculum or the neighborhood-polygon logic:

```
python3 build/rebuild_curriculum.py && python3 build/number_lesson_objects.py && python3 build/preprocess.py && python3 build/street_cards.py
```

(`number_lesson_objects.py` must run after the curriculum's final object
lists are set and before `preprocess.py`, since it writes each object's
reading-order `number` into the same JSON that `preprocess.py` then copies
into `curriculum-data.js` verbatim. `build/check_curriculum.py` is good to
run after, to re-confirm zero size/coverage violations.)

A handful of objects still only appear once, all pre-existing and out of
this script's scope: a few kaai/lei streets and one square/park from the
original curated lists, and the 18 neighborhoods that had zero tracked
objects to begin with (they still only list in Section 8, since
Foundations' 1.5.1 explicitly filters to neighborhoods *with* tracked
objects — that filter is unchanged).

### Neighborhood polygons are reconstructed, not sourced directly

The neighborhood layer in the source data is a set of *open* outline
polylines clipped to the ring boundary, not closed fillable polygons (the
original unclipped municipal polygon file wasn't available). `preprocess.py`
closes each neighborhood by:

1. Greedily chaining a neighborhood's line segments end-to-end at their
   nearest matching endpoints.
2. Splicing in the shorter arc of the ring boundary to close whatever gap is
   left (the same logic used to build the ring boundary itself: real
   interior edges plus a shared boundary edge).
3. Keeping genuinely disconnected pieces (e.g. a roundabout island inside a
   larger neighborhood) as separate polygon parts.

This was checked by rendering all 105 resulting shapes together: they tile
the ring interior cleanly, with one known imperfection — a small sliver gap
of a few hundred square meters where four neighborhoods meet near the old
harbor (Oude Haven / Houtdok / Albertdok / IJzerlaan). A tap landing in that
sliver won't register; everywhere else resolves correctly. Treat these
polygons as a best-effort reconstruction for a memorization app, not
surveyed municipal boundaries.

## Scroll feed

`build/street_cards.py` generates `data/street-cards.json` (and
`data/generated/street-cards.js`, the same data wrapped as `const
STREET_CARDS = [...]` for plain `<script>` loading) — one fact-only record
per road/square in the base map, for the Scroll page. It reuses
`preprocess.py`'s projection and reconstructed neighborhood polygons rather
than re-deriving them (imported via `importlib.util`, the same pattern
`rebuild_curriculum.py` uses). Run it after `preprocess.py`:

```
python3 build/street_cards.py
```

Each record carries facts only — name, orientation, which streets it meets
and where, neighborhood, curriculum lessons — never geometry. Scroll's own
map draws from the same already-projected paths in `map-data.js` that Learn
uses (`MapRender.resolveObjectByName(name, "road" | "square")`), so geometry
is never duplicated between the two data files. See the docstring in
`build/street_cards.py` for exactly how intersections, start/end, and
orientation are derived (shared-vertex matching, not geometric crossing, so
tunnels don't register as junctions with the streets above them).

**Known data notes** (from the last generation run):

- **1,233 cards, not 1,230.** The base map's own street count is 1,233
  (`meta.counts.streets`); three names (Turnhoutsebaan, Hogeweg,
  Statiestraat) each exist as two physically distinct entries in the source
  data. Each entry gets its own card, since that's what the authoritative
  source data actually contains.
- **5 streets/squares show zero intersections**: Flamingoplein, Sasdok,
  Moeke Bitterpeeënstraat, a small Turnhoutsebaan stub, and Kalverveld — all
  checked individually; each is a tiny clipped fragment or duplicate stub
  (tens of meters across), not a bug in the intersection matching.
- **92 dead ends** (one bare endpoint with nothing within ~20m).
- **23 curved streets** (path length more than 1.3&times; the straight-line
  distance between its two endpoints).
- **0 "about the name" explanations.** The curriculum data has no free-text
  history/name field today, so the Scroll card never shows that row. Adding
  that content is out of scope here — a future change request.

## localStorage keys

- `antwerpRing.v1` — Learn's existing progress (`{progress, lastOpened,
  openSections}`). Unchanged by this change request.
- `antwerpScroll.v1` — Scroll's resume state: `{order, positions, total,
  filterStarted, shuffleOrder}`, one position remembered per order
  (Curriculum/Region/A&ndash;Z/Shuffle). Scroll only ever *reads*
  `antwerpRing.v1` (for the "only streets from lessons I've started" filter)
  and never writes to it.

## Scope notes

- Trees, tram lines, and rail lines are rendered on every lesson's map as
  scenery (per Change Request 1) but are excluded from the curriculum itself
  (per `data/source/antwerp-curriculum-data.json` meta) — they're never a
  quiz object.
- The quiz target color is one consistent blue across every object type, by
  design — it signals "this is what you're being tested on" independent of
  category. Scenery layers (parks, buildings, trams, rail, trees) use their
  own dim, non-interactive colors so they never compete with that signal.
