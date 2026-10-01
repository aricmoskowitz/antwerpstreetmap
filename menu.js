(function () {
  "use strict";

  var LEARN_LS_KEY = "antwerpRing.v1";
  var SCROLL_LS_KEY = "antwerpScroll.v1";
  var PASS_THRESHOLD = 0.7;

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function learnStats() {
    var total = 0;
    CURRICULUM.sections.forEach(function (sec) {
      sec.modules.forEach(function (mod) {
        total += mod.lessons.length;
      });
    });
    var state = readJSON(LEARN_LS_KEY);
    var complete = 0;
    if (state && state.progress) {
      Object.keys(state.progress).forEach(function (id) {
        var p = state.progress[id];
        if (p && p.attempts && p.bestScore >= PASS_THRESHOLD) complete++;
      });
    }
    return { total: total, complete: complete };
  }

  function scrollStats() {
    var state = readJSON(SCROLL_LS_KEY);
    if (!state || !state.total) return null;
    var order = state.order || "curriculum";
    var pos = (state.positions && state.positions[order]) || 0;
    return { position: pos + 1, total: state.total };
  }

  function card(href, title, subtitle, progressLine) {
    return (
      '<a class="menu-card" href="' +
      href +
      '">' +
      '<div class="menu-card-title">' +
      title +
      "</div>" +
      '<div class="menu-card-sub">' +
      subtitle +
      "</div>" +
      (progressLine ? '<div class="menu-card-progress">' + progressLine + "</div>" : "") +
      "</a>"
    );
  }

  function render() {
    var ls = learnStats();
    var ss = scrollStats();

    var learnProgress =
      ls.complete > 0
        ? ls.complete + " / " + ls.total + " lessons complete"
        : "Not started yet";
    var scrollProgress = ss
      ? ss.position.toLocaleString() + " / " + ss.total.toLocaleString() + " streets seen"
      : "Not started yet";

    var html =
      '<div class="menu-header">' +
      "<h1>Antwerp Inside the Ring</h1>" +
      '<div class="sub">Pick how you want to explore</div>' +
      "</div>" +
      '<div class="menu-cards">' +
      card("learn.html", "Learn", "Lessons &amp; quizzes", learnProgress) +
      card("scroll.html", "Scroll", "Browse every street, one card at a time", scrollProgress) +
      "</div>";

    document.getElementById("app").innerHTML = html;
  }

  render();
})();
