#!/usr/bin/env node
// Unit tests for walk.js (Change Request 4). Run from the repo root:
//
//     node build/test_walk.js
//
// Synthetic graphs cover tie-breaking, Hard-mode validation and the hint
// after a deviation; the real data/street-graph.json covers the Easy-mode
// invariant over 1,000 random rounds.
"use strict";
const assert = require("assert");
const path = require("path");
const Walk = require(path.join(__dirname, "..", "walk.js"));

// roads: names; edges: [a, b, roadName, lengthM]
function makeGraph(roadNames, nNodes, edgeList, objects) {
  const index = new Map(roadNames.map((n, i) => [n, i]));
  const nodes = [];
  for (let i = 0; i < nNodes; i++) nodes.push([i * 10, 0]);
  const data = {
    meta: { m_per_px: 1 },
    roads: roadNames.map((n) => ({ n, sq: 0, l: [] })),
    nodes,
    edges: edgeList.map(([a, b, r, len]) => [a, b, index.get(r), len, [0, 0, 1]]),
    objects: objects || [],
  };
  const g = new Walk.Graph(data);
  g.id = (n) => index.get(n);
  g.name = (i) => roadNames[i];
  return g;
}

function names(g, roads) {
  return roads.map((r) => g.name(r));
}

/* ---------- tie-breaking ---------- */
function testTieBreak() {
  // From Start (nodes 0-1) to Goal (nodes 8-9), three routes:
  //   X: 1000 m, four roads  (shortest)
  //   Y: 1015 m, two roads   (1.5% longer -> within 2%, fewer changes)
  //   Z: 1030 m, one road    (3% longer -> outside 2%)
  const g = makeGraph(
    ["Start", "X1", "X2", "X3", "X4", "Y1", "Y2", "Z1", "Goal"],
    10,
    [
      [0, 1, "Start", 10],
      [1, 2, "X1", 250], [2, 3, "X2", 250], [3, 4, "X3", 250], [4, 8, "X4", 250],
      [1, 5, "Y1", 500], [5, 8, "Y2", 515],
      [1, 8, "Z1", 1030],
      [8, 9, "Goal", 10],
    ]
  );
  const src = g.sourcesOnRoads([g.id("Start")]);
  const target = g.targetOnRoads([g.id("Goal")]);

  const p = g.fastestPath(src, target);
  assert.deepStrictEqual(names(g, p.roads), ["Start", "Y1", "Y2", "Goal"], "should prefer fewer changes within 2%");
  assert.strictEqual(p.dist, 1015);

  const strict = g.fastestPath(src, target, 0);
  assert.deepStrictEqual(names(g, strict.roads), ["Start", "X1", "X2", "X3", "X4", "Goal"]);
  assert.strictEqual(strict.dist, 1000);
  console.log("PASS: tie-break picks the 1.5%-longer route with fewer road changes, not the 3% one");
}

/* ---------- Hard-mode validation + hint after deviation ---------- */
//   A: 0 -10- 1 -300- 6        (A is a street, so the walk starts on it)
//   P: 1 -100- 2               fastest: A -> P -> B   (100 m)
//   B: 2 -50- 3                target
//   D: 6 -100- 4               deviation: leaves A far from P
//   E: 4 -100- 3               from D the fastest way on is D -> E -> B
//   Far: 7 -10- 8              touches nothing
function hardFixture() {
  const g = makeGraph(
    ["A", "P", "B", "D", "E", "Far"],
    9,
    [
      [0, 1, "A", 10], [1, 6, "A", 300],
      [1, 2, "P", 100],
      [2, 3, "B", 50],
      [6, 4, "D", 100],
      [4, 3, "E", 100],
      [7, 8, "Far", 10],
    ]
  );
  const a = { n: "A", t: "road", r: [g.id("A")] };
  const b = { n: "B", t: "road", r: [g.id("B")] };
  return { g, round: Walk.makeRound(g, a, b) };
}

