(function () {
  "use strict";

  var LS_KEY = "antwerpRing.v1";
  var PASS_THRESHOLD = 0.7;

  /* ============================== NAME RESOLUTION ============================== */

  function norm(s) {
    return s
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s+\)/g, ")")
      .replace(/\(\s+/g, "(")
      .toUpperCase();
  }

  function resolveObject(curriculumObj) {
    var bucket = MAP_DATA.objects[curriculumObj.type];
    if (!bucket) return null;
    return bucket[norm(curriculumObj.name)] || null;
  }

  /* ============================== CURRICULUM INDEX ============================== */

  var MODULES_BY_ID = {};
  var MODULE_ORDER = [];

  (function buildIndex() {
    CURRICULUM.super_sections.forEach(function (ss) {
      ss.sections.forEach(function (sec) {
        sec.modules.forEach(function (mod) {
          MODULES_BY_ID[mod.id] = {
            id: mod.id,
            title: mod.title,
            objects: mod.objects,
            ssId: ss.id,
            ssTitle: ss.title,
            secId: sec.id,
            secTitle: sec.title,
          };
          MODULE_ORDER.push(mod.id);
        });
      });
    });
  })();

  /* ============================== STATE / PERSISTENCE ============================== */

  function defaultState() {
    return { progress: {}, lastOpened: null, openSections: {} };
  }

  var state = loadState();

  function loadState() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var d = defaultState();
      return {
        progress: parsed.progress || d.progress,
        lastOpened: parsed.lastOpened || d.lastOpened,
        openSections: parsed.openSections || d.openSections,
      };
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function resetState() {
    state = defaultState();
    saveState();
    router();
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function pct(n) {
    return Math.round(n * 100) + "%";
  }

  /* ============================== ROUTER ============================== */

  var appEl = document.getElementById("app");
  var route = { screen: "home" };

  function go(newRoute) {
    route = newRoute;
    router();
    window.scrollTo(0, 0);
  }

  function router() {
    if (route.screen === "module") {
      renderModuleScreen(route.moduleId);
    } else {
      renderHome();
    }
  }

  /* ============================== HOME SCREEN ============================== */

  function brandMark() {
    return (
      '<svg class="brand-mark" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="180" height="180" fill="#f6f3ec" rx="26"/>' +
      '<path d="' +
      MAP_DATA.iconPath +
      '" fill="#c85a2e"/>' +
      "</svg>"
    );
  }

  function objectCountLabel(mod) {
    return mod.objects.length + (mod.objects.length === 1 ? " object" : " objects");
  }

  function moduleBadge(modId) {
    var prog = state.progress[modId];
    if (!prog || !prog.attempts) return "";
    return '<div class="m-badge">' + pct(prog.bestScore) + "</div>";
  }

  function renderHome() {
    var html = "";
    html +=
      '<div class="home-header">' +
      brandMark() +
      "<div><h1>Antwerp Inside the Ring</h1>" +
      '<div class="sub">' +
      CURRICULUM.super_sections.length +
      " super sections &middot; " +
      MODULE_ORDER.length +
      " modules</div></div></div>";

    if (state.lastOpened && MODULES_BY_ID[state.lastOpened]) {
      var lm = MODULES_BY_ID[state.lastOpened];
      html +=
        '<div class="resume-card" id="resumeCard">' +
        '<div><div class="label">Continue</div>' +
        '<div class="title">' +
        lm.id +
        " &middot; " +
        lm.title +
        "</div></div><div>&rarr;</div></div>";
    }

    CURRICULUM.super_sections.forEach(function (ss) {
      var isOpen = !!state.openSections[ss.id];
      html += '<div class="super-section' + (isOpen ? " open" : "") + '" data-ss="' + ss.id + '">';
      html +=
        '<div class="ss-header" data-toggle-ss="' +
        ss.id +
        '"><div class="ss-num">' +
        ss.id +
        '</div><div class="ss-title"><h2>' +
        ss.title +
        '</h2><div class="ss-sub">' +
        ss.sections.length +
        " sections</div></div>" +
        '<div class="chevron">&#9656;</div></div>';
      html += '<div class="ss-body">';
      ss.sections.forEach(function (sec) {
        html += '<div class="section-block"><div class="sec-title">' + sec.id + " &middot; " + sec.title + "</div>";
        sec.modules.forEach(function (mod) {
          html +=
            '<div class="module-row" data-open-module="' +
            mod.id +
            '"><div class="m-id">' +
            mod.id +
            '</div><div class="m-info"><div class="m-title">' +
            mod.title +
            '</div><div class="m-count">' +
            objectCountLabel(mod) +
            "</div></div>" +
            moduleBadge(mod.id) +
            "</div>";
        });
        html += "</div>";
      });
      html += "</div></div>";
    });

    html += '<div class="reset-row"><button class="link-btn" id="resetBtn">Reset all progress</button></div>';

    appEl.innerHTML = html;

    var resumeCard = document.getElementById("resumeCard");
    if (resumeCard) {
      resumeCard.addEventListener("click", function () {
        openModule(state.lastOpened);
      });
    }

    document.querySelectorAll("[data-toggle-ss]").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-toggle-ss");
        state.openSections[id] = !state.openSections[id];
        saveState();
        renderHome();
      });
    });

    document.querySelectorAll("[data-open-module]").forEach(function (el) {
      el.addEventListener("click", function () {
        openModule(el.getAttribute("data-open-module"));
      });
    });

    document.getElementById("resetBtn").addEventListener("click", function () {
      document.getElementById("resetModal").hidden = false;
    });
  }

  function openModule(moduleId) {
    state.lastOpened = moduleId;
    saveState();
    go({ screen: "module", moduleId: moduleId, mode: "learn" });
  }

  /* ============================== VIEWPORT / PAN & ZOOM ============================== */

  function parseViewBox(s) {
    var p = s.trim().split(/\s+/).map(Number);
    return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }

  var FULL_VB = parseViewBox(MAP_DATA.viewBox);
  var MAP_ASPECT = FULL_VB.w / FULL_VB.h;
  var MIN_VB_W = 12; // deepest allowed zoom-in, in world units
  var FIT_PADDING = 0.4; // fraction of the module's own extent added as margin
  var FIT_MIN_SIZE = 70; // floor on the fitted viewBox width, so a single tiny

  // object (one small building) doesn't zoom in absurdly far.

  function unionBBox(boxes) {
    var minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    boxes.forEach(function (b) {
      if (b[0] < minX) minX = b[0];
      if (b[1] < minY) minY = b[1];
      if (b[2] > maxX) maxX = b[2];
      if (b[3] > maxY) maxY = b[3];
    });
    return [minX, minY, maxX, maxY];
  }

  function clampViewBox(vb) {
    var w = Math.min(Math.max(vb.w, MIN_VB_W), FULL_VB.w);
    var h = w / MAP_ASPECT;
    var minX = FULL_VB.x - w * 0.9;
    var maxX = FULL_VB.x + FULL_VB.w - w * 0.1;
    var minY = FULL_VB.y - h * 0.9;
    var maxY = FULL_VB.y + FULL_VB.h - h * 0.1;
    return {
      x: Math.min(Math.max(vb.x, minX), maxX),
      y: Math.min(Math.max(vb.y, minY), maxY),
      w: w,
      h: h,
    };
  }

  function fitViewBoxForBBox(bbox) {
    var w = Math.max(bbox[2] - bbox[0], 1);
    var h = Math.max(bbox[3] - bbox[1], 1);
    var cx = (bbox[0] + bbox[2]) / 2;
    var cy = (bbox[1] + bbox[3]) / 2;
    w *= 1 + FIT_PADDING * 2;
    h *= 1 + FIT_PADDING * 2;
    w = Math.max(w, FIT_MIN_SIZE);
    h = Math.max(h, FIT_MIN_SIZE / MAP_ASPECT);
    if (w / h < MAP_ASPECT) {
      w = h * MAP_ASPECT;
    } else {
      h = w / MAP_ASPECT;
    }
    // Fully contain the fitted window within the real map extent (rather
    // than the looser pan clamp, which permits overscroll during
    // interaction but would otherwise leave a large/whole-map module
    // off-center here).
    if (w >= FULL_VB.w || h >= FULL_VB.h) {
      return { x: FULL_VB.x, y: FULL_VB.y, w: FULL_VB.w, h: FULL_VB.h };
    }
    var x = Math.min(Math.max(cx - w / 2, FULL_VB.x), FULL_VB.x + FULL_VB.w - w);
    var y = Math.min(Math.max(cy - h / 2, FULL_VB.y), FULL_VB.y + FULL_VB.h - h);
    return { x: x, y: y, w: w, h: h };
  }

  function createMapController(svg, homeBBox, onTap) {
    var home = fitViewBoxForBBox(homeBBox);
    var vb = { x: home.x, y: home.y, w: home.w, h: home.h };

    function apply() {
      svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
      rescaleBadges();
    }

    function rescaleBadges() {
      var s = vb.w / FULL_VB.w;
      var badges = svg.querySelectorAll(".badge");
      for (var i = 0; i < badges.length; i++) {
        var g = badges[i];
        g.setAttribute(
          "transform",
          "translate(" + g.getAttribute("data-bx") + "," + g.getAttribute("data-by") + ") scale(" + s + ")"
        );
      }
    }

    function reset() {
      vb = { x: home.x, y: home.y, w: home.w, h: home.h };
      apply();
    }

    function clientToUser(clientX, clientY) {
      var rect = svg.getBoundingClientRect();
      return {
        x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
        y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
      };
    }

    function zoomAt(clientX, clientY, factor) {
      var before = clientToUser(clientX, clientY);
      var rect = svg.getBoundingClientRect();
      var newW = vb.w / factor;
      var clamped = clampViewBox({ x: vb.x, y: vb.y, w: newW, h: newW / MAP_ASPECT });
      vb.w = clamped.w;
      vb.h = clamped.h;
      vb.x = before.x - ((clientX - rect.left) / rect.width) * vb.w;
      vb.y = before.y - ((clientY - rect.top) / rect.height) * vb.h;
      var reclamped = clampViewBox(vb);
      vb = reclamped;
      apply();
    }

    function dist(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    var pointers = {};
    var dragLast = null;
    var pinchStartDist = null;
    var startPointerPos = null;
    var moved = 0;
    var lastTapTime = 0;
    var lastTapPos = null;

    function pointerIds() {
      return Object.keys(pointers);
    }

    svg.style.touchAction = "none";

    svg.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = pointerIds();
      if (ids.length === 1) {
        dragLast = { x: e.clientX, y: e.clientY };
        startPointerPos = { x: e.clientX, y: e.clientY };
        moved = 0;
      } else if (ids.length === 2) {
        var p = ids.map(function (id) {
          return pointers[id];
        });
        pinchStartDist = dist(p[0], p[1]);
        dragLast = null;
      }
    });

    svg.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = pointerIds();
      if (ids.length === 1 && dragLast) {
        var dx = e.clientX - dragLast.x;
        var dy = e.clientY - dragLast.y;
        moved += Math.abs(dx) + Math.abs(dy);
        var rect = svg.getBoundingClientRect();
        vb.x -= (dx / rect.width) * vb.w;
        vb.y -= (dy / rect.height) * vb.h;
        var clamped = clampViewBox(vb);
        vb.x = clamped.x;
        vb.y = clamped.y;
        dragLast = { x: e.clientX, y: e.clientY };
        apply();
      } else if (ids.length === 2 && pinchStartDist != null) {
        var pts = ids.map(function (id) {
          return pointers[id];
        });
        var d = dist(pts[0], pts[1]);
        var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        var factor = d / pinchStartDist;
        if (factor && isFinite(factor) && factor > 0) {
          zoomAt(mid.x, mid.y, factor);
        }
        pinchStartDist = d;
      }
    });

    function handleTap(clientX, clientY) {
      var el = document.elementFromPoint(clientX, clientY);
      if (!el) return;
      var t = el.closest("[data-idx]");
      if (!t) return;
      onTap(parseInt(t.getAttribute("data-idx"), 10));
    }

    function endPointer(e) {
      var wasSingle = pointerIds().length === 1;
      var startPos = startPointerPos;
      delete pointers[e.pointerId];
      var ids = pointerIds();
      if (ids.length < 2) pinchStartDist = null;
      if (ids.length === 0) {
        dragLast = null;
        if (wasSingle && moved < 10 && startPos) {
          var now = Date.now();
          if (lastTapPos && now - lastTapTime < 320 && dist(lastTapPos, startPos) < 24) {
            zoomAt(startPos.x, startPos.y, 1.8);
            lastTapTime = 0;
            lastTapPos = null;
          } else {
            lastTapTime = now;
            lastTapPos = startPos;
            handleTap(startPos.x, startPos.y);
          }
        }
        startPointerPos = null;
      } else if (ids.length === 1) {
        var remaining = pointers[ids[0]];
        dragLast = { x: remaining.x, y: remaining.y };
      }
    }

    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", endPointer);

    svg.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false }
    );

    apply();
    return { reset: reset };
  }

  /* ============================== MAP RENDERING ============================== */

  function metaLine(curObj, baseObj) {
    var lengthM = curObj.length_m != null ? curObj.length_m : baseObj && baseObj.length_m;
    var areaM2 = curObj.area_m2 != null ? curObj.area_m2 : baseObj && baseObj.area_m2;
    var isChurch = curObj.is_church != null ? curObj.is_church : baseObj && baseObj.is_church;
    switch (curObj.type) {
      case "road":
      case "square":
      case "waterway":
        return lengthM != null ? (lengthM / 1000).toFixed(2) + " km shown inside the ring" : "";
      case "building":
        return areaM2 != null
          ? areaM2.toLocaleString() + " m² footprint" + (isChurch ? " · Church" : "")
          : isChurch
          ? "Church"
          : "";
      case "park":
        return baseObj && baseObj.park_type === "buurtpark" ? "Neighborhood park (buurtpark)" : "Park";
      case "neighborhood":
        if (curObj.object_count != null && curObj.region) {
          return curObj.object_count + " tracked object" + (curObj.object_count === 1 ? "" : "s") + " · " + curObj.region;
        }
        var density = baseObj && baseObj.density;
        return density != null && density >= 0 ? "~" + Math.round(density) + " people/km²" : "Neighborhood";
      default:
        return "";
    }
  }

  var TREE_DEFS =
    '<defs>' +
    '<symbol id="tree-ginkgo" viewBox="-3 -3 6 6">' +
    '<path d="M0,1.6 C-2,1.6 -2.4,-0.9 -1.3,-2 C-0.6,-1.3 -0.3,-0.6 0,0.1 C0.3,-0.6 0.6,-1.3 1.3,-2 C2.4,-0.9 2,1.6 0,1.6 Z" fill="#4a7a3a"/>' +
    '</symbol>' +
    '<symbol id="tree-magnolia" viewBox="-3 -3 6 6">' +
    [0, 72, 144, 216, 288]
      .map(function (deg) {
        return '<ellipse cx="0" cy="-1.5" rx="0.75" ry="1.15" fill="#e8a5c4" transform="rotate(' + deg + ')"/>';
      })
      .join("") +
    '<circle r="0.55" fill="#c9a227"/>' +
    '</symbol>' +
    '<symbol id="tree-notable" viewBox="-3 -3 6 6">' +
    '<circle r="2.6" fill="none" stroke="#c9a227" stroke-width="0.35" stroke-dasharray="0.5 0.4"/>' +
    '<rect x="-0.3" y="0.4" width="0.6" height="1.3" fill="#6b4a2a"/>' +
    '<circle cy="-0.4" r="1.5" fill="#4a7a3a"/>' +
    '</symbol>' +
    '</defs>';

  var TREE_SIZE = { ginkgo: 3, magnolia: 3, notable: 5, "ginkgo-cluster": 4.5, "magnolia-cluster": 4.5 };
  var TREE_SYMBOL = {
    ginkgo: "tree-ginkgo",
    magnolia: "tree-magnolia",
    notable: "tree-notable",
    "ginkgo-cluster": "tree-ginkgo",
    "magnolia-cluster": "tree-magnolia",
  };

  function treeMarkersSVG() {
    var out = "";
    MAP_DATA.trees.forEach(function (t) {
      var s = TREE_SIZE[t.kind];
      var sym = TREE_SYMBOL[t.kind];
      var half = s / 2;
      out +=
        '<use href="#' +
        sym +
        '" x="' +
        (t.x - half) +
        '" y="' +
        (t.y - half) +
        '" width="' +
        s +
        '" height="' +
        s +
        '" class="tree-marker"/>';
      if (t.count) {
        out += '<circle class="tree-cluster-ring" cx="' + t.x + '" cy="' + t.y + '" r="' + (half + 0.6) + '"/>';
        out +=
          '<text class="tree-cluster-count" x="' + t.x + '" y="' + (t.y - half - 0.8) + '">' + t.count + "</text>";
      }
    });
    return out;
  }

  function resolveModuleObjects(mod) {
    var list = [];
    mod.objects.forEach(function (curObj, idx) {
      var baseObj = resolveObject(curObj);
      if (!baseObj) return; // shouldn't happen; guards against data drift
      list.push({ idx: list.length, curObj: curObj, baseObj: baseObj });
    });
    return list;
  }

  function mapSVG(resolvedList) {
    var targets = "";
    resolvedList.forEach(function (item) {
      var b = item.baseObj;
      var idx = item.idx;
      var rank = idx + 1;
      var bx = b.badge[0];
      var by = b.badge[1];
      targets += '<g class="obj" data-idx="' + idx + '">';
      if (b.kind === "line") {
        targets += '<path class="target-line" d="' + b.d + '"/>';
        targets += '<path class="hit-line" data-idx="' + idx + '" d="' + b.d + '"/>';
      } else {
        targets += '<path class="target-poly" data-idx="' + idx + '" d="' + b.d + '"/>';
        targets += '<path class="hit-poly" data-idx="' + idx + '" d="' + b.d + '"/>';
      }
      targets +=
        '<g class="badge" data-idx="' +
        idx +
        '" data-bx="' +
        bx +
        '" data-by="' +
        by +
        '" transform="translate(' +
        bx +
        "," +
        by +
        ')"><circle r="9"/><text x="0" y="0.5">' +
        rank +
        "</text></g>";
      targets += "</g>";
    });

    return (
      '<div class="map-shell">' +
      '<svg id="map" viewBox="' +
      MAP_DATA.viewBox +
      '" xmlns="http://www.w3.org/2000/svg">' +
      TREE_DEFS +
      '<path class="bg-parks-major" d="' +
      MAP_DATA.bgParksMajor +
      '"/>' +
      '<path class="bg-parks-buurt" d="' +
      MAP_DATA.bgParksBuurt +
      '"/>' +
      '<path class="bg-neighborhoods" d="' +
      MAP_DATA.bgNeighborhoods +
      '"/>' +
      '<path class="bg-tram" d="' +
      MAP_DATA.bgTram +
      '"/>' +
      '<path class="bg-rail" d="' +
      MAP_DATA.bgRail +
      '"/>' +
      '<path class="bg-waterways" d="' +
      MAP_DATA.bgWaterways +
      '"/>' +
      '<path class="bg-streets" d="' +
      MAP_DATA.bgStreets +
      '"/>' +
      '<path class="bg-buildings-plain" d="' +
      MAP_DATA.bgBuildingsPlain +
      '"/>' +
      '<path class="bg-buildings-church" d="' +
      MAP_DATA.bgBuildingsChurch +
      '"/>' +
      '<g class="tree-layer">' +
      treeMarkersSVG() +
      "</g>" +
      '<path class="boundary" d="' +
      MAP_DATA.boundary +
      '"/>' +
      '<g id="targets">' +
      targets +
      "</g>" +
      "</svg>" +
      '<button class="map-recenter" id="mapRecenter" aria-label="Recenter map" title="Recenter">⤢</button>' +
      "</div>"
    );
  }

  function setObjClass(svg, idx, cls) {
    var g = svg.querySelector('.obj[data-idx="' + idx + '"]');
    if (!g) return;
    g.classList.remove("selected", "correct", "incorrect");
    if (cls) g.classList.add(cls);
  }

  /* ============================== MODULE SCREEN ============================== */

  var moduleRuntime = {}; // per-open-module transient state (not persisted mid-quiz)

  function renderModuleScreen(moduleId) {
    var mod = MODULES_BY_ID[moduleId];
    if (!mod) {
      go({ screen: "home" });
      return;
    }
    if (!moduleRuntime.moduleId || moduleRuntime.moduleId !== moduleId) {
      moduleRuntime = {
        moduleId: moduleId,
        resolved: resolveModuleObjects(mod),
        mode: route.mode || "learn",
        selectedIdx: null,
      };
    }

    var html =
      '<header class="module-header">' +
      '<div class="top-row"><button class="back-btn" id="backHome">&larr; Modules</button></div>' +
      '<div class="eyebrow">' +
      mod.ssId +
      " " +
      mod.ssTitle +
      " &middot; " +
      mod.secId +
      " " +
      mod.secTitle +
      "</div>" +
      "<h1>" +
      mod.id +
      " &middot; " +
      mod.title +
      "</h1>" +
      '<div class="mode-switch">' +
      '<button id="btn-learn" class="' +
      (moduleRuntime.mode === "learn" ? "active" : "") +
      '">Learn</button>' +
      '<button id="btn-quiz" class="' +
      (moduleRuntime.mode === "quiz" ? "active" : "") +
      '">Quiz</button>' +
      "</div></header>" +
      '<div id="map-wrap"></div>' +
      '<div id="learn-panel" class="hidden"></div>' +
      '<div id="quiz-panel" class="hidden"></div>' +
      '<div id="quiz-results"></div>';

    appEl.innerHTML = html;
    var mapWrap = document.getElementById("map-wrap");
    mapWrap.style.aspectRatio = String(MAP_ASPECT);
    mapWrap.innerHTML = mapSVG(moduleRuntime.resolved);

    document.getElementById("backHome").addEventListener("click", function () {
      go({ screen: "home" });
    });
    document.getElementById("btn-learn").addEventListener("click", function () {
      setMode(mod, "learn");
    });
    document.getElementById("btn-quiz").addEventListener("click", function () {
      setMode(mod, "quiz");
    });

    var svg = document.getElementById("map");
    var moduleBBox = unionBBox(
      moduleRuntime.resolved.map(function (item) {
        return item.baseObj.bbox;
      })
    );
    moduleRuntime.mapController = createMapController(svg, moduleBBox, function (idx) {
      onMapObjectTap(mod, idx);
    });
    document.getElementById("mapRecenter").addEventListener("click", function () {
      moduleRuntime.mapController.reset();
    });

    if (moduleRuntime.mode === "learn") {
      renderLearnPanel(mod);
    } else {
      renderQuizPanel(mod);
    }
  }

  function setMode(mod, mode) {
    moduleRuntime.mode = mode;
    var svg = document.getElementById("map");
    svg.querySelectorAll(".obj").forEach(function (g) {
      g.classList.remove("selected", "correct", "incorrect");
    });
    svg.classList.toggle("quiz-mode", mode === "quiz");
    document.getElementById("btn-learn").classList.toggle("active", mode === "learn");
    document.getElementById("btn-quiz").classList.toggle("active", mode === "quiz");
    closeSheet();
    document.getElementById("quiz-results").classList.remove("show");
    if (mode === "learn") {
      document.getElementById("quiz-panel").classList.add("hidden");
      renderLearnPanel(mod);
    } else {
      document.getElementById("learn-panel").classList.add("hidden");
      startQuiz(mod);
    }
  }

  function onMapObjectTap(mod, idx) {
    if (moduleRuntime.mode === "learn") {
      selectLearnObject(mod, idx);
    } else {
      handleQuizAnswer(mod, idx);
    }
  }

  /* ---------- LEARN MODE ---------- */

  function renderLearnPanel(mod) {
    var panel = document.getElementById("learn-panel");
    panel.classList.remove("hidden");
    var html = "";
    moduleRuntime.resolved.forEach(function (item) {
      var rank = item.idx + 1;
      html +=
        '<div class="obj-row" data-idx="' +
        item.idx +
        '"><div class="rank">' +
        rank +
        '</div><div class="info"><div class="name">' +
        item.curObj.name +
        '</div><div class="meta">' +
        metaLine(item.curObj, item.baseObj) +
        "</div></div></div>";
    });
    panel.innerHTML = html;
    panel.querySelectorAll(".obj-row").forEach(function (row) {
      row.addEventListener("click", function () {
        selectLearnObject(mod, parseInt(row.getAttribute("data-idx"), 10));
      });
    });
    ensureSheet();
  }

  function selectLearnObject(mod, idx) {
    var svg = document.getElementById("map");
    svg.querySelectorAll(".obj").forEach(function (g) {
      g.classList.toggle("selected", g.getAttribute("data-idx") === String(idx));
    });
    document.querySelectorAll(".obj-row").forEach(function (row) {
      row.classList.toggle("selected", row.getAttribute("data-idx") === String(idx));
    });
    var item = moduleRuntime.resolved[idx];
    openSheet(item);
  }

  function ensureSheet() {
    if (document.getElementById("detail-sheet")) return;
    var sheet = document.createElement("div");
    sheet.id = "detail-sheet";
    sheet.innerHTML =
      '<button class="close-sheet" id="close-sheet">&times;</button>' +
      '<div class="sheet-rank" id="sheet-rank"></div>' +
      "<h3 id=\"sheet-name\"></h3>" +
      '<div class="sheet-meta" id="sheet-meta"></div>';
    document.body.appendChild(sheet);
    document.getElementById("close-sheet").addEventListener("click", closeSheet);
  }

  function openSheet(item) {
    ensureSheet();
    document.getElementById("sheet-rank").textContent = "#" + (item.idx + 1) + " of " + moduleRuntime.resolved.length;
    document.getElementById("sheet-name").textContent = item.curObj.name;
    document.getElementById("sheet-meta").textContent = metaLine(item.curObj, item.baseObj);
    document.getElementById("detail-sheet").classList.add("open");
  }

  function closeSheet() {
    var sheet = document.getElementById("detail-sheet");
    if (sheet) sheet.classList.remove("open");
  }

  /* ---------- QUIZ MODE ---------- */

  function startQuiz(mod) {
    moduleRuntime.quiz = {
      order: shuffle(moduleRuntime.resolved),
      index: 0,
      score: 0,
      answered: false,
      results: [],
    };
    document.getElementById("quiz-panel").classList.remove("hidden");
    document.getElementById("quiz-results").classList.remove("show");
    renderQuizQuestion();
  }

  function renderQuizPanel(mod) {
    document.getElementById("quiz-panel").classList.remove("hidden");
    if (!moduleRuntime.quiz) {
      startQuiz(mod);
    } else {
      renderQuizQuestion();
    }
  }

  function renderQuizQuestion() {
    var q = moduleRuntime.quiz;
    var panel = document.getElementById("quiz-panel");
    var current = q.order[q.index];
    panel.innerHTML =
      '<div class="quiz-progress">Question ' +
      (q.index + 1) +
      " of " +
      q.order.length +
      " &middot; Score " +
      q.score +
      "</div>" +
      '<div class="quiz-prompt-label">Tap this on the map:</div>' +
      '<div class="quiz-prompt-name">' +
      current.curObj.name +
      "</div>" +
      '<div id="quiz-feedback"></div>' +
      '<div class="quiz-detail" id="quiz-detail"></div>' +
      '<button class="btn btn-primary" id="quiz-next-btn">Next</button>';
    document.getElementById("quiz-next-btn").addEventListener("click", function () {
      advanceQuiz();
    });
    q.answered = false;
  }

  function handleQuizAnswer(mod, tappedIdx) {
    var q = moduleRuntime.quiz;
    if (!q || q.answered) return;
    q.answered = true;
    var current = q.order[q.index];
    var correct = tappedIdx === current.idx;
    var svg = document.getElementById("map");
    var fb = document.getElementById("quiz-feedback");
    var detail = document.getElementById("quiz-detail");
    if (correct) {
      q.score++;
      setObjClass(svg, current.idx, "correct");
      fb.textContent = "Correct.";
      fb.className = "good";
    } else {
      var tappedItem = moduleRuntime.resolved[tappedIdx];
      setObjClass(svg, tappedIdx, "incorrect");
      setObjClass(svg, current.idx, "correct");
      fb.textContent = tappedItem ? "Not quite — that was " + tappedItem.curObj.name + "." : "Not quite.";
      fb.className = "bad";
    }
    detail.textContent = metaLine(current.curObj, current.baseObj);
    q.results.push({ item: current, correct: correct });
    document.querySelector(".quiz-progress").textContent =
      "Question " + (q.index + 1) + " of " + q.order.length + " · Score " + q.score;
    document.getElementById("quiz-next-btn").classList.add("show");
  }

  function advanceQuiz() {
    var q = moduleRuntime.quiz;
    var svg = document.getElementById("map");
    svg.querySelectorAll(".obj").forEach(function (g) {
      g.classList.remove("correct", "incorrect");
    });
    q.index++;
    if (q.index >= q.order.length) {
      finishQuiz();
    } else {
      renderQuizQuestion();
    }
  }

  function finishQuiz() {
    var q = moduleRuntime.quiz;
    var score = q.score / q.order.length;
    var modId = moduleRuntime.moduleId;
    var prog = state.progress[modId] || { attempts: 0, bestScore: 0 };
    prog.attempts++;
    prog.bestScore = Math.max(prog.bestScore, score);
    state.progress[modId] = prog;
    saveState();

    document.getElementById("quiz-panel").classList.add("hidden");
    var results = document.getElementById("quiz-results");
    results.classList.add("show");
    var missed = q.results.filter(function (r) {
      return !r.correct;
    });
    var html =
      '<div class="score-big">' +
      pct(score) +
      "</div>" +
      '<div class="score-sub">' +
      q.score +
      " of " +
      q.order.length +
      " correct" +
      (score >= PASS_THRESHOLD ? " · nice work" : "") +
      "</div>";
    if (missed.length) {
      html += '<div class="missed-list">';
      missed.forEach(function (r) {
        html +=
          '<div class="missed-item"><div class="mi-name">' +
          r.item.curObj.name +
          "</div><div>" +
          metaLine(r.item.curObj, r.item.baseObj) +
          "</div></div>";
      });
      html += "</div>";
    }
    html += '<button class="btn btn-primary" id="quiz-retry-btn">Try Again</button>';
    html += '<button class="btn btn-secondary" id="quiz-home-btn">Back to Modules</button>';
    results.innerHTML = html;
    document.getElementById("quiz-retry-btn").addEventListener("click", function () {
      results.classList.remove("show");
      startQuiz(MODULES_BY_ID[modId]);
    });
    document.getElementById("quiz-home-btn").addEventListener("click", function () {
      go({ screen: "home" });
    });
  }

  /* ============================== RESET MODAL ============================== */

  document.getElementById("resetCancel").addEventListener("click", function () {
    document.getElementById("resetModal").hidden = true;
  });
  document.getElementById("resetConfirm").addEventListener("click", function () {
    document.getElementById("resetModal").hidden = true;
    resetState();
  });

  /* ============================== INIT ============================== */

  if (Object.keys(state.openSections).length === 0) {
    state.openSections[CURRICULUM.super_sections[0].id] = true;
  }

  router();
})();
