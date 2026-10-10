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

The app is one page, `index.html`, with four views and a tab bar along the
bottom to switch between them: **Scroll** (the default when the app opens),
**Learn**, **Walk** and **Explore**. Switching tabs never reloads the page
or changes the address.

- **Scroll** — one card per street, square, waterway, park and building
  (1,350 of them — see "Scroll feed" below), browsable as a vertical swipe
  list.
- **Learn** — the curriculum: lessons, Learn/Quiz, the pan/zoom map.
- **Walk** — get from A to B by naming the roads of a contiguous path
  (Easy: multiple choice along the fastest path; Hard: type any road that
  continues the walk). See "Walk game" below.
- **Explore** — the whole map to roam freely: tap a tree to see what kind it
  is, or a street, square, waterway, building or park to see its name. See
  "Explore" below.

`shell.js` builds the tab bar and loads each view's scripts the first time
its tab is opened (the map and street data are large, and a visit often
uses only one or two views; scripts shared between views load once). A view
then stays in the page while hidden, so switching back resumes exactly where
you were - a lesson mid-quiz, a Walk round, the Explore viewport, the Scroll
card. Views that need to re-measure after being hidden register an `onShow`
hook with `AppShell.register()`.

`learn.html`, `scroll.html`, `walk.html` and `explore.html` are now only
redirects (to `index.html#learn` etc., which opens that tab and then drops
the hash), so old bookmarks and already-installed home-screen icons keep
working.

When opened from the iPhone home screen, iOS sometimes launches the app
with the screen measured as if the status bar took up space, leaving the
tab bar floating that far above the bottom until the page first scrolls.
`shell.js` works around it at launch (`nudgeStandaloneViewport`): for two
frames it makes the page a little taller and scrolls it by a pixel, then
undoes both. It only runs in home-screen (standalone) mode.

## App icon

`icons/` holds the home-screen icon (`apple-touch-icon.png`, 180px), the
browser-tab icons (`favicon.svg`, `favicon-32.png`) and the master
`icon.svg`; Learn's header shows the same icon. `build/make_icon.py` draws
them all from the source map data, so re-run it after the ring boundary
changes:

```
python3 build/make_icon.py
```

It's four flat shapes in the colours of the province of Antwerp's flag: the
ring (red, corners softened), the Schelde (blue) flowing past the quays and
bending away west at the north end, the Leien as one white boulevard, and
the Stadspark (yellow, drawn larger than life so it reads at icon size).
The PNGs are drawn with Pillow from the same shapes as the SVGs.

## How it's built

- **No backend, no client-side build step.** `index.html` loads `style.css`
  and `shell.js`; the shell adds each view's script and the generated data
  files it needs as plain `<script>` tags.
- **Map rendering is a single inline SVG**, projected with an equirectangular
  + `cos(latitude)` correction, no tile server or mapping library. One shared
  base map is reused across all 135 lessons and all 1,214 Scroll cards; every
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
call module `4.2.1`, just renamed. The rename was a one-time migration
(a single explicit old-key &rarr; new-key pass over the whole JSON, not
three sequential find-and-replace passes, which would double-convert
section &rarr; module &rarr; lesson); `build/rebuild_curriculum.py`,
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

