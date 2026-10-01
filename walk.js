// Walk game routing (Change Request 4): the street graph, shortest paths,
// Easy-mode distractors, Hard-mode validation and hints. No DOM access, so
// the same file runs in the page (global `Walk`) and under Node for
// build/test_walk.js.
//
// Vocabulary:
//   road      - a street name (squares included); an index into graph.roads
//   step      - one road in a path's road sequence; consecutive edges on the
//               same road collapse into one step, a road re-entered later is
//               a new step
//   "at" A/B  - an object's attached roads (precomputed by street_graph.py)
//
// Rules are road-level, as Change Request 4 specifies: the walk starts on one
// of A's attached roads, and the round is complete the moment the player
// turns onto one of B's attached roads. Distance and the drawn walk are
// geographic: they run from A's anchor points and along the final road to
// B's anchor points (see build/street_graph.py), so a building beside one
// end of a long boulevard isn't "reached" from the boulevard's far end.
(function (root, factory) {
  var Walk = factory();
  if (typeof module === "object" && module.exports) module.exports = Walk;
  else root.Walk = Walk;
})(this, function () {
  "use strict";

  /* ============================== MIN-HEAP ============================== */

  function Heap() {
    this.keys = [];
    this.vals = [];
  }
  Heap.prototype.size = function () {
    return this.keys.length;
  };
  Heap.prototype.push = function (key, val) {
    var k = this.keys,
      v = this.vals,
      i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.keys,
      v = this.vals;
    var topV = v[0];
    var lastK = k.pop(),
      lastV = v.pop();
    var n = k.length;
    if (n) {
      var i = 0;
      for (;;) {
        var l = 2 * i + 1,
          r = l + 1,
          m = i,
          mk = lastK;
        if (l < n && k[l] < mk) {
          m = l;
          mk = k[l];
        }
        if (r < n && k[r] < mk) m = r;
        if (m === i) break;
        k[i] = k[m];
        v[i] = v[m];
        i = m;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return topV;
  };

  /* ============================== GRAPH ============================== */

  function Graph(data) {
    var g = this;
    g.roads = data.roads;
    g.nodes = data.nodes;
    g.edges = data.edges; // [a, b, road, lengthM, parts]
    g.objects = data.objects || [];
    g.mPerPx = (data.meta && data.meta.m_per_px) || 1;
    g.R = g.roads.length;
    g.N = g.nodes.length;
    g.adj = [];
    g.nodeRoads = [];
    g.roadNodes = [];
    g.roadEdges = [];
    var i;
    for (i = 0; i < g.N; i++) {
      g.adj.push([]);
      g.nodeRoads.push([]);
    }
    for (i = 0; i < g.R; i++) {
      g.roadNodes.push(new Set());
      g.roadEdges.push([]);
    }
    g.edges.forEach(function (e, ei) {
      var a = e[0],
        b = e[1],
        r = e[2];
      g.adj[a].push(ei);
      if (b !== a) g.adj[b].push(ei);
      g.roadEdges[r].push(ei);
      g.roadNodes[r].add(a);
      g.roadNodes[r].add(b);
    });
    for (i = 0; i < g.R; i++) {
      g.roadNodes[i].forEach(function (n) {
        g.nodeRoads[n].push(i);
      });
    }
    // roads sharing at least one node with each road
    g.roadNeighbors = [];
    for (i = 0; i < g.R; i++) g.roadNeighbors.push(new Set());
    g.nodeRoads.forEach(function (rs) {
      for (var x = 0; x < rs.length; x++)
        for (var y = 0; y < rs.length; y++) if (x !== y) g.roadNeighbors[rs[x]].add(rs[y]);
    });
    g.roadByName = new Map();
    g.roads.forEach(function (r, i) {
      g.roadByName.set(r.n, i);
    });
    g._grid = null;
  }

  /* ---------- where an object's walk starts / ends ---------- */
  // [{node, road}]: stand at `node`, on `road` (one of the object's
  // attached roads passing through that node).
  Graph.prototype.anchorsOf = function (obj) {
    var g = this;
    var out = [];
    if (obj.a) {
      for (var i = 0; i < obj.a.length; i += 2) out.push({ node: obj.a[i], road: obj.a[i + 1] });
      return out;
    }
    if (obj.t === "square") {
      var attached = new Set(obj.r);
      var sq = g.roadByName.get(obj.n);
      g.roadNodes[sq].forEach(function (n) {
        g.nodeRoads[n].forEach(function (r) {
          if (attached.has(r)) out.push({ node: n, road: r });
        });
      });
      return out;
    }
    obj.r.forEach(function (r) {
      g.roadNodes[r].forEach(function (n) {
        out.push({ node: n, road: r });
      });
    });
    return out;
  };

  // {roads: Set of attached roads, at: Map node -> Set of roads you may
  // finish on there}
  Graph.prototype.targetFrom = function (roads, anchors) {
    var at = new Map();
    anchors.forEach(function (x) {
      if (!at.has(x.node)) at.set(x.node, new Set());
      at.get(x.node).add(x.road);
    });
    return { roads: new Set(roads), at: at };
  };

  Graph.prototype.targetOf = function (obj) {
    return this.targetFrom(obj.r, this.anchorsOf(obj));
  };

  // a street-like target: anywhere along any of `roads`
  Graph.prototype.targetOnRoads = function (roads) {
    return this.targetFrom(roads, this.sourcesOnRoads(roads));
  };

  Graph.prototype.other = function (ei, n) {
    var e = this.edges[ei];
    return e[0] === n ? e[1] : e[0];
  };

  // true if road r shares a node with any road in `set` (or is in it)
  Graph.prototype.touchesSet = function (r, set) {
    if (set.has(r)) return true;
    var nb = this.roadNeighbors[r];
    var hit = false;
    set.forEach(function (s) {
      if (nb.has(s)) hit = true;
    });
    return hit;
  };

  Graph.prototype.touches = function (r1, r2) {
    return r1 === r2 || this.roadNeighbors[r1].has(r2);
  };

  // plain multi-source Dijkstra over every edge; used as an exact lower
  // bound (distance to the target roads) to prune the tie-breaking search
  Graph.prototype.distancesFrom = function (sourceNodes) {
    var g = this;
    var dist = new Float64Array(g.N).fill(Infinity);
    var heap = new Heap();
    sourceNodes.forEach(function (n) {
      if (dist[n] > 0) {
        dist[n] = 0;
        heap.push(0, n);
      }
    });
    var done = new Uint8Array(g.N);
    while (heap.size()) {
      var n = heap.pop();
      if (done[n]) continue;
      done[n] = 1;
      var adj = g.adj[n];
      for (var i = 0; i < adj.length; i++) {
        var e = g.edges[adj[i]];
        var w = e[0] === n ? e[1] : e[0];
        var nd = dist[n] + e[3];
        if (nd < dist[w]) {
          dist[w] = nd;
          heap.push(nd, w);
        }
      }
    }
    return dist;
  };

  /* ---------- fastest path, with the 2% tie-break ---------- */
  // sources: [{node, road, dist}] - you are standing on `road` at `node`,
  // having already walked `dist` metres. target: from targetOf/targetFrom.
  //
  // Returns the fewest-road-change path among all paths within
  // (1 + tolerance) of the true shortest distance, and the shortest of
  // those. Two passes: an A* search finds the shortest distance under the
  // walk's rules; then a label-setting search ordered by (road changes,
  // distance) - a monotone lexicographic cost, so the first label that
  // reaches a target is optimal - prunes labels whose distance-so-far +
  // lower bound to the target exceeds that distance + 2%.
  //
  // Once the walk is on one of the target's roads it only continues along
  // that same road to an anchor: turning onto a target road is the last
  // step, never a middle one.
  Graph.prototype.fastestPath = function (sources, target, tolerance) {
    if (tolerance == null) tolerance = 0.02;
    var targetNodes = Array.from(target.at.keys());
    if (!targetNodes.length || !sources.length) return null;
    // exact distance-to-target ignoring the "stay on the target road" rule:
    // a consistent lower bound for both passes below
    var h = this.distancesFrom(targetNodes);
    // pass 1: the true shortest distance under the rules (A*)
    var shortest = this._search(sources, target, h, Infinity, false);
    if (!shortest) return null;
    // pass 2: fewest road changes within (1 + tolerance) of it
    var bound = shortest.dist * (1 + tolerance) + 0.5;
    return this._search(sources, target, h, bound, true) || shortest;
  };

  Graph.prototype._search = function (sources, target, h, bound, byChanges) {
    var g = this;
    var BIG = 1e9;
    var R = g.R;
    var settled = new Map();
    var heap = new Heap();
    function key(c, d, n) {
      return byChanges ? c * BIG + d : d + h[n];
    }
    sources.forEach(function (s) {
      var d = s.dist || 0;
      if (d + h[s.node] <= bound) heap.push(key(0, d, s.node), { node: s.node, road: s.road, c: 0, d: d, prev: null, edge: -1 });
    });
    while (heap.size()) {
      var L = heap.pop();
      var st = L.node * R + L.road;
      var seen = settled.get(st);
      if (seen !== undefined && L.d >= seen) continue;
      settled.set(st, L.d);

      var onTarget = target.roads.has(L.road);
      var finishHere = target.at.get(L.node);
      if (finishHere) {
        if (finishHere.has(L.road)) return g._pathFromLabel(L, L.road);
        if (!onTarget) return g._pathFromLabel(L, finishHere.values().next().value);
      }

      var adj = g.adj[L.node];
      for (var i = 0; i < adj.length; i++) {
        var ei = adj[i];
        var e = g.edges[ei];
        var q = e[2];
        if (onTarget && q !== L.road) continue;
        var w = e[0] === L.node ? e[1] : e[0];
        var nd = L.d + e[3];
        if (nd + h[w] > bound) continue;
        var s2 = settled.get(w * R + q);
        if (s2 !== undefined && nd >= s2) continue;
        var nc = L.c + (q !== L.road ? 1 : 0);
        heap.push(key(nc, nd, w), { node: w, road: q, c: nc, d: nd, prev: L, edge: ei });
      }
    }
    return null;
  };

  Graph.prototype._pathFromLabel = function (L, goalRoad) {
    var g = this;
    var chain = [];
    for (var x = L; x; x = x.prev) chain.push(x);
    chain.reverse();
    var steps = [{ road: chain[0].road, edges: [] }];
    for (var i = 1; i < chain.length; i++) {
      var e = chain[i].edge;
      var road = g.edges[e][2];
      var last = steps[steps.length - 1];
      if (road !== last.road) {
        last = { road: road, edges: [] };
        steps.push(last);
      }
      last.edges.push({ e: e, from: chain[i - 1].node, to: chain[i].node });
    }
    if (steps[steps.length - 1].road !== goalRoad) steps.push({ road: goalRoad, edges: [] });
    return {
      dist: L.d,
      steps: steps,
      roads: steps.map(function (s) {
        return s.road;
      }),
      startNode: chain[0].node,
      endNode: L.node,
    };
  };

  Graph.prototype.sourcesOnRoads = function (roads) {
    var g = this;
    var out = [];
    roads.forEach(function (r) {
      g.roadNodes[r].forEach(function (n) {
        out.push({ node: n, road: r, dist: 0 });
      });
    });
    return out;
  };

  /* ---------- shortest walk along a given road sequence ---------- */
  // Layered Dijkstra: layer 0 is "on one of the start roads" (entered at
  // one of `start` anchors), layer i is "on seq[i-1]". Within a layer you
  // may only walk along that layer's road; at a node on seq[i] you may turn
  // onto it (move to layer i+1) for free. With `target`, the walk must end
  // at one of the target's anchors for the last road (falling back to the
  // turn onto it if no anchor can be reached along that road).
  // Returns null if the sequence can't be walked at all (e.g. a road meets
  // the previous one only on a disconnected piece).
  Graph.prototype.layeredWalk = function (start, seq, target) {
    var g = this;
    var N = g.N,
      K = seq.length;
    var size = (K + 1) * N;
    var dist = new Float64Array(size).fill(Infinity);
    var prevState = new Int32Array(size).fill(-1);
    var prevEdge = new Int32Array(size).fill(-1);
    var done = new Uint8Array(size);
    var startRoads = new Set(
      start.map(function (x) {
        return x.road;
      })
    );
    var heap = new Heap();
    start.forEach(function (x) {
      if (dist[x.node] > 0) {
        dist[x.node] = 0;
        heap.push(0, x.node);
      }
    });
    function relax(s, d, from, e) {
      if (d < dist[s]) {
        dist[s] = d;
        prevState[s] = from;
        prevEdge[s] = e;
        heap.push(d, s);
      }
    }
    while (heap.size()) {
      var s = heap.pop();
      if (done[s]) continue;
      done[s] = 1;
      var layer = (s / N) | 0,
        n = s - layer * N,
        d = dist[s];
      if (layer < K && g.roadNodes[seq[layer]].has(n)) relax((layer + 1) * N + n, d, s, -1);
      var adj = g.adj[n];
      for (var i = 0; i < adj.length; i++) {
        var e = g.edges[adj[i]];
        var ok = layer === 0 ? startRoads.has(e[2]) : e[2] === seq[layer - 1];
        if (!ok) continue;
        var w = e[0] === n ? e[1] : e[0];
        relax(layer * N + w, d + e[3], s, adj[i]);
      }
    }
    var finalDists = new Map();
    var bestNode = -1,
      bestD = Infinity,
      anchorNode = -1,
      anchorD = Infinity;
    var last = K ? seq[K - 1] : -1;
    for (var v = 0; v < N; v++) {
      var dv = dist[K * N + v];
      if (dv === Infinity) continue;
      finalDists.set(v, dv);
      if (dv < bestD) {
        bestD = dv;
        bestNode = v;
      }
      if (target && target.at.has(v) && target.at.get(v).has(last) && dv < anchorD) {
        anchorD = dv;
        anchorNode = v;
      }
    }
    if (bestNode < 0) return null;
    if (anchorNode >= 0) {
      bestNode = anchorNode;
      bestD = anchorD;
    }
    var steps = seq.map(function (r) {
      return { road: r, edges: [] };
    });
    var chain = [];
    for (var cur = K * N + bestNode; cur >= 0; cur = prevState[cur]) chain.push(cur);
    chain.reverse();
    var firstEdges = [];
    for (var c = 1; c < chain.length; c++) {
      if (prevEdge[chain[c]] < 0) continue;
      var lay = (chain[c] / N) | 0;
      var step = { e: prevEdge[chain[c]], from: chain[c - 1] % N, to: chain[c] % N };
      if (lay === 0) firstEdges.push(step);
      else steps[lay - 1].edges.push(step);
    }
    return {
      dist: bestD,
      steps: steps,
      startEdges: firstEdges, // walked along A's own road(s) before the first named road
      roads: seq.slice(),
      finalDists: finalDists,
      startNode: chain[0] % N,
      endNode: bestNode,
    };
  };

  /* ---------- nearby roads (Easy-mode distractors) ---------- */

  var CELL_M = 150;

  Graph.prototype._ensureGrid = function () {
    if (this._grid) return;
    var cell = CELL_M / this.mPerPx;
    var grid = new Map();
    this.nodes.forEach(function (p, i) {
      var key = Math.floor(p[0] / cell) + ":" + Math.floor(p[1] / cell);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    });
    this._grid = grid;
    this._cellPx = cell;
  };

  // roads with at least one node within radiusM of a node of `roads`
  Graph.prototype.roadsNear = function (roads, radiusM) {
    var g = this;
    g._ensureGrid();
    var rPx = radiusM / g.mPerPx,
      r2 = rPx * rPx,
      cell = g._cellPx,
      span = Math.ceil(rPx / cell);
    var found = new Set();
    var checked = new Set();
    roads.forEach(function (road) {
      g.roadNodes[road].forEach(function (n) {
        var p = g.nodes[n];
        var cx = Math.floor(p[0] / cell),
          cy = Math.floor(p[1] / cell);
        for (var dx = -span; dx <= span; dx++)
          for (var dy = -span; dy <= span; dy++) {
            var bucket = g._grid.get(cx + dx + ":" + (cy + dy));
            if (!bucket) continue;
            for (var i = 0; i < bucket.length; i++) {
              var m = bucket[i];
              var key = n * g.N + m;
              if (checked.has(key)) continue;
              checked.add(key);
              var q = g.nodes[m];
              var ddx = q[0] - p[0],
                ddy = q[1] - p[1];
              if (ddx * ddx + ddy * ddy <= r2) {
                var rs = g.nodeRoads[m];
                for (var k = 0; k < rs.length; k++) found.add(rs[k]);
              }
            }
          }
      });
    });
    return found;
  };

  /* ============================== HELPERS ============================== */

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // deterministic RNG for tests (mulberry32)
  function seededRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function foldName(s) {
    return s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  }

  // Hard-mode dropdown: every walkable road, alphabetical (Dutch collation,
  // ignoring case/accents), filtered by a case- and accent-insensitive
  // "contains" match. Never filtered by validity - that would give the
  // answer away.
  function roadNameIndex(g) {
    var idx = g.roads.map(function (_, i) {
      return i;
    });
    idx.sort(function (a, b) {
      return g.roads[a].n.localeCompare(g.roads[b].n, "nl", { sensitivity: "base" }) || a - b;
    });
    return idx.map(function (i) {
      return { road: i, name: g.roads[i].n, folded: foldName(g.roads[i].n) };
    });
  }

  function filterRoadNames(index, query) {
    var q = foldName(String(query || "").trim());
    if (!q) return index;
    return index.filter(function (x) {
      return x.folded.indexOf(q) !== -1;
    });
  }

  /* ============================== ROUNDS ============================== */

  var MIN_STEPS = 3,
    MAX_STEPS = 8;

  // Easy-mode distractors for one step: roads that do NOT share any node
  // with the current road(s) - so the correct option is the only one that
  // continues the walk - and aren't on the route at all. Nearest first
  // (~300 m, widening 150 m at a time), preferring roads that share a
  // (non-review) lesson with the current or correct road.
  var DISTRACTOR_START_M = 300,
    DISTRACTOR_STEP_M = 150,
    DISTRACTOR_MAX_M = 1500;

  function pickDistractors(g, currentRoads, correct, routeRoads, rng) {
    var curSet = new Set(currentRoads);
    var cands = [];
    for (var radius = DISTRACTOR_START_M; radius <= DISTRACTOR_MAX_M; radius += DISTRACTOR_STEP_M) {
      cands = [];
      g.roadsNear(currentRoads, radius).forEach(function (r) {
        if (routeRoads.has(r) || g.touchesSet(r, curSet)) return;
        cands.push(r);
      });
      if (cands.length >= 3) break;
    }
    if (cands.length < 3) return null;
    var lessons = new Set();
    currentRoads.concat([correct]).forEach(function (r) {
      (g.roads[r].l || []).forEach(function (l) {
        lessons.add(l);
      });
    });
    var same = [],
      other = [];
    shuffle(cands, rng).forEach(function (r) {
      var shares = (g.roads[r].l || []).some(function (l) {
        return lessons.has(l);
      });
      (shares ? same : other).push(r);
    });
    return same.concat(other).slice(0, 3);
  }

  // One question per road the player has to name. If A is a street, the
  // walk starts on it, so the first question is the road after it.
  function easyQuestions(g, round, rng) {
    var steps = round.path.steps;
    var routeRoads = new Set(round.path.roads);
    var first = round.a.t === "road" ? 1 : 0;
    var qs = [];
    for (var i = first; i < steps.length; i++) {
      var current = i === 0 ? round.a.r.slice() : [steps[i - 1].road];
      var correct = steps[i].road;
      var d = pickDistractors(g, current, correct, routeRoads, rng);
      if (!d) return null;
      qs.push({ index: i, current: current, correct: correct, options: shuffle([correct].concat(d), rng) });
    }
    return qs;
  }

  function sharesRoad(a, b) {
    var s = new Set(a.r);
    return b.r.some(function (r) {
      return s.has(r);
    });
  }

  // The routing context for a pair of endpoints. startRoads/targets are the
  // road-level rules; start/target carry the anchors used for distance.
  function makeRound(g, a, b) {
    return {
      a: a,
      b: b,
      startRoads: a.r.slice(),
      start: g.anchorsOf(a),
      target: g.targetOf(b),
      targets: new Set(b.r),
    };
  }

  function generateRound(g, pool, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var mode = opts.mode || "easy";
    var maxTries = opts.maxTries || 600;
    if (pool.length < 2) return null;
    for (var t = 0; t < maxTries; t++) {
      var a = pool[Math.floor(rng() * pool.length)];
      var b = pool[Math.floor(rng() * pool.length)];
      if (a === b || sharesRoad(a, b)) continue;
      var round = makeRound(g, a, b);
      var path = g.fastestPath(round.start, round.target);
      if (!path || path.steps.length < MIN_STEPS || path.steps.length > MAX_STEPS) continue;
      round.path = path;
      round.mode = mode;
      if (mode === "easy") {
        var qs = easyQuestions(g, round, rng);
        if (!qs) continue;
        round.questions = qs;
      }
      round.tries = t + 1;
      return round;
    }
    return null;
  }

  /* ---------- Hard mode ---------- */

  // The road the player is standing on: the last one they entered, or A
  // itself if A is a street and nothing's been entered yet.
  function currentRoad(round, seq) {
    if (seq.length) return seq[seq.length - 1];
    return round.a.t === "road" ? round.a.r[0] : -1;
  }

  // ok: true -> {walk, done}; ok: false -> {reason: "same" | "nomeet"}
  // Validity is road-level, as specified: the new road must share a node
  // with the current road (or with one of A's roads, for the first entry) -
  // and be reachable along it, which the walk computation confirms.
  function hardEntry(g, round, seq, road) {
    var cur = currentRoad(round, seq);
    if (road === cur) return { ok: false, reason: "same" };
    var meets = seq.length ? g.touches(cur, road) : g.touchesSet(road, new Set(round.startRoads));
    if (!meets) return { ok: false, reason: "nomeet" };
    var done = round.targets.has(road);
    var walk = g.layeredWalk(round.start, seq.concat([road]), done ? round.target : null);
    if (!walk) return { ok: false, reason: "nomeet" };
    return { ok: true, walk: walk, done: done };
  }

  // Next road on the fastest path from where the player is NOW (they may
  // have left the original fastest path): recomputed from every point on
  // the current road they can actually stand on, carrying the distance
  // they've already walked to get there.
  function hardHint(g, round, seq) {
    var path, cur;
    if (!seq.length) {
      path = g.fastestPath(round.start, round.target);
      if (!path) return -1;
      cur = currentRoad(round, seq);
      return path.steps[0].road === cur ? path.steps[1].road : path.steps[0].road;
    }
    var walk = g.layeredWalk(round.start, seq);
    if (!walk) return -1;
    cur = seq[seq.length - 1];
    var sources = [];
    walk.finalDists.forEach(function (d, n) {
      sources.push({ node: n, road: cur, dist: d });
    });
    path = g.fastestPath(sources, round.target);
    if (!path || path.steps.length < 2) return -1;
    return path.steps[1].road;
  }

  /* ---------- geometry (drawn from MAP_DATA.bgStreets, not the graph) ---------- */

  function parseSubpaths(d) {
    return d
      .split("M ")
      .filter(function (s) {
        return s.trim();
      })
      .map(function (sp) {
        return sp
          .trim()
          .split(" L ")
          .map(function (xy) {
            var c = xy.split(",");
            return [+c[0], +c[1]];
          });
      });
  }

  // edge geometry as [[x,y],...] starting at node `fromNode`
  function edgePoints(g, subpaths, ei, fromNode) {
    var e = g.edges[ei];
    var parts = e[4];
    var pts = [];
    for (var p = 0; p < parts.length; p += 3) {
      var sp = subpaths[parts[p]],
        i0 = parts[p + 1],
        i1 = parts[p + 2];
      var stepDir = i1 >= i0 ? 1 : -1;
      for (var i = i0; ; i += stepDir) {
        if (!(pts.length && i === i0)) pts.push(sp[i]);
        if (i === i1) break;
      }
    }
    if (fromNode !== e[0]) pts.reverse();
    return pts;
  }

  return {
    Graph: Graph,
    generateRound: generateRound,
    makeRound: makeRound,
    easyQuestions: easyQuestions,
    pickDistractors: pickDistractors,
    hardEntry: hardEntry,
    hardHint: hardHint,
    currentRoad: currentRoad,
    foldName: foldName,
    roadNameIndex: roadNameIndex,
    filterRoadNames: filterRoadNames,
    shuffle: shuffle,
    seededRng: seededRng,
    parseSubpaths: parseSubpaths,
    edgePoints: edgePoints,
    MIN_STEPS: MIN_STEPS,
    MAX_STEPS: MAX_STEPS,
  };
});
