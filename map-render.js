// Shared map rendering: the base-map scenery layers, the tree icon defs,
// and the pan/pinch-zoom viewport controller. Used by both app.js (the
// Learn curriculum) and scroll.js (the Scroll feed) so the map is built
// once, not forked - see change-request-2.md's "reuse it, not fork it".
//
// Exposes a single global, MapRender, since this is loaded as a plain
// <script> (no bundler) before whichever page-specific script needs it.
// Depends on MAP_DATA (data/generated/map-data.js) being loaded first.
var MapRender = (function () {
  "use strict";

  function parseViewBox(s) {
    var p = s.trim().split(/\s+/).map(Number);
    return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }

  var FULL_VB = parseViewBox(MAP_DATA.viewBox);
  var MAP_ASPECT = FULL_VB.w / FULL_VB.h;
  var MIN_VB_W = 12; // deepest allowed zoom-in, in world units
  var FIT_PADDING = 0.4; // fraction of the target's own extent added as margin
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

  function fitViewBoxForBBox(bbox, opts) {
    opts = opts || {};
    var padding = opts.padding != null ? opts.padding : FIT_PADDING;
    var minSize = opts.minSize != null ? opts.minSize : FIT_MIN_SIZE;
    var w = Math.max(bbox[2] - bbox[0], 1);
    var h = Math.max(bbox[3] - bbox[1], 1);
    var cx = (bbox[0] + bbox[2]) / 2;
    var cy = (bbox[1] + bbox[3]) / 2;
    w *= 1 + padding * 2;
    h *= 1 + padding * 2;
    w = Math.max(w, minSize);
    h = Math.max(h, minSize / MAP_ASPECT);
    if (w / h < MAP_ASPECT) {
      w = h * MAP_ASPECT;
    } else {
      h = w / MAP_ASPECT;
    }
    // Fully contain the fitted window within the real map extent (rather
    // than the looser pan clamp, which permits overscroll during
    // interaction but would otherwise leave a large/whole-map target
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
            if (onTap) handleTap(startPos.x, startPos.y);
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

  /* ============================== SCENERY (shared background layers) ============================== */

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

  // Full base-map context (change-request-1): parks, neighborhoods, tram,
  // rail, waterways, streets, buildings, trees, ring boundary. Every page's
  // map includes this, dimmed, underneath whatever it highlights itself.
  function sceneryLayersSVG() {
    return (
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
      '"/>'
    );
  }

  function resolveObjectByName(name, type) {
    var bucket = MAP_DATA.objects[type];
    if (!bucket) return null;
    var key = name
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s+\)/g, ")")
      .replace(/\(\s+/g, "(")
      .toUpperCase();
    return bucket[key] || null;
  }

  return {
    FULL_VB: FULL_VB,
    MAP_ASPECT: MAP_ASPECT,
    unionBBox: unionBBox,
    fitViewBoxForBBox: fitViewBoxForBBox,
    createMapController: createMapController,
    sceneryLayersSVG: sceneryLayersSVG,
    resolveObjectByName: resolveObjectByName,
  };
})();