`build/rebuild_curriculum.py` regenerates `antwerp-curriculum-data.json` so
that **every object in the base map — every road,
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
python3 build/rebuild_curriculum.py && python3 build/number_lesson_objects.py && python3 build/preprocess.py && python3 build/street_cards.py && python3 build/street_graph.py
```

(`number_lesson_objects.py` must run after the curriculum's final object
lists are set and before `preprocess.py`, since it writes each object's
reading-order `number` into the same JSON that `preprocess.py` then copies
into `curriculum-data.js` verbatim. It also writes the human-readable
`antwerp-curriculum.md` from the numbered JSON, via `build/curriculum_md.py`.
`build/check_curriculum.py` is good to run after, to re-confirm zero
size/coverage violations.)

A handful of objects still only appear once, all pre-existing and out of
this script's scope: a few kaai/lei streets and one square/park from the
original curated lists, and the 11 neighborhoods that had zero tracked
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
per street, square, waterway, park and building in the base map, for the
Scroll page: 1,214 streets and squares, 15 waterways, 39 parks and 82
buildings (churches included). Each record has a `kind`. It reuses
`preprocess.py`'s projection and reconstructed neighborhood polygons rather
than re-deriving them (imported via `importlib.util`, the same pattern
`rebuild_curriculum.py` uses). Run it after `preprocess.py`:

```
python3 build/street_cards.py
```

Each record carries facts only — name, orientation, which streets it meets
and where, neighborhood, curriculum lessons — never geometry. Waterway,
park and building cards carry the streets *around* them instead (`near`):
for a park or building every street within 40 m of its footprint (the
distance the Walk game uses), listed clockwise from north; for a waterway
its quays and bridges (within 25 m, widening to 100 m for docks drawn along
the water's edge), listed along it. The Schelde is special: the data's
river line runs mid-river, 200-260 m out from the quays, so its card lists
the streets *facing* it - from every 25 m along the river, the first
street straight inland - plus the tunnels under it. Their `facts` give the
kind of water, park or building and its size. Scroll's own
map draws from the same already-projected paths in `map-data.js` that Learn
uses (`MapRender.resolveObjectByName(name, kind)`), so geometry
is never duplicated between the two data files. See the docstring in
`build/street_cards.py` for exactly how intersections, start/end, and
orientation are derived (shared-vertex matching, not geometric crossing, so
tunnels don't register as junctions with the streets above them).

Orientation is directional, written start &rarr; end: a street whose
start (the end nearest Grote Markt, the house-numbering heuristic) is its
south end reads "south–north". Below it, the streets at the start and the
end are listed the same way, e.g. "Start Britselei and Kasteelpleinstraat
&rarr; Bolivarplaats".

The card's name sits in a panel cut into the top-left of the map (with its
kind - Street, Square, Dock, Park, Church... - above it), so it's read
first, before the street labels on the map. The map is framed so the card's
subject sits below that panel, and no street label goes under it. "View in
Explore", on the right just below the map (beside the direction line),
switches to the Explore tab with that
subject highlighted, its info card open and the map framed on it
(`AppShell.show("explore", {focus: {type, name}})`). The footer keeps only
the neighborhood and lessons on the left and the feed position on the
right. The card is laid out
to fit without scrolling on an iPhone (checked across all cards at
375&times;548 up to 430&times;739 viewports); the map takes whatever height
the text leaves.

**Known data notes** (from the last generation run):

- **The southern edge follows the railway, not the R1.** From the ring
  corner at the Kennedy tunnel (beside Buurtpark Nieuw Zuid) to Posthofbrug
  near Berchem station, `ring_boundary` traces the railway tracks, so Kiel
  is outside the map; Posthofbrug then joins the R1 edge. The source data
  has no track for 233 m near Berchem (the old boundary had clipped it), so
  that stretch follows the old boundary. Everything south of the tracks was
  removed from the source data, and streets crossing the line were cut at it.

- **No sliver neighborhoods on the east edge.** Nine neighborhoods that were
  only slivers between the ring and its neighbors (0.1 - 3.3 ha each: Van de
  Perrelei, Stenenbrug - Zuid, College, Deurne - Huiskens, Deurne - Het Dorp,
  Ten Eekhove, Sportpaleis, Duivelshoek, Gagelvelden) were removed, with
  Deurne - Gemeentehuis, which lay entirely inside them. There the ring
  boundary follows the edges of the neighborhoods next to them, and
  everything beyond it (Joe Englishstraat, part of the Albertkanaal) is gone.
  Foorplein was merged into Bo / Kleine Ring: its 4.9 ha already lay inside
  Bo / Kleine Ring's outline, so only its own entry went, and Bo / Kleine
  Ring's density became the area-weighted mix of the two (787 and 14,838 ->
  1,625 people/km²). 90 neighborhoods remain.

- **One waterway per name.** The source splits six waterways over several
  entries (the Schelde over three; Willemdok and Straatsburgdok each into a
  dock and a canal piece). `preprocess.py` merges them into one map object
  with all of their lines, typed by the longest piece - before, the last
  entry overwrote the others, so the Schelde was a 126 m stub on the map.
- **1,214 street and square cards.** The source data has 1,219 street entries; `preprocess.py`
  trims dead-end stubs clipped at the ring, which leaves 5 of them with no
  geometry, so they get no card. Two names (Hogeweg, Statiestraat) each
  exist as two physically distinct entries in the source data. Each entry
  gets its own card, since that's what the authoritative source data
  actually contains.
- **2 streets/squares show zero intersections**: Flamingoplein and Moeke
  Bitterpeeënstraat — both checked individually; each is a tiny clipped
  fragment (tens of meters across), not a bug in the intersection matching.
- **76 dead ends** (one bare endpoint with nothing within ~20m).
- **23 curved streets** (path length more than 1.3&times; the straight-line
  distance between its two endpoints).
- **0 "about the name" explanations.** The curriculum data has no free-text
  history/name field today, so the Scroll card never shows that row. Adding
  that content is out of scope here — a future change request.

## Walk game

`build/street_graph.py` builds `data/street-graph.json` (plus the
`data/generated/street-graph.js` wrapper the page loads): the walkable street
network as junction nodes and edge lengths, and which roads count as "being
at" each endpoint object. Run it after `preprocess.py`:

```
python3 build/street_graph.py
```

- **Nodes** are vertices shared by two or more lines (different roads
  meeting, or one road forking), plus line ends; vertices within 0.25 m of
  each other on *different* lines are the same junction (the data is noded
  to within centimetres). Same-road pass-through nodes are contracted away,
  so the graph only branches where a walker could choose. Bridges and
  tunnels that cross without sharing a vertex are not junctions.
- **Edges** store road, length in metres, and which `MAP_DATA.bgStreets`
  subpath and vertex range they cover - geometry isn't duplicated; `walk.js`
  draws edges from the map data the page already has.
- **Walkability:** the source data has no access/highway tags, so roads
  whose name *ends* in "tunnel" are excluded (10, listed in the file's
  `meta`). "Contains tunnel" would also drop Tunnelplaats, a walkable square.
- **Attachment:** a street is at itself; a square is at itself plus every
  road meeting it; a building or park is at every walkable road within 40 m
  of its footprint (nearest road if none - one park). That's where you can
  *start* from A. *Arriving* at B is stricter for a square: you have to step
  onto the square itself, not just a street meeting it - so for a street or
  square B the last road you name is B. Neighborhoods and
  waterways aren't endpoints. Only roads in the largest connected component
  (99.0% of nodes) are attached; 2 tiny clipped fragments (Flamingoplein,
  Moeke Bitterpeeënstraat) are orphans.
- **Rounds** have 4 to 8 roads (`MIN_STEPS`/`MAX_STEPS` in `walk.js`): at
  least two roads between A's road and B's, since a three-road route is too
  easy. When A or B is a place rather than a street, the questions name it:
  "Which road at Sint-Pauluskerk do you start on?", "You're on Meir. Which
  road takes you to Stadspark?".
- **Anchors (a deliberate refinement):** the game's rules are road-level,
  exactly as specified - the round is complete the moment you turn onto one
  of B's roads. But distance and the drawn walk run *to the object*:
  along the final road to B's anchor, and from A's anchor along the first.
  Without that, a building beside one end of a long boulevard counted as
  "reached" from the boulevard's far end (a 266 m "fastest route" to a church
  ~1 km away, in testing). Streets anchor anywhere along themselves, squares
  at their own junctions, buildings/parks at the ends of each attached
  road's edge closest to the footprint.

`walk.js` holds all routing (no DOM, so it also runs under Node):
fastest path (A* for the true shortest distance under the rules, then a
fewest-road-changes search within 2% of it), shortest walk along a given
road sequence (layered Dijkstra, for Hard-mode distances), Easy-mode
distractors, Hard-mode validation and hints. `walk-page.js` is the UI:

- **Easy** has no hint. While it asks "You're on X. Which road next?", the
  route so far - including X - is drawn up to the junction where the next
  turn is, with the blue dot there. Easy follows the fastest path, so that
  junction is known in advance, and the wrong options never touch X, so
  marking it gives none of them away. (When the next turn is at the very
  junction where you joined X, there's nothing of X to draw yet.)
- **Hard** keeps the dot where you joined the current road: you can turn
  off anywhere along it, so the next junction isn't known until you name
  the next road. It has a Hint button.
- **Layout:** the tab fills the screen above the tab bar without page
  scrolling. The map takes whatever height the question card leaves (at
  least 140px; half the height on the end-of-round summary, whose card
  scrolls on its own), and Easy's four options sit in a two-by-two grid.

Tests:

```
python3 build/test_street_graph.py   # graph build on a synthetic grid
node build/test_walk.js              # tie-break, anchors, Hard validation,
                                     # hint after deviation, dropdown filter,
                                     # 1,000-round Easy invariant, hint play-through
