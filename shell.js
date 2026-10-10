// The app shell: one page, four views (Scroll, Learn, Walk, Explore) and a
// tab bar along the bottom to switch between them. Scroll opens by default.
//
// Each view's scripts load the first time its tab is opened (the map and
// street data are large, and most visits only use one or two views), then
// the view stays in the page while hidden, so switching back resumes exactly
// where the user left off: a lesson mid-quiz, a Walk round, the Explore
// viewport.
//
// Views register optional hooks with AppShell.register(name, {onShow}) for
// anything that needs fixing up after being hidden (e.g. re-measuring a map);
// AppShell.show(name, payload) can also pass the view something to do.
var AppShell = (function () {
  "use strict";

  var MAP = "data/generated/map-data.js";
  var TABS = [
    {
      id: "scroll",
      label: "Scroll",
      scripts: [MAP, "data/generated/street-cards.js", "map-render.js", "scroll.js"],
      // a stack of cards
      icon: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M7 4h10"/>',
    },
    {
      id: "learn",
      label: "Learn",
      scripts: [MAP, "data/generated/curriculum-data.js", "map-render.js", "app.js"],
      // an open book
      icon:
        '<path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/>',
    },
    {
      id: "walk",
      label: "Walk",
      scripts: [MAP, "data/generated/street-graph.js", "map-render.js", "walk.js", "walk-page.js"],
      // a route from A to B
      icon:
        '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
    },
    {
      id: "explore",
      label: "Explore",
      scripts: [MAP, "map-render.js", "explore.js"],
      // a compass
      icon: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    },
  ];
  var DEFAULT_TAB = "scroll";

  var byId = {};
  TABS.forEach(function (t) {
    byId[t.id] = t;
  });

  var hooks = {};
  var scriptPromises = {}; // src -> Promise, so shared scripts load once
  var ready = {}; // tab id -> Promise for all of its scripts
  var scrollY = {}; // tab id -> window scroll offset when last left
  var current = null;

  function loadScript(src) {
    if (!scriptPromises[src]) {
      scriptPromises[src] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src;
        s.async = false; // dynamically added scripts still execute in order
        s.onload = resolve;
        s.onerror = function () {
          delete scriptPromises[src]; // allow a retry
          reject(new Error("Couldn't load " + src));
        };
        document.body.appendChild(s);
      });
    }
    return scriptPromises[src];
  }

  function viewEl(id) {
    return document.getElementById("view-" + id);
  }

  function ensureLoaded(id) {
    if (!ready[id]) {
      var view = viewEl(id);
      var mount = view.querySelector("[data-mount]") || view;
      mount.innerHTML = '<div class="view-status">Loading…</div>';
      ready[id] = Promise.all(byId[id].scripts.map(loadScript)).catch(function (err) {
        delete ready[id];
        mount.innerHTML =
          '<div class="view-status">Couldn’t load this part of the app. Check your connection and tap the tab again.</div>';
        throw err;
      });
    }
    return ready[id];
  }

  // payload (optional) is handed to the view's onShow - e.g. Scroll's "View
  // in Explore" passes {focus: {type, name}}
  function show(id, payload) {
    if (!byId[id]) id = DEFAULT_TAB;
    if (id === current) {
      if (payload && hooks[id] && hooks[id].onShow) hooks[id].onShow(payload);
      return;
    }
    if (current) {
      scrollY[current] = window.scrollY;
      viewEl(current).hidden = true;
    }
    current = id;
    document.body.setAttribute("data-tab", id);
    viewEl(id).hidden = false;
    document.querySelectorAll(".tabbar-tab").forEach(function (b) {
      var on = b.getAttribute("data-tab") === id;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, scrollY[id] || 0);
    ensureLoaded(id).then(
      function () {
        if (current === id && hooks[id] && hooks[id].onShow) hooks[id].onShow(payload);
      },
      function () {}
    );
  }

  function register(id, h) {
    hooks[id] = h;
  }

  function renderTabbar() {
    var nav = document.getElementById("tabbar");
    nav.innerHTML = TABS.map(function (t) {
      return (
        '<button class="tabbar-tab" data-tab="' +
        t.id +
        '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        t.icon +
        "</svg>" +
        "<span>" +
        t.label +
        "</span></button>"
      );
    }).join("");
    nav.addEventListener("click", function (e) {
      var b = e.target.closest(".tabbar-tab");
      if (b) show(b.getAttribute("data-tab"));
    });
  }

  renderTabbar();
  // The old per-mode pages (learn.html etc.) redirect here as index.html#learn;
  // honour that once, then drop the hash so the address stays the plain app URL.
  var initial = location.hash.replace("#", "");
  if (location.hash && window.history && history.replaceState) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  show(byId[initial] ? initial : DEFAULT_TAB);

  return { register: register, show: show };
})();
