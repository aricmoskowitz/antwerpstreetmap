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

  function moduleKey(mods) {
    if (!mods.length) return [999999];
    var parts = mods.map(function (id) {
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

    var withMod = idxs.filter(function (i) {
      return STREET_CARDS[i].modules.length;
    });
    var withoutMod = idxs.filter(function (i) {
      return !STREET_CARDS[i].modules.length;
    });
    withMod.sort(function (a, b) {
      var c = cmpParts(moduleKey(STREET_CARDS[a].modules), moduleKey(STREET_CARDS[b].modules));
      if (c) return c;
      return STREET_CARDS[a].name.localeCompare(STREET_CARDS[b].name);
    });
    withoutMod.sort(function (a, b) {
      return STREET_CARDS[a].name.localeCompare(STREET_CARDS[b].name);
    });
    ORDERS.curriculum = withMod.concat(withoutMod);

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

  /* ============================== STARTED-MODULE FILTER ============================== */

  function startedModuleSet() {
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
    var started = startedModuleSet();
    return base.filter(function (i) {
      return STREET_CARDS[i].modules.some(function (m) {
        return started[m];
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
        '<div class="scroll-empty">No streets from modules you’ve started yet. Try unchecking ' +
        '&ldquo;Started only&rdquo;, or start a module in Learn first.</div>';
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

  function startEndText(endpoint) {
    if (!endpoint.crosses.length) return "Dead end";
    return "Meets " + joinNames(endpoint.crosses);
  }

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
    if (c.modules.length) bits.push(escapeHTML(c.modules.join(", ")));
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

  function endpointMarkerSVG(pixel, label, r, font) {
    return (
      '<g class="scroll-endpoint" transform="translate(' +
      pixel[0] +
      "," +
      pixel[1] +
      ')">' +
      '<circle r="' +
      r +
      '"/><text y="' +
      font * 0.08 +
      '" style="font-size:' +
      font +
      'px">' +
      label +
      "</text></g>"
    );
  }

  function buildMapSVG(c, baseObj) {
    var vb = MapRender.fitViewBoxForBBox(baseObj.bbox, { padding: 0.45, minSize: 55 });
    var s = vb.w / MapRender.FULL_VB.w;
    var svg = '<svg viewBox="' + vb.x + " " + vb.y + " " + vb.w + " " + vb.h + '" xmlns="http://www.w3.org/2000/svg">';
    svg += MapRender.sceneryLayersSVG();

    c.intersections.forEach(function (name) {
      var ob = MapRender.resolveObjectByName(name, "road") || MapRender.resolveObjectByName(name, "square");
      if (!ob) return;
      svg += '<path class="scroll-cross-line" d="' + ob.d + '"/>';
      svg +=
        '<text class="scroll-cross-label" x="' +
        ob.badge[0] +
        '" y="' +
        ob.badge[1] +
        '" style="font-size:' +
        9 * s +
        'px">' +
        escapeHTML(name) +
        "</text>";
    });

    svg += '<path class="scroll-target-line" d="' + baseObj.d + '"/>';

    if (!c.is_square) {
      svg += endpointMarkerSVG(c.start.pixel, "S", 7 * s, 9 * s);
      svg += endpointMarkerSVG(c.end.pixel, "E", 7 * s, 9 * s);
    }

    svg += "</svg>";
    return svg;
  }

  function buildCardHTML(idx, pos, listLen) {
    var c = STREET_CARDS[idx];
    var type = c.is_square ? "square" : "road";
    var baseObj = MapRender.resolveObjectByName(c.name, type);
    var mapHTML = baseObj
      ? buildMapSVG(c, baseObj)
      : '<div class="scroll-map-missing">Map unavailable</div>';

    var html = '<div class="scroll-card">';
    html +=
      '<div class="scroll-card-map">' +
      mapHTML +
      '<div class="scroll-north-arrow" aria-hidden="true">N&uarr;</div>' +
      "</div>";
    html += '<div class="scroll-card-body">';
    html += '<h2 class="scroll-card-name">' + escapeHTML(c.name) + "</h2>";

    if (c.about) {
      html +=
        '<div class="scroll-card-row"><div class="scroll-card-label">About the name</div>' +
        escapeHTML(c.about) +
        "</div>";
    }

    if (!c.is_square) {
      var axisText =
        c.orientation.axis + (c.orientation.shape === "curved" ? " · curved" : "");
      html +=
        '<div class="scroll-card-row"><div class="scroll-card-label">Orientation</div>' +
        escapeHTML(axisText) +
        "</div>";
      html +=
        '<div class="scroll-card-row"><div class="scroll-card-label">Start</div>' +
        startEndText(c.start) +
        "</div>";
      html +=
        '<div class="scroll-card-row"><div class="scroll-card-label">End</div>' +
        startEndText(c.end) +
        "</div>";
      html +=
        '<div class="scroll-card-row"><div class="scroll-card-label">Meets along the way</div>' +
        chipList(c.intersections) +
        "</div>";
    } else {
      html +=
        '<div class="scroll-card-row"><div class="scroll-card-label">Streets that meet here</div>' +
        chipList(c.intersections) +
        "</div>";
    }

    html += '<div class="scroll-card-footer">' + footerHTML(c, pos, listLen) + "</div>";
    html += "</div></div>";
    return html;
  }

  function populateSlot(slot, listLen) {
    var idx = parseInt(slot.dataset.idx, 10);
    var pos = parseInt(slot.dataset.pos, 10);
    slot.innerHTML = buildCardHTML(idx, pos, listLen);
    slot.dataset.populated = "1";
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
