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
      '<svg id="map" viewBox="' +
      MAP_DATA.viewBox +
      '" xmlns="http://www.w3.org/2000/svg">' +
      '<path class="bg-neighborhoods" d="' +
      MAP_DATA.bgNeighborhoods +
      '"/>' +
      '<path class="bg-waterways" d="' +
      MAP_DATA.bgWaterways +
      '"/>' +
      '<path class="bg-streets" d="' +
      MAP_DATA.bgStreets +
      '"/>' +
      '<path class="boundary" d="' +
      MAP_DATA.boundary +
      '"/>' +
      '<g id="targets">' +
      targets +
      "</g>" +
      "</svg>"
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
    document.getElementById("map-wrap").innerHTML = mapSVG(moduleRuntime.resolved);

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
    svg.addEventListener("click", function (e) {
      var t = e.target.closest("[data-idx]");
      if (!t) return;
      var idx = parseInt(t.getAttribute("data-idx"), 10);
      onMapObjectTap(mod, idx);
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
