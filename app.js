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
  // Hierarchy (Change Request 3): section > module > lesson > object. A
  // lesson like "4.2.1" is the exact same unit this app used to call a
  // "module" - only the name changed, not the numbering.

  var LESSONS_BY_ID = {};
  var LESSON_ORDER = [];

  (function buildIndex() {
    CURRICULUM.sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        mod.lessons.forEach(function (lesson) {
          LESSONS_BY_ID[lesson.id] = {
            id: lesson.id,
            title: lesson.title,
            objects: lesson.objects,
            sectionId: sec.id,
            sectionTitle: sec.title,
            moduleId: mod.id,
            moduleTitle: mod.title,
          };
          LESSON_ORDER.push(lesson.id);
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

  var appEl = document.getElementById("learn-root");
  var route = { screen: "home" };

  function go(newRoute) {
    route = newRoute;
    router();
    window.scrollTo(0, 0);
  }

  function router() {
    if (route.screen === "lesson") {
      renderLessonScreen(route.lessonId);
    } else {
      renderHome();
    }
  }

  /* ============================== HOME SCREEN ============================== */

  function brandMark() {
    return '<img class="brand-mark" src="icons/favicon.svg" alt="" width="38" height="38">';
  }

  function objectCountLabel(lesson) {
    return lesson.objects.length + (lesson.objects.length === 1 ? " object" : " objects");
  }

  function lessonScoreBadge(lessonId) {
    var prog = state.progress[lessonId];
    if (!prog || !prog.attempts) return "";
    return '<div class="lesson-score-badge">' + pct(prog.bestScore) + "</div>";
  }

  function renderHome() {
    var html = "";
    html +=
      '<div class="home-header">' +
      brandMark() +
      "<div><h1>Antwerp Inside the Ring</h1>" +
      '<div class="sub">' +
      CURRICULUM.sections.length +
      " sections &middot; " +
      LESSON_ORDER.length +
      " lessons</div></div></div>";

    if (state.lastOpened && LESSONS_BY_ID[state.lastOpened]) {
      var lm = LESSONS_BY_ID[state.lastOpened];
      html +=
        '<div class="resume-card" id="resumeCard">' +
        '<div><div class="label">Continue</div>' +
        '<div class="title">' +
        lm.id +
        " &middot; " +
        lm.title +
        "</div></div><div>&rarr;</div></div>";
    }

    CURRICULUM.sections.forEach(function (sec) {
      var isOpen = !!state.openSections[sec.id];
      html += '<div class="section-group' + (isOpen ? " open" : "") + '" data-section="' + sec.id + '">';
      html +=
        '<div class="section-header" data-toggle-section="' +
        sec.id +
        '"><div class="section-num">' +
        sec.id +
        '</div><div class="section-title-wrap"><h2>' +
        sec.title +
        '</h2><div class="section-sub">' +
        sec.modules.length +
        " modules</div></div>" +
        '<div class="chevron">&#9656;</div></div>';
      html += '<div class="section-body">';
      sec.modules.forEach(function (mod) {
        html += '<div class="module-block"><div class="module-title">' + mod.id + " &middot; " + mod.title + "</div>";
        mod.lessons.forEach(function (lesson) {
          html +=
            '<div class="lesson-row" data-open-lesson="' +
            lesson.id +
            '"><div class="lesson-id">' +
            lesson.id +
            '</div><div class="lesson-info"><div class="lesson-title">' +
            lesson.title +
            '</div><div class="lesson-count">' +
            objectCountLabel(lesson) +
            "</div></div>" +
            lessonScoreBadge(lesson.id) +
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
        openLesson(state.lastOpened);
      });
    }

    document.querySelectorAll("[data-toggle-section]").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-toggle-section");
        state.openSections[id] = !state.openSections[id];
        saveState();
        renderHome();
      });
    });

    document.querySelectorAll("[data-open-lesson]").forEach(function (el) {
      el.addEventListener("click", function () {
        openLesson(el.getAttribute("data-open-lesson"));
      });
    });

    document.getElementById("resetBtn").addEventListener("click", function () {
      document.getElementById("resetModal").hidden = false;
    });
  }

  function openLesson(lessonId) {
    state.lastOpened = lessonId;
    saveState();
    go({ screen: "lesson", lessonId: lessonId, mode: "learn" });
  }

  /* ============================== VIEWPORT / PAN & ZOOM ============================== */

  /* ============================== MAP RENDERING ============================== */
  // Pan/zoom, scenery layers, and tree icons live in map-render.js (shared
  // with scroll.js) as the global `MapRender`.

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

  function resolveLessonObjects(lesson) {
    var list = [];
    lesson.objects.forEach(function (curObj) {
      var baseObj = resolveObject(curObj);
      if (!baseObj) return; // shouldn't happen; guards against data drift
      list.push({ idx: list.length, curObj: curObj, baseObj: baseObj });
    });
    return list;
  }

  /* ---------- reading-order badge layout (Change Request 3) ---------- */
  // Numbers themselves are computed at build time (build/number_lesson_
  // objects.py) and stored as curObj.number. This only decides where to
  // draw each badge on top of its object's fixed reference point
  // (baseObj.badge): nudged apart, with a short leader line back to the
  // true point, whenever two badges would otherwise overlap on screen.
  // The nudge is expressed in the badge's own local coordinate space (the
  // same space the <circle r="9"> badge glyph is drawn in, before the
  // zoom-driven translate(bx,by) scale(s) transform map-render.js applies)
  // so it scales with the badge - and with the current zoom level - instead
  // of drifting as the user pans/zooms. Numbers never change to resolve an
  // overlap, only badge position does.

  // Badges are drawn in a local space that map-render.js scales with the
  // viewBox (translate(bx,by) scale(vb.w / FULL_VB.w)), which keeps them a
  // constant size on screen: one local unit = mapWidthPx / FULL_VB.w screen
  // pixels at any zoom. So sizes are chosen in screen pixels and converted.
  var BADGE_PX = 20;
  var BADGE_FONT_PX = 11;
  var BADGE_FONT_PX_3DIGIT = 9;

  function computeBadgeLayout(resolvedList, homeVbWidth, mapWidthPx) {
    var n = resolvedList.length;
    var positions = resolvedList.map(function (item) {
      return { x: item.baseObj.badge[0], y: item.baseObj.badge[1] };
    });
    var sHome = homeVbWidth / MapRender.FULL_VB.w;
    // two badges closer than one badge width (+ a little air) on screen at
    // the home zoom overlap; expressed in world units
    var threshold = ((BADGE_PX + 3) * homeVbWidth) / mapWidthPx;
    var offsets = positions.map(function () {
      return { dx: 0, dy: 0 };
    });

    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var ax = positions[i].x + offsets[i].dx;
          var ay = positions[i].y + offsets[i].dy;
          var bx = positions[j].x + offsets[j].dx;
          var by = positions[j].y + offsets[j].dy;
          var dx = bx - ax;
          var dy = by - ay;
          var d = Math.hypot(dx, dy);
          if (d < threshold) {
            var push = (threshold - d) / 2 + 0.5;
            var ux = d === 0 ? 1 : dx / d;
            var uy = d === 0 ? 0 : dy / d;
            offsets[i].dx -= ux * push;
            offsets[i].dy -= uy * push;
            offsets[j].dx += ux * push;
            offsets[j].dy += uy * push;
          }
        }
      }
    }

    // world-space offset -> local badge-space offset (divide by the home
    // zoom's scale factor, since local units get multiplied by scale(s))
    return offsets.map(function (o) {
      return { lx: round2(o.dx / sHome), ly: round2(o.dy / sHome) };
    });
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }


  function notebookCornerPath(cx, cy, size, rTL, rTR, rBR, rBL) {
    var x0 = cx - size / 2,
      y0 = cy - size / 2,
      x1 = cx + size / 2,
      y1 = cy + size / 2;
    return (
      "M " +
      (x0 + rTL) +
      " " +
      y0 +
      " L " +
      (x1 - rTR) +
      " " +
      y0 +
      " Q " +
      x1 +
      " " +
      y0 +
      " " +
      x1 +
      " " +
      (y0 + rTR) +
      " L " +
      x1 +
      " " +
      (y1 - rBR) +
      " Q " +
      x1 +
      " " +
      y1 +
      " " +
      (x1 - rBR) +
      " " +
      y1 +
      " L " +
      (x0 + rBL) +
      " " +
      y1 +
      " Q " +
      x0 +
      " " +
      y1 +
      " " +
      x0 +
      " " +
      (y1 - rBL) +
      " L " +
      x0 +
      " " +
      (y0 + rTL) +
      " Q " +
      x0 +
      " " +
      y0 +
      " " +
      (x0 + rTL) +
      " " +
      y0 +
      " Z"
    );
  }

  function badgeShapeSVG(lx, ly, number, unitsPerPx) {
    var size = BADGE_PX * unitsPerPx;
    var path = notebookCornerPath(lx, ly, size, size * 0.12, size * 0.65, size * 0.12, size * 0.65);
    var fontSize = (number >= 100 ? BADGE_FONT_PX_3DIGIT : BADGE_FONT_PX) * unitsPerPx;
    return (
      '<path class="badge-shape" d="' +
      path +
      '"/><text x="' +
      lx +
      '" y="' +
      (ly + fontSize * 0.08) +
      '" style="font-size:' +
      fontSize +
      'px">' +
      number +
      "</text>"
    );
  }

  function mapSVG(resolvedList, homeVbWidth, mapWidthPx) {
    var layout = computeBadgeLayout(resolvedList, homeVbWidth, mapWidthPx);
    var unitsPerPx = MapRender.FULL_VB.w / mapWidthPx;
    var targets = "";
    resolvedList.forEach(function (item, i) {
      var b = item.baseObj;
      var idx = item.idx;
      var number = item.curObj.number != null ? item.curObj.number : idx + 1;
      var bx = b.badge[0];
      var by = b.badge[1];
      var nudge = layout[i];
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
        ')">' +
        (nudge.lx !== 0 || nudge.ly !== 0
          ? '<line class="badge-leader" x1="0" y1="0" x2="' + nudge.lx + '" y2="' + nudge.ly + '"/>'
          : "") +
        badgeShapeSVG(nudge.lx, nudge.ly, number, unitsPerPx) +
        "</g>";
      targets += "</g>";
    });

    return (
      '<div class="map-shell">' +
      '<svg id="map" viewBox="' +
      MAP_DATA.viewBox +
      '" xmlns="http://www.w3.org/2000/svg">' +
      MapRender.sceneryLayersSVG() +
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

  /* ============================== LESSON SCREEN ============================== */

  var lessonRuntime = {}; // per-open-lesson transient state (not persisted mid-quiz)

  function renderLessonScreen(lessonId) {
    var lesson = LESSONS_BY_ID[lessonId];
    if (!lesson) {
      go({ screen: "home" });
      return;
    }
    if (!lessonRuntime.lessonId || lessonRuntime.lessonId !== lessonId) {
      lessonRuntime = {
        lessonId: lessonId,
        resolved: resolveLessonObjects(lesson),
        mode: route.mode || "learn",
        selectedIdx: null,
      };
    }

    var html =
      '<header class="lesson-header">' +
      '<div class="top-row"><button class="back-btn" id="backHome">&larr; Lessons</button></div>' +
      '<div class="eyebrow">' +
      lesson.sectionId +
      " " +
      lesson.sectionTitle +
      " &middot; " +
      lesson.moduleId +
      " " +
      lesson.moduleTitle +
      "</div>" +
      "<h1>" +
      lesson.id +
      " &middot; " +
      lesson.title +
      "</h1>" +
      '<div class="mode-switch">' +
      '<button id="btn-learn" class="' +
      (lessonRuntime.mode === "learn" ? "active" : "") +
      '">Learn</button>' +
      '<button id="btn-quiz" class="' +
      (lessonRuntime.mode === "quiz" ? "active" : "") +
      '">Quiz</button>' +
      "</div></header>" +
      '<div id="map-wrap"></div>' +
      '<div id="learn-panel" class="hidden"></div>' +
      '<div id="quiz-panel" class="hidden"></div>' +
      '<div id="quiz-results"></div>';

    appEl.innerHTML = html;
    var mapWrap = document.getElementById("map-wrap");
    mapWrap.style.aspectRatio = String(MapRender.MAP_ASPECT);

    var lessonBBox = MapRender.unionBBox(
      lessonRuntime.resolved.map(function (item) {
        return item.baseObj.bbox;
      })
    );
    var home = MapRender.fitViewBoxForBBox(lessonBBox);
    mapWrap.innerHTML = mapSVG(lessonRuntime.resolved, home.w, mapWrap.getBoundingClientRect().width || 390);

    document.getElementById("backHome").addEventListener("click", function () {
      go({ screen: "home" });
    });
    document.getElementById("btn-learn").addEventListener("click", function () {
      setMode(lesson, "learn");
    });
    document.getElementById("btn-quiz").addEventListener("click", function () {
      setMode(lesson, "quiz");
    });

    var svg = document.getElementById("map");
    svg.classList.toggle("quiz-mode", lessonRuntime.mode === "quiz");
    lessonRuntime.mapController = MapRender.createMapController(svg, lessonBBox, function (idx) {
      onMapObjectTap(lesson, idx);
    });
    document.getElementById("mapRecenter").addEventListener("click", function () {
      lessonRuntime.mapController.reset();
    });

    if (lessonRuntime.mode === "learn") {
      renderLearnPanel(lesson);
    } else {
      renderQuizPanel(lesson);
    }
  }

  function setMode(lesson, mode) {
    lessonRuntime.mode = mode;
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
      renderLearnPanel(lesson);
    } else {
      document.getElementById("learn-panel").classList.add("hidden");
      startQuiz(lesson);
    }
  }

  function onMapObjectTap(lesson, idx) {
    if (lessonRuntime.mode === "learn") {
      selectLearnObject(lesson, idx);
    } else {
      handleQuizAnswer(lesson, idx);
    }
  }

  /* ---------- LEARN MODE ---------- */

  function objectNumber(item) {
    return item.curObj.number != null ? item.curObj.number : item.idx + 1;
  }

  function renderLearnPanel(lesson) {
    var panel = document.getElementById("learn-panel");
    panel.classList.remove("hidden");
    // Displayed in reading-order (Change Request 3), independent of the
    // underlying resolved-list order used for quiz hit-testing.
    var byNumber = lessonRuntime.resolved.slice().sort(function (a, b) {
      return objectNumber(a) - objectNumber(b);
    });
    var html = "";
    byNumber.forEach(function (item) {
      html +=
        '<div class="obj-row" data-idx="' +
        item.idx +
        '"><div class="rank">' +
        objectNumber(item) +
        '</div><div class="info"><div class="name">' +
        item.curObj.name +
        '</div><div class="meta">' +
        metaLine(item.curObj, item.baseObj) +
        "</div></div></div>";
    });
    panel.innerHTML = html;
    panel.querySelectorAll(".obj-row").forEach(function (row) {
      row.addEventListener("click", function () {
        selectLearnObject(lesson, parseInt(row.getAttribute("data-idx"), 10));
      });
    });
    ensureSheet();
  }

  function selectLearnObject(lesson, idx) {
    var svg = document.getElementById("map");
    svg.querySelectorAll(".obj").forEach(function (g) {
      g.classList.toggle("selected", g.getAttribute("data-idx") === String(idx));
    });
    document.querySelectorAll(".obj-row").forEach(function (row) {
      row.classList.toggle("selected", row.getAttribute("data-idx") === String(idx));
    });
    var item = lessonRuntime.resolved[idx];
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
    document.getElementById("sheet-rank").textContent = "#" + objectNumber(item) + " of " + lessonRuntime.resolved.length;
    document.getElementById("sheet-name").textContent = item.curObj.name;
    document.getElementById("sheet-meta").textContent = metaLine(item.curObj, item.baseObj);
    document.getElementById("detail-sheet").classList.add("open");
  }

  function closeSheet() {
    var sheet = document.getElementById("detail-sheet");
    if (sheet) sheet.classList.remove("open");
  }

  /* ---------- QUIZ MODE ---------- */

  function startQuiz(lesson) {
    lessonRuntime.quiz = {
      order: shuffle(lessonRuntime.resolved),
      index: 0,
      score: 0,
      answered: false,
      results: [],
    };
    document.getElementById("quiz-panel").classList.remove("hidden");
    document.getElementById("quiz-results").classList.remove("show");
    renderQuizQuestion();
  }

  function renderQuizPanel(lesson) {
    document.getElementById("quiz-panel").classList.remove("hidden");
    var q = lessonRuntime.quiz;
    if (!q || q.index >= q.order.length) {
      startQuiz(lesson);
    } else {
      renderQuizQuestion();
    }
  }

  function renderQuizQuestion() {
    var q = lessonRuntime.quiz;
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

  function handleQuizAnswer(lesson, tappedIdx) {
    var q = lessonRuntime.quiz;
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
      var tappedItem = lessonRuntime.resolved[tappedIdx];
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
    var q = lessonRuntime.quiz;
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
    var q = lessonRuntime.quiz;
    var score = q.score / q.order.length;
    var lessonId = lessonRuntime.lessonId;
    var prog = state.progress[lessonId] || { attempts: 0, bestScore: 0 };
    prog.attempts++;
    prog.bestScore = Math.max(prog.bestScore, score);
    state.progress[lessonId] = prog;
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
    html += '<button class="btn btn-secondary" id="quiz-home-btn">Back to Lessons</button>';
    results.innerHTML = html;
    document.getElementById("quiz-retry-btn").addEventListener("click", function () {
      results.classList.remove("show");
      startQuiz(LESSONS_BY_ID[lessonId]);
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
    state.openSections[CURRICULUM.sections[0].id] = true;
  }

  router();
})();
