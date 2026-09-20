# Antwerp Inside the Ring

A static, data-driven learning app for the streets, squares, waterways,
buildings, parks, and neighborhoods of Antwerp's historic core (everything
inside the R1 ring road). Browse a hand-derived map by curriculum module,
then quiz yourself by tapping the right place on the map.

Live app: `index.html` (deployed via GitHub Pages from `main`).

## How it's built

- **No backend, no client-side build step.** `index.html` loads `style.css`,
  `app.js`, and two generated data files as plain `<script>` tags.
- **Map rendering is a single inline SVG**, projected with an equirectangular
  + `cos(latitude)` correction, no tile server or mapping library. One shared
  base map is reused across all 136 modules; every module also renders the
  full scenery layer (streets, waterways, neighborhood outlines, parks,
  buildings, tram/rail lines, and both tree species) dimmed for context, then
  overlays just its own objects as bright interactive targets.
- **Tap targets:** line objects (roads, waterways, squares) get an invisible
  16px-wide hit-stroke on top of their thin visual line, since a raw 2-3px
  SVG stroke is not a reliable touch target. Polygon objects (buildings,
  parks, neighborhoods) are hit-tested by their own fill area plus a small
  stroke buffer.
- **The map frames itself to each module's own objects on open** (padded,
  floor and ceiling clamped) rather than always showing the whole ring at a
  fixed zoom, and is a real pan/pinch-zoom viewport from there (Pointer
  Events, so touch and mouse share one code path) with a recenter button
  back to that fitted view.

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
module**, and almost all of them in at least two (once geographically, once
in Super Section 8's review). The original curriculum only covered the
curated subset of roads (longest/kaai/lei); this script assigns the
remaining ~1,020 ordinary streets to a neighborhood via point-in-polygon
against the reconstructed neighborhood outlines, adds an "Other Streets"
module per section (chunked to the 50-object cap, with small leftovers
carried forward to the next section so nothing drops below the 5-object
floor), and adds matching review modules to Super Section 8. It's additive
to the existing 8 super sections and their neighborhood groupings, not a
restructure. Run it before `preprocess.py` if you've changed the source
curriculum or the neighborhood-polygon logic:

```
python3 build/rebuild_curriculum.py && python3 build/preprocess.py
```

A handful of objects still only appear once, all pre-existing and out of
this script's scope: a few kaai/lei streets and one square/park from the
original curated lists, and the 18 neighborhoods that had zero tracked
objects to begin with (they still only list in Super Section 8, since
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

## Scope notes

- Trees, tram lines, and rail lines are rendered on every module's map as
  scenery (per Change Request 1) but are excluded from the curriculum itself
  (per `data/source/antwerp-curriculum-data.json` meta) — they're never a
  quiz object.
- The quiz target color is one consistent blue across every object type, by
  design — it signals "this is what you're being tested on" independent of
  category. Scenery layers (parks, buildings, trams, rail, trees) use their
  own dim, non-interactive colors so they never compete with that signal.