```

## Explore

The Explore tab (`explore.js`) shows the full base map, filling the screen
(the shared map controller takes the screen's real aspect ratio here, where
the other pages size their map to the map's own). Pan, pinch or scroll to
zoom, double-tap to zoom in, and the +, &minus; and &#x2922; buttons zoom or
show the whole map again.

- **Hit-testing is geometric, not DOM-based.** Streets are drawn sub-pixel
  thin and tree icons are a few pixels wide, so a tap picks the nearest
  line or tree within 14 screen px (6 px when the tap is inside a building
  or park, so the area itself stays tappable), then the smallest building
  or park containing the point. Trees get a small bonus so they win close
  ties against the road they stand on.
- **"Also here" chips.** The source data has roads and squares sharing exact
  geometry (Lobroekdok follows Denderstraat's vertices; many squares are
  drawn from their surrounding streets) and tree icons covering tiny parks.
  Everything else effectively on the tapped spot is offered as a chip, so
  every object is reachable: in testing, every one of the 1,085 roads, 127
  squares, 15 waterways, 82 buildings, 39 parks and 239 tree markers.
- **Trees** show an English common name and the botanical name (italic,
  &times; for hybrids, cultivar in quotes), from the species recorded in the
  source data: e.g. "Horse chestnut &mdash; *Aesculus hippocastanum*", with
  the park and trunk girth where known. The common names are a lookup in
  `explore.js` (full species, then binomial, then genus). Clustered ginkgos
  and magnolias show as a group with their count. `preprocess.py` now keeps
  each tree's species, girth and note in `map-data.js` for this.
- **Every card** also names the neighborhood the tap landed in.

## localStorage keys

- `antwerpRing.v1` — Learn's existing progress (`{progress, lastOpened,
  openSections}`). Unchanged by this change request.
- `antwerpScroll.v1` — Scroll's resume state: `{order, positions, total,
  filterStarted, shuffleOrder}`, one position remembered per order
  (Curriculum/Region/A&ndash;Z/Shuffle). Scroll only ever *reads*
  `antwerpRing.v1` (for the "only streets from lessons I've started" filter)
  and never writes to it.
- `antwerpWalk.v1` — Walk: `{mode, filter, played: {easy, hard}, misses,
  hints}`. Also only reads `antwerpRing.v1`, for its "lessons I've started"
  filter.
- Explore stores nothing.

## Scope notes

- Trees, tram lines, and rail lines are rendered on every lesson's map as
  scenery (per Change Request 1) but are excluded from the curriculum itself
  (per `data/source/antwerp-curriculum-data.json` meta) — they're never a
  quiz object.
- The quiz target color is one consistent blue across every object type, by
  design — it signals "this is what you're being tested on" independent of
  category. Scenery layers (parks, buildings, trams, rail, trees) use their
  own dim, non-interactive colors so they never compete with that signal.
