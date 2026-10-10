// Walk game page (Change Request 4): DOM, map drawing and game flow. All
// routing lives in walk.js; this file only asks it questions.
(function () {
  "use strict";

  var LS_KEY = "antwerpWalk.v1";
  var LEARN_LS_KEY = "antwerpRing.v1";

  var G = new Walk.Graph(STREET_GRAPH);
  var SUBPATHS = Walk.parseSubpaths(MAP_DATA.bgStreets);
  var NAME_INDEX = Walk.roadNameIndex(G);
  var FULL_W = MapRender.FULL_VB.w;

  /* ============================== STATE ============================== */

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch (e) {}
  }

  var saved = readJSON(LS_KEY) || {};
  var state = {
    mode: saved.mode === "hard" ? "hard" : "easy",
    filter: saved.filter === "started" ? "started" : "all",
    played: { easy: (saved.played && saved.played.easy) || 0, hard: (saved.played && saved.played.hard) || 0 },
    misses: saved.misses || 0,
    hints: saved.hints || 0,
  };

  function save() {
    writeJSON(LS_KEY, state);
  }

  function startedLessons() {
    var s = readJSON(LEARN_LS_KEY);
    var set = {};
    if (s && s.progress)
      Object.keys(s.progress).forEach(function (id) {
        if (s.progress[id] && s.progress[id].attempts) set[id] = true;
      });
    return set;
  }

  function currentPool() {
    if (state.filter !== "started") return G.objects;
    var started = startedLessons();
    return G.objects.filter(function (o) {
      return o.l.some(function (l) {
        return started[l];
      });
    });
  }

  /* ============================== HELPERS ============================== */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function roadName(r) {
    return G.roads[r].n;
  }

  function fmtDist(m) {
    return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km";
  }

  var TYPE_LABEL = { road: "street", square: "square", building: "building", park: "park" };

  function baseObj(o) {
    return MapRender.resolveObjectByName(o.n, o.t);
  }

  function pointsD(pts) {
    return "M " + pts.map(function (p) {
      return p[0] + "," + p[1];
    }).join(" L ");
  }

  function edgeD(ei, from) {
    return pointsD(Walk.edgePoints(G, SUBPATHS, ei, from));
  }

  function stepsD(steps, upTo) {
    var d = "";
    for (var k = 0; k < Math.min(upTo, steps.length); k++)
      steps[k].edges.forEach(function (e) {
        d += edgeD(e.e, e.from) + " ";
      });
    return d.trim();
  }

  function roadD(r) {
    return G.roadEdges[r]
      .map(function (ei) {
        return edgeD(ei, G.edges[ei][0]);
      })
      .join(" ");
  }

  // where the walker stands after turning onto steps[i]
  function turnNode(path, i) {
    var pos = path.startNode;
    for (var k = 0; k < i && k < path.steps.length; k++) {
      var ed = path.steps[k].edges;
      if (ed.length) pos = ed[ed.length - 1].to;
    }
    return pos;
  }

  function pathBBox(path) {
    var xs = [],
      ys = [];
    path.steps.forEach(function (s) {
      s.edges.forEach(function (e) {
        Walk.edgePoints(G, SUBPATHS, e.e, e.from).forEach(function (p) {
          xs.push(p[0]);
          ys.push(p[1]);
        });
      });
    });
    var n = G.nodes[path.startNode];
    xs.push(n[0]);
    ys.push(n[1]);
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }

  /* ============================== SHELL ============================== */

  var appEl = document.getElementById("view-walk");
  appEl.innerHTML =
    '<div class="walk-topbar">' +
    '<div class="walk-mode" role="group" aria-label="Difficulty">' +
    '<button data-mode="easy">Easy</button><button data-mode="hard">Hard</button></div>' +
    '<select class="walk-filter" id="walkFilter" aria-label="Which objects">' +
    '<option value="all">All objects</option><option value="started">Lessons I’ve started</option></select>' +
    "</div>" +
    '<div class="walk-prompt" id="walkPrompt"></div>' +
    '<div class="walk-map" id="walkMap"></div>' +
    '<div class="walk-panel" id="walkPanel"></div>' +
    '<div class="walk-entry hidden" id="walkEntry">' +
    '<div class="walk-dropdown hidden" id="walkDropdown" role="listbox"></div>' +
    '<div class="walk-entry-row">' +
    '<input id="walkInput" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type a road name…" aria-label="Road name">' +
    '<button class="walk-hint-btn" id="walkHardHint">Hint</button>' +
    "</div></div>";

  var promptEl = document.getElementById("walkPrompt");
  var mapEl = document.getElementById("walkMap");
  var panelEl = document.getElementById("walkPanel");
  var entryEl = document.getElementById("walkEntry");
  var dropdownEl = document.getElementById("walkDropdown");
  var inputEl = document.getElementById("walkInput");
  var filterEl = document.getElementById("walkFilter");

  function showEntry(on) {
    entryEl.classList.toggle("hidden", !on);
    appEl.classList.toggle("walk-has-entry", on);
  }

  function syncTopbar() {
    document.querySelectorAll(".walk-mode button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-mode") === state.mode);
    });
    filterEl.value = state.filter;
  }

  document.querySelectorAll(".walk-mode button").forEach(function (b) {
    b.addEventListener("click", function () {
      var m = b.getAttribute("data-mode");
      if (m === state.mode) return;
      state.mode = m;
      save();
      newRound();
    });
  });
  filterEl.addEventListener("change", function () {
    state.filter = filterEl.value;
    save();
    newRound();
  });

  // Keep the Hard-mode entry bar above the on-screen keyboard: iOS Safari
  // doesn't shrink the layout viewport for the keyboard, so a bottom-fixed
  // bar would sit behind it. visualViewport reports what's actually visible.
  function onViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", kb + "px");
    document.documentElement.style.setProperty("--vvh", vv.height + "px");
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onViewport);
    window.visualViewport.addEventListener("scroll", onViewport);
    onViewport();
  }

  /* ============================== ROUND ============================== */

  var R = null; // the round in progress

  function newRound() {
    syncTopbar();
    closeDropdown();
    var round = Walk.generateRound(G, currentPool(), { mode: state.mode });
    if (!round) {
      R = null;
      renderEmpty();
      return;
    }
    R = {
      round: round,
      mode: state.mode,
      misses: 0,
      hints: 0,
      qi: 0, // Easy: index into round.questions
      seq: [], // Hard: roads entered so far
      walk: null, // Hard: shortest walk along seq
      done: false,
      msg: null,
    };
    renderPrompt();
    renderMap();
    renderPanel();
  }

  function renderEmpty() {
    appEl.classList.remove("walk-done");
    promptEl.innerHTML = "";
    mapEl.innerHTML = "";
    showEntry(false);
    var started = state.filter === "started";
    panelEl.innerHTML =
      '<div class="walk-card walk-empty">' +
      (started
        ? "<p>Not enough places from lessons you’ve started to make a route yet.</p>" +
          '<button class="btn btn-primary" id="walkUseAll">Use all objects</button>'
        : "<p>Couldn’t find a route this time.</p>" +
          '<button class="btn btn-primary" id="walkRetry">Try again</button>') +
      "</div>";
    var b = document.getElementById(started ? "walkUseAll" : "walkRetry");
    b.addEventListener("click", function () {
      state.filter = "all";
      save();
      newRound();
    });
  }

  function renderPrompt() {
    var a = R.round.a,
      b = R.round.b;
    function end(letter, o) {
      return (
        '<div class="walk-end"><span class="walk-pin-chip walk-pin-' +
        letter.toLowerCase() +
        '">' +
        letter +
        '</span><div><div class="walk-end-name">' +
        esc(o.n) +
        '</div><div class="walk-end-type">' +
        TYPE_LABEL[o.t] +
        "</div></div></div>"
      );
    }
    promptEl.innerHTML = end("A", a) + '<div class="walk-arrow" aria-hidden="true">&rarr;</div>' + end("B", b);
  }

  /* ---------- map ---------- */

  var svg = null,
    controller = null;

  function mapAspect() {
    // the svg's own box: the map container adds a border top and bottom
    var r = (svg || mapEl).getBoundingClientRect();
    return r.width && r.height ? r.width / r.height : MapRender.MAP_ASPECT;
  }
  // re-fit when the map's box changes: a message appearing in the panel,
  // rotation, or coming back from another tab
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      if (controller && mapEl.clientHeight) controller.resize();
    }).observe(mapEl);
  }
  AppShell.register("walk", {
    onShow: function () {
      if (controller) controller.resize();
    },
  });

  function localPx(px) {
    // badge-style groups are drawn in local units and scaled with the
    // viewBox so they keep a constant on-screen size; convert from pixels
    var w = svg.getBoundingClientRect().width || 390;
    return (px * FULL_W) / w;
  }

  function currentScale() {
    var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    return vb[2] / FULL_W;
  }

  function badgeGroup(cls, x, y, inner) {
    return (
      '<g class="badge ' +
      cls +
      '" data-bx="' +
      x +
      '" data-by="' +
      y +
      '" transform="translate(' +
      x +
      "," +
      y +
      ") scale(" +
      currentScale() +
      ')">' +
      inner +
      "</g>"
    );
  }

  function endFootprint(o, letter) {
    var b = baseObj(o);
    if (!b) return "";
    var cls = b.kind === "line" ? "walk-end-line" : "walk-end-poly";
    return '<path class="' + cls + " walk-end-" + letter + '" d="' + b.d + '"/>';
  }

  function renderMap() {
    var round = R.round;
    var boxes = [pathBBox(round.path)];
    [round.a, round.b].forEach(function (o) {
      var b = baseObj(o);
      if (b) boxes.push(b.bbox);
    });
    var bbox = MapRender.unionBBox(boxes);
    mapEl.innerHTML =
      '<svg id="walkSvg" viewBox="' +
      MAP_DATA.viewBox +
      '" xmlns="http://www.w3.org/2000/svg">' +
      MapRender.sceneryLayersSVG() +
      '<g id="wEnds">' +
      endFootprint(round.a, "a") +
      endFootprint(round.b, "b") +
      "</g>" +
      '<g id="wFastest"></g><g id="wPath"></g><g id="wFlash"></g><g id="wMarks"></g><g id="wLabels"></g>' +
      "</svg>" +
      '<button class="map-recenter" id="walkRecenter" aria-label="Recenter map" title="Recenter">⤢</button>';
    svg = document.getElementById("walkSvg");
    // the map takes whatever height the panel leaves, so its shape varies
    controller = MapRender.createMapController(svg, bbox, null, { aspect: mapAspect });
    document.getElementById("walkRecenter").addEventListener("click", function () {
      controller.reset();
    });
    drawPins();
  }

  function drawPins(hereNode) {
    var r = localPx(11);
    var font = localPx(13);
    function pin(letter, o) {
      return badgeGroup(
        "walk-pin walk-pin-" + letter.toLowerCase(),
        o.p[0],
        o.p[1],
        '<circle r="' + r + '"/><text y="' + font * 0.06 + '" style="font-size:' + font + 'px">' + letter + "</text>"
      );
    }
    var marks = pin("A", R.round.a) + pin("B", R.round.b);
    if (hereNode != null) {
      var p = G.nodes[hereNode];
      marks += badgeGroup("walk-here", p[0], p[1], '<circle r="' + localPx(6) + '"/>');
    }
    document.getElementById("wMarks").innerHTML = marks;
  }

  // a Hard walk as steps, including the stretch along A's own road(s)
  // before the first named road
  function walkSteps(walk) {
    return [{ road: -1, edges: walk.startEdges || [] }].concat(walk.steps);
  }

  function drawWalk(steps, upTo, hereNode) {
    var d = stepsD(steps, upTo);
    document.getElementById("wPath").innerHTML = d ? '<path class="walk-line" d="' + d + '"/>' : "";
    drawPins(hereNode);
  }

  var flashTimer = null;
  function flashRoad(r) {
    var layer = document.getElementById("wFlash");
    if (!layer) return;
    layer.innerHTML = '<path class="walk-flash" d="' + roadD(r) + '"/>';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      layer.innerHTML = "";
    }, 1600);
  }

  /* ---------- post-round labels ---------- */
  // One label per road, placed along that road's walked stretch (or at the
  // junction, for a road the walk only turned onto/crossed). Candidate
  // spots are tried middle-first, each also nudged above and below; the
  // first that doesn't overlap an already-placed label or pin wins. If none
  // is free the label is left off rather than drawn over another one - the
  // full road list is right below the map. Judged in screen pixels at the
  // current zoom.

  var LABEL_PX = 11;

  function screenMapper() {
    var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    var k = (svg.getBoundingClientRect().width || 390) / vb[2];
    return function (p) {
      return [(p[0] - vb[0]) * k, (p[1] - vb[1]) * k];
    };
  }

  function box(cx, cy, w, h) {
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  }

  function overlap(a, b) {
    var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    var h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function occupiedByPins() {
    var toScreen = screenMapper();
    var out = [];
    [R.round.a, R.round.b].forEach(function (o) {
      var p = toScreen(o.p);
      out.push(box(p[0], p[1], 26, 26));
    });
    return out;
  }

  function labelsFor(path, labelled, placed) {
    var toScreen = screenMapper();
    var font = localPx(LABEL_PX);
    var out = "";
    path.steps.forEach(function (s, i) {
      if (s.road < 0 || labelled[s.road]) return;
      labelled[s.road] = true;
      var name = roadName(s.road);
      var w = name.length * LABEL_PX * 0.56 + 6,
        h = LABEL_PX + 4;
      var pts = [];
      s.edges.forEach(function (e) {
        pts = pts.concat(Walk.edgePoints(G, SUBPATHS, e.e, e.from));
      });
      var cands = [];
      if (pts.length) {
        [0.5, 0.3, 0.7, 0.15, 0.85].forEach(function (f) {
          cands.push(pts[Math.min(pts.length - 1, Math.floor(pts.length * f))]);
        });
      } else {
        var n = G.nodes[turnNode(path, i)];
        var off = localPx(14) * currentScale();
        cands = [n, [n[0], n[1] - off], [n[0], n[1] + off]];
      }
      var vbw = +svg.getAttribute("viewBox").split(/\s+/)[2];
      var worldPerPx = vbw / (svg.getBoundingClientRect().width || 390);
      var best = null;
      outer: for (var c = 0; c < cands.length; c++) {
        var offsets = [0, -h, h, -2 * h, 2 * h];
        for (var o = 0; o < offsets.length; o++) {
          var pt = [cands[c][0], cands[c][1] + offsets[o] * worldPerPx];
          var sp = toScreen(pt);
          var b = box(sp[0], sp[1], w, h);
          var free = placed.every(function (q) {
            return overlap(b, q) === 0;
          });
          if (free) {
            best = { pt: pt, box: b };
            break outer;
          }
        }
      }
      if (!best) return;
      placed.push(best.box);
      out += badgeGroup(
        "walk-label",
        best.pt[0],
        best.pt[1],
        '<text style="font-size:' + font + 'px">' + esc(name) + "</text>"
      );
    });
    return out;
  }

  function roadInView(r) {
    var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    var hit = false;
    G.roadNodes[r].forEach(function (n) {
      var p = G.nodes[n];
      if (p[0] >= vb[0] && p[0] <= vb[0] + vb[2] && p[1] >= vb[1] && p[1] <= vb[1] + vb[3]) hit = true;
    });
    return hit;
  }

  /* ---------- panel ---------- */

  function renderPanel() {
    // the end-of-round summary is long: keep the map big, scroll the card
    appEl.classList.toggle("walk-done", !!R.done);
    if (R.done) return renderSummary();
    if (R.mode === "easy") renderEasy();
    else renderHard();
  }

  function messageHTML() {
    if (!R.msg) return "";
    return '<div class="walk-msg ' + R.msg.kind + '">' + esc(R.msg.text) + "</div>";
  }

  /* ---------- Easy ---------- */

  function renderEasy() {
    showEntry(false);
    var round = R.round;
    var q = round.questions[R.qi];
    var steps = round.path.steps;
    // Name A and B when they're places rather than streets: "Which road at
    // Sint-Pauluskerk...", "...Which road takes you to Stadspark?" (a street
    // B is already the answer's own name, so its last question stays plain)
    var last = q.index === steps.length - 1;
    var ask =
      q.index === 0
        ? "Which road at " + round.a.n + " do you start on?"
        : "You’re on " +
          roadName(q.current[0]) +
          (last && round.b.t !== "road" ? ". Which road takes you to " + round.b.n + "?" : ". Which road next?");
    // The route so far, including the road you're on now, drawn up to the
    // junction where the next turn is - with the dot there. (Easy follows
    // the fastest path, so that junction is known; the wrong options never
    // touch the current road, so marking it gives none of them away.)
    drawWalk(steps, q.index, q.index >= 1 ? turnNode(round.path, q.index) : null);
    var html =
      '<div class="walk-card">' +
      '<div class="walk-step-label">Step ' +
      (q.index + 1) +
      " of " +
      steps.length +
      "</div>" +
      '<div class="walk-ask">' +
      esc(ask) +
      "</div>" +
      messageHTML() +
      '<div class="walk-options">' +
      q.options
        .map(function (r) {
          var cls = "walk-option";
          if (R.wrong && R.wrong[r]) cls += " wrong";
          return (
            '<button class="' +
            cls +
            '" data-road="' +
            r +
            '"' +
            (R.wrong && R.wrong[r] ? " disabled" : "") +
            ">" +
            esc(roadName(r)) +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      "</div>";
    panelEl.innerHTML = html;
    panelEl.querySelectorAll(".walk-option").forEach(function (b) {
      b.addEventListener("click", function () {
        easyPick(parseInt(b.getAttribute("data-road"), 10));
      });
    });
  }

  function easyPick(r) {
    var round = R.round;
    var q = round.questions[R.qi];
    if (r !== q.correct) {
      R.misses++;
      R.wrong = R.wrong || {};
      R.wrong[r] = true;
      R.msg = { kind: "bad", text: roadName(r) + " doesn’t continue from here — it’s flashing on the map." };
      flashRoad(r);
      renderEasy();
      return;
    }
    R.wrong = {};
    R.msg = { kind: "good", text: "Yes — " + roadName(r) + "." };
    R.qi++;
    if (R.qi >= round.questions.length) return finish();
    renderEasy();
  }

  /* ---------- Hard ---------- */

  function hardCurrentName() {
    var cur = Walk.currentRoad(R.round, R.seq);
    return cur >= 0 ? roadName(cur) : null;
  }

  function renderHard() {
    var round = R.round;
    var cur = hardCurrentName();
    var chips = [];
    if (round.a.t === "road") chips.push(round.a.r[0]);
    chips = chips.concat(R.seq);
    var html =
      '<div class="walk-card">' +
      '<div class="walk-ask">' +
      (cur
        ? "You’re on <strong>" + esc(cur) + "</strong>. Name the next road."
        : "Name a road at <strong>" + esc(round.a.n) + "</strong> to start on.") +
      "</div>" +
      messageHTML() +
      (chips.length
        ? '<div class="walk-chips">' +
          chips
            .map(function (r) {
              return '<span class="walk-chip">' + esc(roadName(r)) + "</span>";
            })
            .join('<span class="walk-chip-sep">›</span>') +
          "</div>"
        : "") +
      "</div>";
    panelEl.innerHTML = html;
    showEntry(true);
  }

  function hardSubmit(road, viaHint) {
    var round = R.round;
    var res = Walk.hardEntry(G, round, R.seq, road);
    inputEl.value = "";
    closeDropdown();
    if (!res.ok) {
      if (res.reason === "same") {
        R.msg = { kind: "info", text: "You’re already on " + roadName(road) + "." };
      } else {
        R.misses++;
        var cur = hardCurrentName();
        R.msg = {
          kind: "bad",
          text:
            roadName(road) +
            " doesn’t meet " +
            (cur || "A (" + round.a.n + ")") +
            "." +
            (roadInView(road) ? "" : " (It’s outside this map view.)"),
        };
        flashRoad(road);
      }
      renderHard();
      return;
    }
    R.seq.push(road);
    R.walk = res.walk;
    var turns = R.seq.length + (round.a.t === "road" ? 1 : 0);
    var ws = walkSteps(res.walk);
    drawWalk(ws, ws.length, turns >= 2 ? res.walk.endNode : null);
    R.msg = viaHint
      ? { kind: "info", text: "Hint: turn onto " + roadName(road) + "." }
      : { kind: "good", text: "OK — " + roadName(road) + "." };
    if (res.done) return finish();
    renderHard();
  }

  document.getElementById("walkHardHint").addEventListener("click", function () {
    if (!R || R.done || R.mode !== "hard") return;
    var h = Walk.hardHint(G, R.round, R.seq);
    if (h < 0) return;
    R.hints++;
    hardSubmit(h, true);
  });

  /* ---------- dropdown ---------- */

  var ddItems = [];

  function openDropdown() {
    ddItems = Walk.filterRoadNames(NAME_INDEX, inputEl.value);
    dropdownEl.innerHTML = ddItems.length
      ? ddItems
          .map(function (it, i) {
            return (
              '<div class="walk-row' +
              (i === 0 ? " top" : "") +
              '" role="option" data-road="' +
              it.road +
              '">' +
              esc(it.name) +
              "</div>"
            );
          })
          .join("")
      : '<div class="walk-row empty">No road matches</div>';
    dropdownEl.classList.remove("hidden");
    dropdownEl.scrollTop = 0;
  }

  function closeDropdown() {
    dropdownEl.classList.add("hidden");
  }

  inputEl.addEventListener("focus", openDropdown);
  inputEl.addEventListener("input", openDropdown);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (ddItems.length && inputEl.value.trim()) hardSubmit(ddItems[0].road, false);
    } else if (e.key === "Escape") {
      closeDropdown();
      inputEl.blur();
    }
  });
  // pointerdown (not click) so selecting a row happens before the input's
  // blur closes the dropdown; preventDefault keeps the keyboard up
  dropdownEl.addEventListener("pointerdown", function (e) {
    var row = e.target.closest(".walk-row[data-road]");
    if (!row) return;
    e.preventDefault();
    hardSubmit(parseInt(row.getAttribute("data-road"), 10), false);
  });
  inputEl.addEventListener("blur", function () {
    setTimeout(closeDropdown, 150);
  });

  /* ============================== SUMMARY ============================== */

  function finish() {
    R.done = true;
    R.msg = null;
    inputEl.blur();
    closeDropdown();
    showEntry(false);
    state.played[R.mode] = (state.played[R.mode] || 0) + 1;
    state.misses += R.misses;
    state.hints += R.hints;
    save();
    renderPanel();
  }

  function seqList(roads) {
    return (
      "<ol>" +
      roads
        .map(function (r) {
          return "<li>" + esc(roadName(r)) + "</li>";
        })
        .join("") +
      "</ol>"
    );
  }

  function renderSummary() {
    var round = R.round;
    var fastest = round.path;
    var labelled = {};
    var playerRoads, playerDist, comparison = "";

    if (R.mode === "easy") {
      playerRoads = fastest.roads;
      playerDist = fastest.dist;
      drawWalk(fastest.steps, fastest.steps.length, fastest.endNode);
      document.getElementById("wLabels").innerHTML = labelsFor(fastest, labelled, occupiedByPins());
    } else {
      playerRoads = (round.a.t === "road" ? [round.a.r[0]] : []).concat(R.seq);
      playerDist = R.walk.dist;
      document.getElementById("wFastest").innerHTML =
        '<path class="walk-fastest-line" d="' + stepsD(fastest.steps, fastest.steps.length) + '"/>';
      var ws = walkSteps(R.walk);
      drawWalk(ws, ws.length, R.walk.endNode);
      var placed = occupiedByPins();
      document.getElementById("wLabels").innerHTML =
        labelsFor({ steps: ws, startNode: R.walk.startNode }, labelled, placed) + labelsFor(fastest, labelled, placed);
      var extra = playerDist - fastest.dist;
      comparison =
        extra <= 0.5
          ? '<div class="walk-compare good">You found the fastest route ✓</div>'
          : '<div class="walk-compare">+' +
            fmtDist(extra) +
            " (" +
            Math.round((extra / fastest.dist) * 100) +
            "%) longer than the fastest route</div>";
    }

    var html =
      '<div class="walk-card walk-summary">' +
      // "New route" sits beside the heading so it's reachable without scrolling
      '<div class="walk-summary-head"><h2>You reached B</h2>' +
      '<button class="btn btn-primary" id="walkNext">New route</button></div>' +
      '<div class="walk-stats">' +
      stat("Road steps", playerRoads.length) +
      stat("Misses", R.misses) +
      (R.mode === "hard" ? stat("Hints", R.hints) : "") +
      stat("Distance", fmtDist(playerDist)) +
      "</div>" +
      comparison +
      (R.mode === "hard"
        ? '<div class="walk-columns"><div><div class="walk-col-head"><span class="swatch you"></span>Your route &middot; ' +
          fmtDist(playerDist) +
          "</div>" +
          seqList(playerRoads) +
          '</div><div><div class="walk-col-head"><span class="swatch fast"></span>Fastest &middot; ' +
          fmtDist(fastest.dist) +
          "</div>" +
          seqList(fastest.roads) +
          "</div></div>"
        : '<div class="walk-col-head"><span class="swatch you"></span>Route &middot; ' + fmtDist(fastest.dist) + "</div>" + seqList(playerRoads)) +
      "</div>";
    panelEl.innerHTML = html;
    document.getElementById("walkNext").addEventListener("click", newRound);
  }

  function stat(label, value) {
    return '<div class="walk-stat"><div class="v">' + value + '</div><div class="l">' + label + "</div></div>";
  }

  newRound();
})();