function testHardValidation() {
  const { g, round } = hardFixture();
  const id = g.id;
  let seq = [];

  let r = Walk.hardEntry(g, round, seq, id("Far"));
  assert(!r.ok && r.reason === "nomeet", "a road that doesn't meet A is rejected");
  r = Walk.hardEntry(g, round, seq, id("E"));
  assert(!r.ok && r.reason === "nomeet", "E doesn't meet A either");
  r = Walk.hardEntry(g, round, seq, id("A"));
  assert(!r.ok && r.reason === "same", "re-entering the road you're on is rejected");

  r = Walk.hardEntry(g, round, seq, id("D"));
  assert(r.ok && !r.done, "D meets A");
  seq.push(id("D"));
  r = Walk.hardEntry(g, round, seq, id("P"));
  assert(!r.ok && r.reason === "nomeet", "P doesn't meet D");

  r = Walk.hardEntry(g, round, seq, id("A"));
  assert(r.ok, "revisiting A is allowed (it meets D)");

  r = Walk.hardEntry(g, round, seq, id("E"));
  assert(r.ok && !r.done, "E meets D");
  seq.push(id("E"));
  r = Walk.hardEntry(g, round, seq, id("B"));
  assert(r.ok && r.done, "turning onto B completes the round");
  assert.strictEqual(r.walk.dist, 200, "walk A->D->E->B is 100 m on D + 100 m on E");
  console.log("PASS: Hard validation (meets / doesn't meet / same road / revisit / completion)");
}

function testHintAfterDeviation() {
  const { g, round } = hardFixture();
  const id = g.id;
  assert.strictEqual(g.name(Walk.hardHint(g, round, [])), "P", "from the start, the hint is the fastest path's next road");
  assert.strictEqual(
    g.name(Walk.hardHint(g, round, [id("D")])),
    "E",
    "after deviating onto D, the hint recomputes from D (P doesn't even meet D)"
  );
  // the original fastest path still says P - the hint must not reuse it
  const original = g.fastestPath(round.start, round.target);
  assert.deepStrictEqual(names(g, original.roads), ["A", "P", "B"]);
  console.log("PASS: hint after deviation recomputes from the player's current road");
}

/* ---------- anchors: reaching B means reaching B, not its road ---------- */
//   S: 3 -50- 0          A is the street S
//   L: 0 -500- 1 -500- 2  a long road; B (a building) sits by the 1-2 stretch
// Turning onto L at node 0 completes the round (L is B's attached road), but
// the walk still has to go along L to B's anchor: 500 m, not 0.
function testAnchors() {
  const g = makeGraph(["S", "L"], 4, [[3, 0, "S", 50], [0, 1, "L", 500], [1, 2, "L", 500]]);
  const a = { n: "S", t: "road", r: [g.id("S")] };
  const b = { n: "B", t: "building", r: [g.id("L")], a: [1, g.id("L"), 2, g.id("L")] };
  const round = Walk.makeRound(g, a, b);
  const p = g.fastestPath(round.start, round.target);
  assert.deepStrictEqual(names(g, p.roads), ["S", "L"]);
  assert.strictEqual(p.dist, 500, "walk continues along L to the building");
  assert.strictEqual(p.endNode, 1);
  const res = Walk.hardEntry(g, round, [], g.id("L"));
  assert(res.ok && res.done, "turning onto B's road completes the round");
  assert.strictEqual(res.walk.dist, 500, "Hard distance also runs to the anchor");
  console.log("PASS: anchors - the walk runs along B's road to B itself, not just onto the road");
}

/* ---------- dropdown filter ---------- */
function testFilter() {
  const g = makeGraph(["Italiëlei", "Meir", "Groenplaats", "italiestraat", "Ëlzenweg", "'s-Herenstraat"], 2, []);
  const idx = Walk.roadNameIndex(g);
  const hits = Walk.filterRoadNames(idx, "italie").map((x) => x.name);
  assert.deepStrictEqual(hits, ["Italiëlei", "italiestraat"], "accent- and case-insensitive contains, sorted");
  assert.deepStrictEqual(Walk.filterRoadNames(idx, "ELZEN").map((x) => x.name), ["Ëlzenweg"]);
  assert.strictEqual(Walk.filterRoadNames(idx, "").length, 6, "empty query lists every road");
  const all = idx.map((x) => x.name);
  const sorted = all.slice().sort((a, b) => a.localeCompare(b, "nl", { sensitivity: "base" }));
  assert.deepStrictEqual(all, sorted, "full list is alphabetical");
  console.log("PASS: dropdown filter (accent/case-insensitive, alphabetical)");
}

