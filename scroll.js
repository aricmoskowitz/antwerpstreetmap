(function () {
  "use strict";

  var LS_KEY = "antwerpScroll.v1";
  var LEARN_LS_KEY = "antwerpRing.v1";
  var TOTAL = STREET_CARDS.length;

  function norm(s) {
    return s
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s+\)/g, ")")
      .replace(/\(\s+/g, "(")
      .toUpperCase();
  }

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

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ============================== STATE ============================== */

  function defaultState() {
    return {
      order: "curriculum",
      positions: { curriculum: 0, region: 0, az: 0, shuffle: 0 },
      total: TOTAL,
      filterStarted: false,
      shuffleOrder: null,
    };
  }

  var saved = readJSON(LS_KEY);
  var state = defaultState();
  if (saved) {
    state.order = saved.order || state.order;
    state.positions = saved.positions
      ? Object.assign(state.positions, saved.positions)
      : state.positions;
    state.filterStarted = !!saved.filterStarted;
    state.shuffleOrder = saved.shuffleOrder || null;
  }
  state.total = TOTAL;

  function save() {
    writeJSON(LS_KEY, state);
  }

  /* ============================== NAME INDEX ============================== */

  var NAME_TO_IDX = {};
  STREET_CARDS.forEach(function (c, i) {
    var k = norm(c.name);
    if (!(k in NAME_TO_IDX)) NAME_TO_IDX[k] = i;
  });

  /* ============================== ORDERS ============================== */

  function cmpParts(a, b) {
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var av = a[i] == null ? 0 : a[i];
      var bv = b[i] == null ? 0 : b[i];
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  function lessonKey(lessonIds) {
    if (!lessonIds.length) return [999999];
    var parts = lessonIds.map(function (id) {
      return id.split(".").map(Number);
    });
    parts.sort(cmpParts);
    return parts[0];
  }

  var ORDERS = {};

  (function buildOrders() {
    var idxs = STREET_CARDS.map(function (_, i) {
      return i;
    });

    var withLesson = idxs.filter(function (i) {
      return STREET_CARDS[i].lessons.length;
    });
    var withoutLesson = idxs.filter(function (i) {
      return !STREET_CARDS[i].lessons.length;
    });
    withLesson.sort(function (a, b) {
      var c = cmpParts(lessonKey(STREET_CARDS[a].lessons), lessonKey(STREET_CARDS[b].lessons));
      if (c) return c;
      return STREET_CARDS[a].name.localeCompare(STREET_CARDS[b].name);
    });
    withoutLesson.sort(function (a, b) {
      return STREET_CARDS[a].name.localeCompare(STREET_CARDS[b].name);
    });
    ORDERS.curriculum = withLesson.concat(withoutLesson);

    ORDERS.region = idxs.slice().sort(function (a, b) {
      var ra = STREET_CARDS[a].neighborhood || "";
      var rb = STREET_CARDS[b].neighborhood || "";
      var c = ra.localeCompare(rb);
      if (c) return c;
      return STREET_CARDS[a].name.localeCompare(STREET_CARDS[b].name);
    });

    ORDERS.az = idxs.slice().sort(function (a, b) {
      return STREET_CARDS[a].name.localeCompare(STREET_CARDS[b].name);
    });

    var shuf = state.shuffleOrder;
    if (!shuf || shuf.length !== TOTAL) {
      shuf = idxs.slice();
      for (var i = shuf.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = shuf[i];
        shuf[i] = shuf[j];
        shuf[j] = t;
      }
      state.shuffleOrder = shuf;
      save();
    }
    ORDERS.shuffle = shuf;
  })();

  /* ============================== STARTED-LESSON FILTER ============================== */

  function startedLessonSet() {
    var s = readJSON(LEARN_LS_KEY);
    var set = {};
    if (s && s.progress) {
      Object.keys(s.progress).forEach(function (id) {
        if (s.progress[id] && s.progress[id].attempts) set[id] = true;
      });
    }
    return set;
  }

  function effectiveList() {
    var base = ORDERS[state.order] || ORDERS.curriculum;
    if (!state.filterStarted) return base;
    var started = startedLessonSet();
    return base.filter(function (i) {
      return STREET_CARDS[i].lessons.some(function (lessonId) {
        return started[lessonId];
      });
    });
  }

  /* ============================== UI SHELL ============================== */

  document.body.classList.add("scroll-page");

  var ORDER_LABELS = {
    curriculum: "Curriculum",
    region: "Region",
    az: "A–Z",
    shuffle: "Shuffle",
  };

  var appEl = document.getElementById("app");
  appEl.innerHTML =
    '<div class="scroll-topbar">' +
    '<a class="back-btn" href="index.html">&larr; Menu</a>' +
    '<button class="scroll-back-chip hidden" id="backChip">&larr; Back</button>' +
    '<select class="scroll-order-select" id="orderSelect">' +
    Object.keys(ORDER_LABELS)
      .map(function (k) {
        return '<option value="' + k + '">' + ORDER_LABELS[k] + "</option>";
      })
      .join("") +
    "</select>" +
    '<label class="scroll-filter-label" for="filterStarted">' +
    '<input type="checkbox" id="filterStarted"> Started only</label>' +
    "</div>" +
    '<div class="scroll-feed" id="scrollFeed"></div>';

  var feedEl = document.getElementById("scrollFeed");
  var orderSelect = document.getElementById("orderSelect");
  var filterCheckbox = document.getElementById("filterStarted");
  var backChip = document.getElementById("backChip");

  orderSelect.value = state.order;
  filterCheckbox.checked = state.filterStarted;

  var slotEls = [];
  var io = null;
  var navStack = [];

  function currentPos() {
    if (!feedEl.clientHeight) return 0;
    return Math.round(feedEl.scrollTop / feedEl.clientHeight);
  }

  function updateBackChipVisibility() {
    backChip.classList.toggle("hidden", navStack.length === 0);
  }

  function renderList(scrollToPos) {
    var list = effectiveList();
    feedEl.innerHTML = "";
    slotEls = [];

    if (!list.length) {
      feedEl.innerHTML =
        '<div class="scroll-empty">No streets from lessons you’ve started yet. Try unchecking ' +
        '&ldquo;Started only&rdquo;, or start a lesson in Learn first.</div>';
      return;
    }

    list.forEach(function (idx, pos) {
      var slot = document.createElement("div");
      slot.className = "card-slot";
      slot.dataset.idx = String(idx);
      slot.dataset.pos = String(pos);
      feedEl.appendChild(slot);
      slotEls.push(slot);
    });

    if (io) io.disconnect();
    io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var slot = entry.target;
          if (entry.isIntersecting) {
            if (!slot.dataset.populated) populateSlot(slot, list.length);
          } else if (slot.dataset.populated) {
            slot.innerHTML = "";
            delete slot.dataset.populated;
          }
        });
      },
      { root: feedEl, rootMargin: "150% 0px 150% 0px", threshold: 0 }
    );
    slotEls.forEach(function (s) {
      io.observe(s);
    });

    var pos = scrollToPos != null ? scrollToPos : state.positions[state.order] || 0;
    pos = Math.min(Math.max(pos, 0), list.length - 1);
    requestAnimationFrame(function () {
      feedEl.scrollTop = pos * feedEl.clientHeight;
    });
  }

  /* ============================== CARD RENDERING ============================== */

  function joinNames(names) {
    if (names.length === 1) return escapeHTML(names[0]);
    return escapeHTML(names.slice(0, -1).join(", ")) + " and " + escapeHTML(names[names.length - 1]);
  }

  function endText(endpoint) {
    if (!endpoint.crosses.length) return "dead end";
    return joinNames(endpoint.crosses);
  }

  // one horizontally scrolling row, so a street with 20 junctions takes the
  // same height as one with 2
  function chipList(names) {
    if (!names.length) return '<span class="scroll-card-empty">None found</span>';
    return (
      '<div class="scroll-chip-row">' +
      names
        .map(function (n) {
          return '<button class="scroll-chip" data-name="' + escapeHTML(n) + '">' + escapeHTML(n) + "</button>";
        })
        .join("") +
      "</div>"
    );
  }

  function footerHTML(c, pos, listLen) {
    var bits = [];
    if (c.neighborhood) bits.push(escapeHTML(c.neighborhood));
    if (c.lessons.length) bits.push("lesson " + escapeHTML(c.lessons.join(", ")));
    var counter = (pos + 1).toLocaleString() + " / " + listLen.toLocaleString();
    return (
      '<span class="scroll-footer-meta">' +
      (bits.join(" &middot; ") || "&mdash;") +
      "</span>" +
      '<span class="scroll-counter">' +
      counter +
      "</span>"
    );
  }

  /* ---------- card map ---------- */
  // The card map is a static SVG, so labels and markers are sized in screen
  // pixels: the viewBox is widened to the map box's exact aspect ratio, so
  // one world unit = mapWidthPx / vb.w pixels everywhere in it. The map box
  // takes whatever height the card's text doesn't need, so the map is drawn
  // after the card is laid out (see populateSlot).

  var LABEL_PX = 14;

  function parsePolylines(d) {
    return d
      .split("M ")
      .filter(function (x) {
        return x.trim();
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

  function segDist(p, a, b) {
    var dx = b[0] - a[0],
      dy = b[1] - a[1];
    var t = dx || dy ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy) : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  function distToLines(p, lines) {
    var best = Infinity;
    lines.forEach(function (l) {
      for (var i = 0; i < l.length - 1; i++) best = Math.min(best, segDist(p, l[i], l[i + 1]));
    });
    return best;
  }

  function boxesOverlap(a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  }

  function buildMapSVG(c, baseObj, box) {
    var vb = MapRender.fitViewBoxForBBox(baseObj.bbox, { padding: 0.35, minSize: 55 });
    // widen/heighten (never crop) to the map box's aspect ratio
    var aspect = box.w / box.h;
    if (vb.w / vb.h < aspect) {
      var nw = vb.h * aspect;
      vb.x -= (nw - vb.w) / 2;
      vb.w = nw;
    } else {
      var nh = vb.w / aspect;
      vb.y -= (nh - vb.h) / 2;
      vb.h = nh;
    }
    var u = vb.w / box.w; // world units per screen pixel
    function toPx(p) {
      return [(p[0] - vb.x) / u, (p[1] - vb.y) / u];
    }

    var focusLines = parsePolylines(baseObj.d).map(function (l) {
      return l.map(toPx);
    });
    var placed = [[box.w - 44, 0, box.w, 44]]; // north arrow
    var marks = "";

    if (!c.is_square) {
      var sp = toPx(c.start.pixel),
        ep = toPx(c.end.pixel);
      [
        { p: sp, other: ep, label: "Start", cls: "start" },
        { p: ep, other: sp, label: "End", cls: "end" },
      ].forEach(function (m) {
        // pill just beyond the street's end, pointing away from the other end
        var dx = m.p[0] - m.other[0],
          dy = m.p[1] - m.other[1],
          len = Math.hypot(dx, dy) || 1;
        var w = m.label.length * 7 + 14,
          h = 18;
        var cx = m.p[0] + (dx / len) * (w / 2 + 6),
          cy = m.p[1] + (dy / len) * (h / 2 + 6);
        cx = Math.max(w / 2 + 2, Math.min(box.w - w / 2 - 2, cx));
        cy = Math.max(h / 2 + 2, Math.min(box.h - h / 2 - 2, cy));
        placed.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
        marks +=
          '<g class="scroll-endpoint ' +
          m.cls +
          '">' +
          '<line x1="' + m.p[0] * u + '" y1="' + m.p[1] * u + '" x2="' + cx * u + '" y2="' + cy * u + '"/>' +
          '<circle cx="' + m.p[0] * u + '" cy="' + m.p[1] * u + '" r="' + 4.5 * u + '"/>' +
          '<rect x="' + (cx - w / 2) * u + '" y="' + (cy - h / 2) * u + '" width="' + w * u + '" height="' + h * u + '" rx="' + 9 * u + '"/>' +
          '<text x="' + cx * u + '" y="' + cy * u + '" style="font-size:' + 11 * u + 'px">' + m.label + "</text></g>";
      });
    }

    var crossSVG = "",
      labelSVG = "";
    c.intersections.forEach(function (name) {
      var ob = MapRender.resolveObjectByName(name, "road") || MapRender.resolveObjectByName(name, "square");
      if (!ob) return;
      crossSVG += '<path class="scroll-cross-line" d="' + ob.d + '"/>';
      // label it next to where it meets the focus street, a little way out
      var lines = parsePolylines(ob.d).map(function (l) {
        return l.map(toPx);
      });
      var junction = null,
        jd = Infinity;
      lines.forEach(function (l, li) {
        l.forEach(function (p, pi) {
          var d = distToLines(p, focusLines);
          if (d < jd) {
            jd = d;
            junction = { li: li, pi: pi };
          }
        });
      });
      if (!junction) return;
      var line = lines[junction.li];
      var w = name.length * LABEL_PX * 0.56 + 6,
        h = LABEL_PX + 4;
      var cands = [];
      [1, -1].forEach(function (dir) {
        // points 30 / 55 / 85 / 120 px along the cross street from the junction
        var acc = 0;
        for (var i = junction.pi; i + dir >= 0 && i + dir < line.length; i += dir) {
          var a = line[i],
            b2 = line[i + dir];
          var seg = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
          [30, 55, 85, 120].forEach(function (target) {
            if (acc < target && acc + seg >= target) {
              var t = (target - acc) / seg;
              cands.push({ pt: [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t], order: target });
            }
          });
          acc += seg;
          if (acc > 120) break;
        }
      });
      cands.sort(function (x, y) {
        return x.order - y.order;
      });
      for (var k = 0; k < cands.length; k++) {
        var pt = cands[k].pt;
        var bx = [pt[0] - w / 2, pt[1] - h / 2, pt[0] + w / 2, pt[1] + h / 2];
        if (bx[0] < 2 || bx[1] < 2 || bx[2] > box.w - 2 || bx[3] > box.h - 2) continue;
        if (distToLines(pt, focusLines) < h / 2 + 3) continue;
        if (placed.some(function (q) { return boxesOverlap(bx, q); })) continue;
        placed.push(bx);
        labelSVG +=
          '<text class="scroll-cross-label" x="' + (vb.x + pt[0] * u) + '" y="' + (vb.y + pt[1] * u) + '" style="font-size:' + LABEL_PX * u + 'px">' + escapeHTML(name) + "</text>";
        return;
      }
    });

    // markers were built in pixel coordinates relative to the box; shift
    // them into world space via a translate on the group
    return (
      '<svg viewBox="' + vb.x + " " + vb.y + " " + vb.w + " " + vb.h + '" xmlns="http://www.w3.org/2000/svg">' +
      MapRender.sceneryLayersSVG() +
      crossSVG +
      '<path class="scroll-target-line" d="' + baseObj.d + '"/>' +
      labelSVG +
      '<g transform="translate(' + vb.x + "," + vb.y + ')">' + marks + "</g>" +
      "</svg>"
    );
  }

  var COMPASS_DEG = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };

  function buildCardHTML(idx, pos, listLen) {
    var c = STREET_CARDS[idx];
    var type = c.is_square ? "square" : "road";
    var baseObj = MapRender.resolveObjectByName(c.name, type);
    var html = '<div class="scroll-card">';
    html +=
      '<div class="scroll-card-map">' +
      (baseObj ? "" : '<div class="scroll-map-missing">Map unavailable</div>') +
      '<div class="scroll-north-arrow" aria-hidden="true">N&uarr;</div></div>';
    html += '<div class="scroll-card-body">';
    html += '<h2 class="scroll-card-name">' + escapeHTML(c.name) + "</h2>";

    if (c.about) {
      html += '<div class="sc-about"><span class="sc-label">About the name</span> ' + escapeHTML(c.about) + "</div>";
    }

    if (!c.is_square) {
      var o = c.orientation;
      html +=
        '<div class="sc-dir"><span class="sc-arrow" aria-hidden="true" style="transform:rotate(' +
        COMPASS_DEG[o.to] +
        'deg)">&uarr;</span>Runs ' +
        o.from +
        " &rarr; " +
        o.to +
        (o.shape === "curved" ? ' <span class="sc-muted">&middot; curved</span>' : "") +
        "</div>";
      html +=
        '<div class="sc-ends">' +
        '<div class="sc-end"><span class="sc-pill start">Start</span><span class="sc-side">' + o.from + " end</span></div>" +
        '<div class="sc-end-text">' + endText(c.start) + "</div>" +
        '<div class="sc-end"><span class="sc-pill end">End</span><span class="sc-side">' + o.to + " end</span></div>" +
        '<div class="sc-end-text">' + endText(c.end) + "</div>" +
        "</div>";
      html += '<div class="sc-label">Meets along the way &middot; ' + c.intersections.length + "</div>";
    } else {
      html += '<div class="sc-label">Streets that meet here &middot; ' + c.intersections.length + "</div>";
    }
    html += chipList(c.intersections);
    html += '<div class="scroll-card-footer">' + footerHTML(c, pos, listLen) + "</div>";
    html += "</div></div>";
    return html;
  }

  function populateSlot(slot, listLen) {
    var idx = parseInt(slot.dataset.idx, 10);
    var pos = parseInt(slot.dataset.pos, 10);
    slot.innerHTML = buildCardHTML(idx, pos, listLen);
    slot.dataset.populated = "1";
    var c = STREET_CARDS[idx];
    var baseObj = MapRender.resolveObjectByName(c.name, c.is_square ? "square" : "road");
    if (!baseObj) return;
    var mapEl = slot.querySelector(".scroll-card-map");
    var r = mapEl.getBoundingClientRect();
    var box = { w: r.width || feedEl.clientWidth || 390, h: r.height || 300 };
    mapEl.insertAdjacentHTML("afterbegin", buildMapSVG(c, baseObj, box));
  }


  /* ============================== NAVIGATION ============================== */

  function jumpToName(name) {
    var idx = NAME_TO_IDX[norm(name)];
    if (idx == null) return;
    var fullList = ORDERS[state.order];
    var pos = fullList.indexOf(idx);
    if (pos < 0) return;

    navStack.push({ order: state.order, filterStarted: state.filterStarted, pos: currentPos() });
    updateBackChipVisibility();

    if (state.filterStarted) {
      state.filterStarted = false;
      filterCheckbox.checked = false;
    }
    state.positions[state.order] = pos;
    save();
    renderList(pos);
  }

  function goBack() {
    var prev = navStack.pop();
    if (!prev) return;
    updateBackChipVisibility();
    state.order = prev.order;
    orderSelect.value = prev.order;
    state.filterStarted = prev.filterStarted;
    filterCheckbox.checked = prev.filterStarted;
    state.positions[state.order] = prev.pos;
    save();
    renderList(prev.pos);
  }

  feedEl.addEventListener("click", function (e) {
    var chip = e.target.closest(".scroll-chip");
    if (!chip) return;
    jumpToName(chip.getAttribute("data-name"));
  });

  backChip.addEventListener("click", goBack);

  orderSelect.addEventListener("change", function () {
    state.order = orderSelect.value;
    save();
    renderList();
  });

  filterCheckbox.addEventListener("change", function () {
    state.filterStarted = filterCheckbox.checked;
    save();
    renderList(0);
  });

  var scrollTimer = null;
  feedEl.addEventListener("scroll", function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      state.positions[state.order] = currentPos();
      save();
    }, 150);
  });

  renderList();
})();
