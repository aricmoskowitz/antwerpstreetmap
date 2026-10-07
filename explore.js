// Explore: the whole base map to pan and zoom freely. Tapping a tree says
// what kind of tree it is; tapping a road, square, waterway, building or
// park says its name.
//
// Hit-testing is geometric rather than DOM-based: the map's lines are
// sub-pixel thin and the tree icons are a few pixels wide at most zoom
// levels, so a tap picks the nearest object within a finger-sized radius
// instead of whatever element happens to sit under the exact touch point.
(function () {
  "use strict";

  var TAP_PX = 14; // how far (screen px) from a line or tree a tap still counts
  var INSIDE_TAP_PX = 6; // tighter while inside a building/park, so the area itself stays tappable
  var TREE_BONUS_PX = 3; // small targets: trees win close ties against roads
  var ALSO_PX = 2; // other lines/trees this close to the best match are listed as "also here"
  var MAX_ALSO = 4;
  // Half the drawn stroke width (screen px) of each line type - see the
  // .bg-streets / .bg-waterways-* rules in style.css.
  var HALF_STROKE_PX = { road: 0.3, square: 0.3, river: 4, dock: 4, canal: 2, stream: 0.6 };

  /* ============================== TREE NAMES ============================== */

  // English common names. Cultivars with a well-known name of their own are
  // listed in full; everything else falls back to the binomial, then genus.
  var COMMON_NAMES = {
    "Fagus sylvatica 'Atropunicea'": "Copper beech",
    "Populus nigra 'Italica'": "Lombardy poplar",
    "Salix babylonica 'Tortuosa'": "Corkscrew willow",
    "Salix sepulcralis 'Chrysocoma' (x)": "Golden weeping willow",
    "Cedrus atlantica 'Glauca'": "Blue Atlas cedar",
    "Prunus serrulata 'Kanzan'": "Kanzan cherry",
    "Acer saccharinum 'Laciniatum'": "Cut-leaf silver maple",
    "Ginkgo biloba 'Fastigiata'": "Columnar ginkgo",
    "Acer campestre": "Field maple",
    "Acer platanoides": "Norway maple",
    "Acer pseudoplatanus": "Sycamore maple",
    "Acer saccharinum": "Silver maple",
    "Aesculus hippocastanum": "Horse chestnut",
    "Alnus incana": "Grey alder",
    "Betula pendula": "Silver birch",
    "Betula pubescens": "Downy birch",
    "Carpinus betulus": "Hornbeam",
    "Castanea sativa": "Sweet chestnut",
    "Catalpa bignonioides": "Indian bean tree",
    "Celtis australis": "European nettle tree",
    "Fagus sylvatica": "European beech",
    "Fraxinus angustifolia": "Narrow-leaved ash",
    "Fraxinus excelsior": "European ash",
    "Ginkgo biloba": "Ginkgo",
    "Gleditsia triacanthos": "Honey locust",
    "Liquidambar styraciflua": "Sweetgum",
    "Liriodendron tulipifera": "Tulip tree",
    "Magnolia dawsoniana": "Dawson's magnolia",
    "Magnolia grandiflora": "Southern magnolia",
    "Magnolia kobus": "Kobus magnolia",
    "Magnolia loebneri": "Loebner's magnolia",
    "Magnolia soulangeana": "Saucer magnolia",
    "Pinus nigra": "Black pine",
    "Pinus sylvestris": "Scots pine",
    "Platanus hispanica": "London plane",
    "Populus alba": "White poplar",
    "Populus canadensis": "Canadian poplar",
    "Populus tremula": "Aspen",
    "Prunus avium": "Wild cherry",
    "Quercus cerris": "Turkey oak",
    "Quercus phellos": "Willow oak",
    "Quercus robur": "English oak",
    "Quercus rubra": "Red oak",
    "Robinia pseudoacacia": "Black locust",
    "Salix alba": "White willow",
    "Salix viminalis": "Osier",
    "Taxus baccata": "English yew",
    "Tilia cordata": "Small-leaved lime",
    "Tilia platyphyllos": "Large-leaved lime",
    "Tilia tomentosa": "Silver lime",
    "Ulmus glabra": "Wych elm",
    // genus fallbacks
    Acer: "Maple",
    Aesculus: "Horse chestnut",
    Alnus: "Alder",
    Betula: "Birch",
    Carpinus: "Hornbeam",
    Castanea: "Chestnut",
    Catalpa: "Catalpa",
    Cedrus: "Cedar",
    Celtis: "Nettle tree",
    Fagus: "Beech",
    Fraxinus: "Ash",
    Ginkgo: "Ginkgo",
    Gleditsia: "Honey locust",
    Juglans: "Walnut",
    Liquidambar: "Sweetgum",
    Liriodendron: "Tulip tree",
    Magnolia: "Magnolia",
    Pinus: "Pine",
    Platanus: "Plane tree",
    Populus: "Poplar",
    Prunus: "Cherry",
    Pyrus: "Pear",
    Quercus: "Oak",
    Robinia: "Black locust",
    Salix: "Willow",
    Taxus: "Yew",
    Thuja: "Thuja (arborvitae)",
    Tilia: "Lime (linden)",
    Ulmus: "Elm",
  };

  // "Platanus hispanica (x)" -> { binomial: "Platanus hispanica", hybrid: true, cultivar: null }
  function parseSpecies(raw) {
    var s = raw.trim();
    var hybrid = /\(x\)/.test(s);
    s = s.replace(/\s*\(x\)\s*/g, " ").trim();
    var cultivar = null;
    var q = s.indexOf("'");
    if (q !== -1) {
      cultivar = s.slice(q).replace(/'/g, "").trim();
      s = s.slice(0, q).trim();
    }
    return { binomial: s, hybrid: hybrid, cultivar: cultivar };
  }

  function commonName(raw) {
    if (COMMON_NAMES[raw]) return COMMON_NAMES[raw];
    var p = parseSpecies(raw);
    var name = COMMON_NAMES[p.binomial] || COMMON_NAMES[p.binomial.split(" ")[0]] || p.binomial;
    return p.cultivar ? name + " ‘" + p.cultivar + "’" : name;
  }

  // Botanical style: italic binomial, × for hybrids, cultivar in roman quotes.
  function scientificHTML(raw) {
    var p = parseSpecies(raw);
    var words = p.binomial.split(" ");
    var latin = words.length > 1 && p.hybrid ? words[0] + " × " + words.slice(1).join(" ") : p.binomial;
    return (
      "<i>" + esc(latin) + "</i>" + (p.cultivar ? " ‘" + esc(p.cultivar) + "’" : "") + (p.hybrid && words.length < 2 ? " (hybrid)" : "")
    );
  }

  /* ============================== GEOMETRY ============================== */

  // MAP_DATA paths are plain "M x,y L x,y ... [Z]" - parse into flat rings.
  function parseRings(d) {
    var rings = [];
    var cur = null;
    d.trim()
      .split(/\s+/)
      .forEach(function (tok) {
        if (tok === "M") {
          cur = [];
          rings.push(cur);
        } else if (tok !== "L" && tok !== "Z") {
          var c = tok.indexOf(",");
          if (c === -1 || !cur) return;
          cur.push(parseFloat(tok.slice(0, c)), parseFloat(tok.slice(c + 1)));
        }
      });
    return rings.filter(function (r) {
      return r.length >= 2;
    });
  }

  function distToRings(px, py, rings) {
    var best = Infinity;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (r.length === 2) {
        best = Math.min(best, Math.hypot(px - r[0], py - r[1]));
        continue;
      }
      for (var j = 0; j + 3 < r.length; j += 2) {
        var ax = r[j],
          ay = r[j + 1],
          dx = r[j + 2] - ax,
          dy = r[j + 3] - ay;
        var len2 = dx * dx + dy * dy;
        var t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        var d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d < best) best = d;
      }
    }
    return best;
  }

  // Even-odd across all rings, so multi-part footprints and holes both work.
  function insideRings(px, py, rings) {
    var inside = false;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      var n = r.length / 2;
      for (var a = 0, b = n - 1; a < n; b = a++) {
        var xa = r[a * 2],
          ya = r[a * 2 + 1],
          xb = r[b * 2],
          yb = r[b * 2 + 1];
        if (ya > py !== yb > py && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) inside = !inside;
      }
    }
    return inside;
  }

  function inBBox(b, px, py, pad) {
    return px >= b[0] - pad && px <= b[2] + pad && py >= b[1] - pad && py <= b[3] + pad;
  }

  function bboxOfRings(rings) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    rings.forEach(function (r) {
      for (var i = 0; i < r.length; i += 2) {
        if (r[i] < b[0]) b[0] = r[i];
        if (r[i + 1] < b[1]) b[1] = r[i + 1];
        if (r[i] > b[2]) b[2] = r[i];
        if (r[i + 1] > b[3]) b[3] = r[i + 1];
      }
    });
    return b;
  }

  /* ============================== FEATURES ============================== */

  function objectFeatures(type) {
    var bucket = MAP_DATA.objects[type];
    return Object.keys(bucket).map(function (key) {
      var o = bucket[key];
      var rings = parseRings(o.d);
      return {
        type: type,
        obj: o,
        rings: rings,
        bbox: o.bbox || bboxOfRings(rings),
        halfPx: type === "waterway" ? HALF_STROKE_PX[o.water_type] || 2 : HALF_STROKE_PX[type] || 0,
      };
    });
  }

  var LINES = objectFeatures("road").concat(objectFeatures("square"), objectFeatures("waterway"));
  var BUILDINGS = objectFeatures("building");
  var PARKS = objectFeatures("park");
  var NEIGHBORHOODS = objectFeatures("neighborhood");
  var TREES = MAP_DATA.trees.map(function (t) {
    return { type: "tree", tree: t, x: t.x, y: t.y, r: (MapRender.TREE_SIZE[t.kind] || 3) / 2 };
  });

  // Every polygon in `list` containing the point, smallest first (a small
  // buurtpark drawn inside a bigger park should win the tap).
  function polygonsAt(list, px, py) {
    return list
      .filter(function (f) {
        return inBBox(f.bbox, px, py, 0) && insideRings(px, py, f.rings);
      })
      .sort(function (a, b) {
        return (a.obj.area_m2 || 0) - (b.obj.area_m2 || 0);
      });
  }

  // Everything under a tap, best match first: the nearest line or tree
  // within reach, then anything else that's effectively on the same spot
  // (the source data has roads and squares sharing exact geometry, and tree
  // icons covering tiny parks), then the buildings and parks containing the
  // point. u = map units per screen pixel at the current zoom.
  function hitTest(pt, u) {
    var areas = polygonsAt(BUILDINGS, pt.x, pt.y).concat(polygonsAt(PARKS, pt.x, pt.y));
    var tol = areas.length ? INSIDE_TAP_PX : TAP_PX;
    var near = [];
    // d: screen px from the drawn edge (0 when on it); rank: d with the
    // tree bonus, used only to pick the best match
    TREES.forEach(function (f) {
      var c = Math.hypot(pt.x - f.x, pt.y - f.y) / u;
      var d = Math.max(0, c - f.r / u);
      // overlapping icons: the one centered nearest the tap wins
      if (d - TREE_BONUS_PX <= tol) near.push({ f: f, d: d, rank: d - TREE_BONUS_PX + c * 0.001 });
    });
    LINES.forEach(function (f) {
      if (!inBBox(f.bbox, pt.x, pt.y, (tol + f.halfPx) * u)) return;
      var d = Math.max(0, distToRings(pt.x, pt.y, f.rings) / u - f.halfPx);
      if (d <= tol) near.push({ f: f, d: d, rank: d });
    });
    near.sort(function (a, b) {
      return a.rank - b.rank;
    });
    var hits = near
      .filter(function (h, i) {
        return i === 0 || h.d <= near[0].d + ALSO_PX;
      })
      .map(function (h) {
        return h.f;
      });
    return hits.concat(areas);
  }

  /* ============================== INFO CARD ============================== */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // "DE ZAVEL (NOORDWIJK )" -> "De Zavel (Noordwijk)"
  function neighborhoodName(raw) {
    return raw
      .replace(/\s+/g, " ")
      .replace(/\s+\)/g, ")")
      .replace(/\(\s+/g, "(")
      .trim()
      .toLowerCase()
      .replace(/(^|[\s(\-\/.])([a-zà-ÿ])/g, function (m, pre, ch) {
        return pre + ch.toUpperCase();
      })
      .replace(/\bAn-(\d)/g, "AN-$1"); // district codes like "AN-2060"
  }

  function km(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
  }

  function area(m2) {
    return m2 >= 10000 ? (m2 / 10000).toFixed(1) + " ha" : Math.round(m2).toLocaleString() + " m²";
  }

  var WATER_LABEL = { river: "River", dock: "Dock", canal: "Canal", stream: "Stream" };

  function treeInfo(t) {
    var cluster = /-cluster$/.test(t.kind);
    if (t.kind === "notable") {
      // "European Beech (Fagus sylvatica) — monumental tree"
      var m = /^(.*?)\s*\(([^)]+)\)/.exec(t.name || "");
      var note = (t.note || "").replace(/\s*Reference:.*$/, "");
      return {
        label: "Monumental tree",
        title: m ? m[1].charAt(0) + m[1].slice(1).toLowerCase() : t.name,
        sub: m ? "<i>" + esc(m[2]) + "</i>" : "",
        meta: note ? [note] : [],
      };
    }
    if (cluster) {
      var species = t.kind === "ginkgo-cluster" ? "Ginkgo biloba" : "Magnolia";
      return {
        label: "Group of trees",
        title: t.count + " " + (t.kind === "ginkgo-cluster" ? "ginkgos" : "magnolias"),
        sub: scientificHTML(species),
        meta: ["Too close together to show one by one"],
      };
    }
    var raw = t.name || (t.kind === "magnolia" ? "Magnolia" : "Ginkgo biloba");
    var meta = [];
    if (t.park) meta.push("In " + t.park);
    if (t.girth) meta.push("Trunk " + t.girth + " cm around");
    return { label: "Tree", title: commonName(raw), sub: scientificHTML(raw), meta: meta };
  }

  function objectInfo(f) {
    var o = f.obj;
    switch (f.type) {
      case "road":
        return { label: "Street", title: o.name, meta: o.length_m ? [km(o.length_m) + " inside the ring"] : [] };
      case "square":
        return { label: "Square", title: o.name, meta: [] };
      case "waterway":
        return {
          label: WATER_LABEL[o.water_type] || "Waterway",
          title: o.name,
          meta: o.length_m ? [km(o.length_m) + " inside the ring"] : [],
        };
      case "building":
        return {
          label: o.is_church ? "Church" : "Building",
          title: o.name,
          meta: o.area_m2 ? [area(o.area_m2) + " footprint"] : [],
        };
      case "park":
        return {
          label: o.park_type === "buurtpark" ? "Neighborhood park" : "Park",
          title: o.name,
          meta: o.area_m2 ? [area(o.area_m2)] : [],
        };
    }
    return null;
  }

  /* ============================== PAGE ============================== */

  document.body.classList.add("explore-page");
  var appEl = document.getElementById("app");
  appEl.innerHTML =
    '<div class="explore-topbar">' +
    '<a class="back-btn" href="index.html">&larr; Menu</a>' +
    '<div class="explore-title">Explore</div>' +
    "</div>" +
    '<div class="explore-map" id="exploreMap">' +
    '<svg id="exploreSvg" viewBox="' +
    MAP_DATA.viewBox +
    '" xmlns="http://www.w3.org/2000/svg">' +
    MapRender.sceneryLayersSVG() +
    '<g id="exSel"></g>' +
    "</svg>" +
    '<div class="explore-zoom">' +
    '<button id="exZoomIn" aria-label="Zoom in" title="Zoom in">+</button>' +
    '<button id="exZoomOut" aria-label="Zoom out" title="Zoom out">&minus;</button>' +
    '<button id="exRecenter" aria-label="Show the whole map" title="Whole map">⤢</button>' +
    "</div>" +
    '<div class="explore-hint" id="exHint">Tap any street, waterway, building, park or tree</div>' +
    '<div class="explore-info hidden" id="exInfo" role="status" aria-live="polite"></div>' +
    "</div>";

  var svg = document.getElementById("exploreSvg");
  var selEl = document.getElementById("exSel");
  var infoEl = document.getElementById("exInfo");
  var hintEl = document.getElementById("exHint");

  function svgAspect() {
    var r = svg.getBoundingClientRect();
    return r.width && r.height ? r.width / r.height : MapRender.MAP_ASPECT;
  }

  var FULL = MapRender.FULL_VB;
  var controller = MapRender.createMapController(svg, [FULL.x, FULL.y, FULL.x + FULL.w, FULL.y + FULL.h], null, {
    aspect: svgAspect,
    fit: { padding: 0.02, minSize: 1 },
    onTapPoint: function (pt, u) {
      var hits = hitTest(pt, u);
      select(hits[0], pt, hits);
    },
  });

  document.getElementById("exZoomIn").addEventListener("click", function () {
    controller.zoomBy(1.6);
  });
  document.getElementById("exZoomOut").addEventListener("click", function () {
    controller.zoomBy(1 / 1.6);
  });
  document.getElementById("exRecenter").addEventListener("click", function () {
    controller.reset();
  });
  window.addEventListener("resize", function () {
    controller.resize();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") select(null);
  });

  // Screen px -> the local units of a .badge group (which the controller
  // scales by vb.w / FULL_VB.w on every pan/zoom, keeping it a fixed size).
  function badgeUnits(px) {
    return (px * FULL.w) / svg.getBoundingClientRect().width;
  }

  function currentScale() {
    var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    return vb[2] / FULL.w;
  }

  function highlight(f) {
    if (!f) {
      selEl.innerHTML = "";
      return;
    }
    if (f.type === "tree") {
      selEl.innerHTML =
        '<g class="badge explore-sel-tree" data-bx="' +
        f.x +
        '" data-by="' +
        f.y +
        '" transform="translate(' +
        f.x +
        "," +
        f.y +
        ") scale(" +
        currentScale() +
        ')"><circle r="' +
        badgeUnits(15) +
        '"/></g>';
      return;
    }
    var d = esc(f.obj.d);
    if (f.type === "building" || f.type === "park") {
      selEl.innerHTML = '<path class="explore-sel-poly" d="' + d + '"/>';
    } else {
      var w = Math.max(5, f.halfPx * 2 + 3);
      selEl.innerHTML =
        '<path class="explore-sel-casing" style="stroke-width:' +
        (w + 4) +
        'px" d="' +
        d +
        '"/><path class="explore-sel-line" style="stroke-width:' +
        w +
        'px" d="' +
        d +
        '"/>';
    }
  }

  function featureName(f) {
    return f.type === "tree" ? treeInfo(f.tree).title : f.obj.name;
  }

  // hits: everything under the tap (f is one of them); the rest are offered
  // as "Also here" chips so overlapping objects are all reachable.
  function select(f, pt, hits) {
    hintEl.classList.add("hidden");
    highlight(f);
    var info = f ? (f.type === "tree" ? treeInfo(f.tree) : objectInfo(f)) : null;
    if (!info) {
      infoEl.classList.add("hidden");
      infoEl.innerHTML = "";
      return;
    }
    var meta = info.meta.slice();
    var hood = pt && polygonsAt(NEIGHBORHOODS, pt.x, pt.y)[0];
    if (hood) meta.push("Neighborhood: " + neighborhoodName(hood.obj.name));
    var others = (hits || [])
      .filter(function (h) {
        return h !== f;
      })
      .slice(0, MAX_ALSO);
    infoEl.innerHTML =
      '<button class="explore-close" id="exClose" aria-label="Close">&times;</button>' +
      '<div class="explore-label explore-label-' +
      f.type +
      '">' +
      esc(info.label) +
      "</div>" +
      '<div class="explore-name">' +
      esc(info.title) +
      "</div>" +
      (info.sub ? '<div class="explore-sci">' + info.sub + "</div>" : "") +
      (meta.length
        ? '<div class="explore-meta">' +
          meta
            .map(function (m) {
              return "<span>" + esc(m) + "</span>";
            })
            .join("") +
          "</div>"
        : "") +
      (others.length
        ? '<div class="explore-also"><span>Also here:</span>' +
          others
            .map(function (h) {
              return '<button class="explore-also-chip" data-i="' + hits.indexOf(h) + '">' + esc(featureName(h)) + "</button>";
            })
            .join("") +
          "</div>"
        : "");
    infoEl.classList.remove("hidden");
    document.getElementById("exClose").addEventListener("click", function () {
      select(null);
    });
    infoEl.querySelectorAll(".explore-also-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        select(hits[+b.getAttribute("data-i")], pt, hits);
      });
    });
  }

  // test hook (Playwright): tap-free access to the hit-tester
  window.__explore = { hitTest: hitTest, select: select, commonName: commonName, treeInfo: treeInfo };
})();