/* ---------- 1,000 real rounds ---------- */
function testRealRounds() {
  const data = require(path.join(__dirname, "..", "data", "street-graph.json"));
  const g = new Walk.Graph(data);
  const rng = Walk.seededRng(20261001);
  let steps = 0;
  for (let i = 0; i < 1000; i++) {
    const round = Walk.generateRound(g, g.objects, { mode: "easy", rng });
    assert(round, `round ${i} failed to generate`);
    const roads = round.path.roads;
    assert(roads.length >= Walk.MIN_STEPS && roads.length <= Walk.MAX_STEPS, `round ${i}: ${roads.length} steps`);
    const aSet = new Set(round.a.r);
    assert(!round.b.r.some((r) => aSet.has(r)), `round ${i}: A and B share a road`);
    for (let k = 1; k < roads.length; k++) assert(g.touches(roads[k - 1], roads[k]), `round ${i}: path not contiguous`);

    for (const q of round.questions) {
      steps++;
      assert.strictEqual(q.options.length, 4);
      assert.strictEqual(new Set(q.options).size, 4, "options are distinct");
      assert(q.options.includes(q.correct));
      const cur = new Set(q.current);
      const contiguous = q.options.filter((o) => g.touchesSet(o, cur));
      assert.deepStrictEqual(contiguous, [q.correct], `round ${i} step ${q.index}: exactly one option meets the current road`);
      const route = new Set(roads);
      q.options.filter((o) => o !== q.correct).forEach((o) => assert(!route.has(o), "distractor on the route"));
    }
  }
  console.log(`PASS: 1000 Easy rounds, ${steps} steps - every step has exactly one contiguous option`);
}

// A Hard player who only ever presses Hint - after first wandering off
// onto a random valid road - must always get a valid next road and reach B.
function testHintsAlwaysFinish() {
  const data = require(path.join(__dirname, "..", "data", "street-graph.json"));
  const g = new Walk.Graph(data);
  const rng = Walk.seededRng(7);
  for (let i = 0; i < 300; i++) {
    const round = Walk.generateRound(g, g.objects, { mode: "hard", rng });
    const seq = [];
    // deviate first: any valid road that isn't the hint
    const hint0 = Walk.hardHint(g, round, seq);
    const cur = Walk.currentRoad(round, seq);
    const starts = cur >= 0 ? [cur] : round.startRoads;
    const detour = Array.from(g.roadNeighbors[starts[0]]).find(
      (r) => r !== hint0 && !round.targets.has(r) && Walk.hardEntry(g, round, seq, r).ok
    );
    if (detour !== undefined) seq.push(detour);
    let done = false;
    for (let k = 0; k < 40 && !done; k++) {
      const h = Walk.hardHint(g, round, seq);
      assert(h >= 0, `round ${i}: no hint available`);
      const res = Walk.hardEntry(g, round, seq, h);
      assert(res.ok, `round ${i}: hint ${g.roads[h].n} was rejected (${res.reason})`);
      seq.push(h);
      done = res.done;
    }
    assert(done, `round ${i}: following hints never reached B`);
    const fastest = round.path.dist;
    const walked = g.layeredWalk(round.start, seq, round.target).dist;
    assert(walked + 1e-6 >= fastest / 1.02 - 1, `round ${i}: walk shorter than the true shortest distance`);
  }
  console.log("PASS: 300 Hard rounds with a detour - following hints always reaches B");
}

testTieBreak();
testAnchors();
testHardValidation();
testHintAfterDeviation();
testFilter();
testRealRounds();
testHintsAlwaysFinish();
console.log("\nAll walk tests passed.");
