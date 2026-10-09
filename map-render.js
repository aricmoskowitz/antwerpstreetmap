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

  // `aspect` (width / height of the on-screen map) defaults to the map's own
  // aspect - the Learn, Scroll and Walk maps are sized to it; Explore fills
  // the screen and passes its real aspect instead.
  function clampViewBox(vb, aspect) {
    aspect = aspect || MAP_ASPECT;
    var w = Math.min(Math.max(vb.w, MIN_VB_W), Math.max(FULL_VB.w, FULL_VB.h * aspect));
    var h = w / aspect;
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
    var aspect = opts.aspect || MAP_ASPECT;
    var w = Math.max(bbox[2] - bbox[0], 1);
    var h = Math.max(bbox[3] - bbox[1], 1);
    var cx = (bbox[0] + bbox[2]) / 2;
    var cy = (bbox[1] + bbox[3]) / 2;
    w *= 1 + padding * 2;
    h *= 1 + padding * 2;
    w = Math.max(w, minSize);
    h = Math.max(h, minSize / aspect);
    if (w / h < aspect) {
      w = h * aspect;
    } else {
      h = w / aspect;
    }
    // Fully contain the fitted window within the real map extent (rather
    // than the looser pan clamp, which permits overscroll during
    // interaction but would otherwise leave a large/whole-map target
    // off-center here).
    if (w >= FULL_VB.w || h >= FULL_VB.h) {
      // the whole map, centered (exactly FULL_VB at the map's own aspect)
      var fw = Math.max(FULL_VB.w, FULL_VB.h * aspect);
      var fh = fw / aspect;
      return { x: FULL_VB.x + (FULL_VB.w - fw) / 2, y: FULL_VB.y + (FULL_VB.h - fh) / 2, w: fw, h: fh };
    }
    var x = Math.min(Math.max(cx - w / 2, FULL_VB.x), FULL_VB.x + FULL_VB.w - w);
    var y = Math.min(Math.max(cy - h / 2, FULL_VB.y), FULL_VB.y + FULL_VB.h - h);
    return { x: x, y: y, w: w, h: h };
  }

  // opts (all optional, used by Explore):
  //   aspect():          current width / height of the svg on screen
  //   fit:               options for fitViewBoxForBBox when framing homeBBox
  //   onTapPoint(pt, u): called on every single tap with the tapped point in
  //                      map units and u = map units per screen pixel
  function createMapController(svg, homeBBox, onTap, opts) {
    opts = opts || {};
    function aspect() {
      return opts.aspect ? opts.aspect() : MAP_ASPECT;
    }
    function fitHome() {
      var fit = {};
      Object.keys(opts.fit || {}).forEach(function (k) {
        fit[k] = opts.fit[k];
      });
      fit.aspect = aspect();
      return fitViewBoxForBBox(homeBBox, fit);
    }
    var home = fitHome();
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
      home = fitHome();
      vb = { x: home.x, y: home.y, w: home.w, h: home.h };
      apply();
    }

    // Re-fit after the svg's on-screen aspect changed (rotation, resize),
    // keeping the same center and width.
    function resize() {
      var cx = vb.x + vb.w / 2;
      var cy = vb.y + vb.h / 2;
      var w = vb.w;
      var h = w / aspect();
      vb = clampViewBox({ x: cx - w / 2, y: cy - h / 2, w: w, h: h }, aspect());
      apply();
    }

    function zoomBy(factor) {
      var rect = svg.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
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
      var clamped = clampViewBox({ x: vb.x, y: vb.y, w: newW, h: newW / aspect() }, aspect());
      vb.w = clamped.w;
      vb.h = clamped.h;
      vb.x = before.x - ((clientX - rect.left) / rect.width) * vb.w;
      vb.y = before.y - ((clientY - rect.top) / rect.height) * vb.h;
      var reclamped = clampViewBox(vb, aspect());
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
        var clamped = clampViewBox(vb, aspect());
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
      if (opts.onTapPoint) {
        var rect = svg.getBoundingClientRect();
        opts.onTapPoint(clientToUser(clientX, clientY), vb.w / rect.width);
      }
      if (!onTap) return;
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
            if (onTap || opts.onTapPoint) handleTap(startPos.x, startPos.y);
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
    return { reset: reset, resize: resize, zoomBy: zoomBy };
  }

  /* ============================== SCENERY (shared background layers) ============================== */

  // Genus icon system (base map change request): each genus of a
  // "significant park tree" gets its own symbol, reused everywhere that
  // genus appears. Built from a small set of shape templates (leaf habit)
  // rather than one bespoke illustration per genus - genus is still always
  // visually distinct, since no two genera share both the same shape AND
  // the same color.
  var GENUS_TREE_ICONS = {
    // palmate / star-lobed leaves
    acer: { shape: "lobedStar", color: "#c1542c" }, // maple - autumn red-orange
    platanus: { shape: "lobedStar", color: "#7a8a4a" }, // plane tree - olive
    liquidambar: { shape: "lobedStar", color: "#8a3b5a" }, // sweetgum - deep red-purple
    // oak
    quercus: { shape: "roundLobed", color: "#5c6b2e" },
    // simple ovals
    fagus: { shape: "simpleOval", color: "#9c6b3e" }, // beech - copper
    celtis: { shape: "simpleOval", color: "#4a7a3a" },
    castanea: { shape: "simpleOval", color: "#4e7a2f" },
    alnus: { shape: "simpleOval", color: "#3f6b4a" },
    carpinus: { shape: "simpleOval", color: "#4a7a3a" },
    ulmus: { shape: "simpleOval", color: "#5a7a3a" },
    // heart-shaped
    tilia: { shape: "heart", color: "#5a8a3a" },
    catalpa: { shape: "heart", color: "#7a9a4a" },
    // palmate compound (horse chestnut)
    aesculus: { shape: "compoundFan", color: "#3f7a3a" },
    // pinnate compound (small leaflets along a stem)
    fraxinus: { shape: "pinnateCompound", color: "#4a7a4a" },
    robinia: { shape: "pinnateCompound", color: "#6a9a4a" },
    gleditsia: { shape: "pinnateCompound", color: "#7aa54a" },
    juglans: { shape: "pinnateCompound", color: "#5a5a2a" },
    // conifers
    pinus: { shape: "conifer", color: "#2f5a3a" },
    cedrus: { shape: "conifer", color: "#2f5a4a" },
    taxus: { shape: "conifer", color: "#2a4a2a" },
    thuja: { shape: "conifer", color: "#3a5a3a" },
    // distinctive single-genus shapes
    liriodendron: { shape: "tulip", color: "#8a9a3a" }, // tulip tree
    betula: { shape: "smallTriangle", color: "#8a9a5a" }, // birch
    prunus: { shape: "blossomOval", color: "#6a8a4a" }, // cherry
    pyrus: { shape: "blossomOval", color: "#5a7a3a" }, // pear
    populus: { shape: "narrowOval", color: "#6a7a5a" }, // poplar
    salix: { shape: "droopingBlade", color: "#7a9a6a" }, // willow
  };

  function leafShapePath(shape) {
    switch (shape) {
      case "lobedStar":
        return "M0,-2.2 L0.5,-0.6 L2.1,-0.9 L1,0.4 L2,1.9 L0.5,1.1 L0,2.3 L-0.5,1.1 L-2,1.9 L-1,0.4 L-2.1,-0.9 L-0.5,-0.6 Z";
      case "roundLobed":
        return "M0,-2.1 C1,-2 1,-1 1.6,-0.9 C1.1,-0.5 1.4,0.1 1.9,0.3 C1.3,0.6 1.4,1.1 1.8,1.4 C1.1,1.5 0.8,1.9 0.9,2.3 C0.3,1.9 -0.3,1.9 -0.9,2.3 C-0.8,1.9 -1.1,1.5 -1.8,1.4 C-1.4,1.1 -1.3,0.6 -1.9,0.3 C-1.4,0.1 -1.1,-0.5 -1.6,-0.9 C-1,-1 -1,-2 0,-2.1 Z";
      case "simpleOval":
        return "M0,-2.2 C1.5,-1.6 1.5,1.2 0,2.2 C-1.5,1.2 -1.5,-1.6 0,-2.2 Z";
      case "heart":
        return "M0,2.2 C-2.3,0.2 -1.9,-1.9 -0.4,-1.9 C0,-1.9 0,-1.3 0,-1.3 C0,-1.3 0,-1.9 0.4,-1.9 C1.9,-1.9 2.3,0.2 0,2.2 Z";
      case "compoundFan":
        return [0, 60, 120, 180, 240]
          .map(function (deg) {
            return (
              '<ellipse cx="0" cy="-1.3" rx="0.55" ry="1.3" transform="rotate(' + (deg - 120) + ')" fill="{{c}}"/>'
            );
          })
          .join("");
      case "pinnateCompound":
        return [-1.6, -0.8, 0, 0.8, 1.6]
          .map(function (x) {
            return '<ellipse cx="' + x + '" cy="0" rx="0.55" ry="0.9" fill="{{c}}"/>';
          })
          .join("");
      case "conifer":
        return "M0,-2.3 L1.7,1 L0.7,0.7 L1.3,2.2 L-1.3,2.2 L-0.7,0.7 L-1.7,1 Z";
      case "tulip":
        return "M0,-2.2 L1.2,-0.6 L2,0.3 L0.6,0.1 L0,2.2 L-0.6,0.1 L-2,0.3 L-1.2,-0.6 Z";
      case "smallTriangle":
        return "M0,-2 L1.5,1.8 L0,0.9 L-1.5,1.8 Z";
      case "blossomOval":
        // full markup (not bare path data): the leaf <path> plus a blossom
        // group, so genusSymbolMarkup must not wrap it in another <path d>
        return (
          '<path d="M0,-1.8 C1.2,-1.3 1.2,1.3 0,1.8 C-1.2,1.3 -1.2,-1.3 0,-1.8 Z" fill="{{c}}"/>' +
          '<g transform="translate(1.1,-1.6) scale(0.45)">' +
          [0, 72, 144, 216, 288]
            .map(function (deg) {
              return '<ellipse cx="0" cy="-1.3" rx="0.7" ry="1.1" fill="#f2d9e6" transform="rotate(' + deg + ')"/>';
            })
            .join("") +
          '<circle r="0.5" fill="#c9a227"/></g>'
        );
      case "narrowOval":
        return "M0,-2.4 C0.9,-1.7 0.9,1.7 0,2.4 C-0.9,1.7 -0.9,-1.7 0,-2.4 Z";
      case "droopingBlade":
        return "M-0.3,-2.3 C0.6,-1.2 1.1,0.6 1.5,2.3 C0.5,1.9 -0.2,1.2 -0.6,0 C-0.9,-0.8 -0.7,-1.6 -0.3,-2.3 Z";
      default:
        return "M0,-2 C1,-2 1,2 0,2 C-1,2 -1,-2 0,-2 Z";
    }
  }

  function genusSymbolMarkup(genus, icon) {
    var body = leafShapePath(icon.shape);
    if (body.indexOf("{{c}}") !== -1) {
      body = body.split("{{c}}").join(icon.color);
    } else if (body.indexOf("<") !== 0) {
      body = '<path d="' + body + '" fill="' + icon.color + '"/>';
    }
    return '<symbol id="tree-genus-' + genus + '" viewBox="-3 -3 6 6">' + body + "</symbol>";
  }

  var TREE_DEFS =
    '<defs>' +
    '<symbol id="tree-ginkgo" viewBox="-3 -3 6 6">' +
    // Autumn ginkgo leaf: a fan with the characteristic center notch/cleft,
    // in autumn yellow rather than the previous green almond shape.
    '<path d="M0,2 C-2.1,1.6 -2.6,-0.3 -2.2,-1.5 C-1.9,-1.1 -1.3,-0.9 -0.7,-1.1 C-0.35,-1.35 -0.12,-1.7 0,-2.1 C0.12,-1.7 0.35,-1.35 0.7,-1.1 C1.3,-0.9 1.9,-1.1 2.2,-1.5 C2.6,-0.3 2.1,1.6 0,2 Z" fill="#e8b324"/>' +
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
    Object.keys(GENUS_TREE_ICONS)
      .map(function (g) {
        return genusSymbolMarkup(g, GENUS_TREE_ICONS[g]);
      })
      .join("") +
    '</defs>';

  var TREE_SIZE = { ginkgo: 3, magnolia: 3, notable: 5, "ginkgo-cluster": 4.5, "magnolia-cluster": 4.5 };
  var TREE_SYMBOL = {
    ginkgo: "tree-ginkgo",
    magnolia: "tree-magnolia",
    notable: "tree-notable",
    "ginkgo-cluster": "tree-ginkgo",
    "magnolia-cluster": "tree-magnolia",
  };
  Object.keys(GENUS_TREE_ICONS).forEach(function (g) {
    TREE_SIZE["genus-" + g] = 5;
    TREE_SYMBOL["genus-" + g] = "tree-genus-" + g;
  });

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

  // The tree symbols are defined once per document, not inside every map:
  // the app shows several maps at once (one per view, plus Scroll's cards),
  // and <use href="#id"> resolves to the first element with that id - which
  // could otherwise sit inside a hidden view.
  (function installTreeDefs() {
    var holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">' + TREE_DEFS + "</svg>";
    document.body.appendChild(holder);
  })();

  // Full base-map context (change-request-1): parks, neighborhoods, tram,
  // rail, waterways, streets, buildings, trees, ring boundary. Every page's
  // map includes this, dimmed, underneath whatever it highlights itself.
  function sceneryLayersSVG() {
    return (
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
      '<path class="bg-waterways-canal" d="' +
      MAP_DATA.bgWaterwaysCanal +
      '"/>' +
      '<path class="bg-waterways-stream" d="' +
      MAP_DATA.bgWaterwaysStream +
      '"/>' +
      '<path class="bg-waterways-river-dock" d="' +
      MAP_DATA.bgWaterwaysRiverDock +
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
    TREE_SIZE: TREE_SIZE,
    unionBBox: unionBBox,
    fitViewBoxForBBox: fitViewBoxForBBox,
    createMapController: createMapController,
    sceneryLayersSVG: sceneryLayersSVG,
    resolveObjectByName: resolveObjectByName,
  };
})();
