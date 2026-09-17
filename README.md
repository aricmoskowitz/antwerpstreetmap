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
  base map (ring boundary, dimmed streets/waterways/neighborhood outlines) is
  reused across all 68 modules; each module overlays just its own objects as
  interactive targets.
- **Tap targets:** line objects (roads, waterways, squares) get an invisible
  16px-wide hit-stroke on top of their thin visual line, since a raw 2-3px
  SVG stroke is not a reliable touch target. Polygon objects (buildings,
  parks, neighborhoods) are hit-tested by their own fill area plus a small
  stroke buffer.

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

- Trees, tram lines, and rail lines exist in the source data but are
  excluded from the curriculum (per `data/source/antwerp-curriculum-data.json`
  meta) and are not rendered, to keep the base map legible and the payload
  size down.
- The quiz target color is one consistent blue across every object type, by
  design — it signals "this is what you're being tested on" independent of
  category.
