/* 화면(탭) 좌우 밀기: 손가락으로 좌우로 밀면 옆 탭(홈 ↔ 업무 ↔ 일정 ↔ 가계부 ↔ 메모 ↔ 뉴스 ↔ 증권뉴스)으로 넘어간다.
   - 달력·목차 띠처럼 자체로 가로 스크롤되는 곳, 입력칸, 앱 아이콘 끌기, 일정 창이 열려 있을 때는 동작하지 않는다.
   - 위 탭을 눌러 옮길 때도 같은 방향으로 미끄러져 들어온다. */
(function () {
  "use strict";
  var ORDER = ["home", "work", "plan", "money", "notes", "news", "stock"];
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var g = null, lastView = cur();

  function cur() { var v = (location.hash || "").slice(1); return v === "inbox" || ORDER.indexOf(v) >= 0 ? v : "home"; }
  function viewEl(v) { return document.getElementById("v-" + v); }
  function blocked(t) {
    if (!t || !t.closest) return true;
    if (document.body.classList.contains("modal-open")) return true;
    if (t.closest("input,textarea,select,[contenteditable],svg,canvas,#apps,.hedit,.hb-bar,.pscroll,.nb-tabs,nav.tabs,.remind,.notice,.toast,#notice,[data-noswipe]")) return true;
    /* 가로로 스크롤되는 상자 안에서 시작했으면 그 상자에 맡긴다 */
    for (var el = t; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2) { var ox = getComputedStyle(el).overflowX; if (ox === "auto" || ox === "scroll") return true; }
    }
    var sel = window.getSelection && window.getSelection(); if (sel && !sel.isCollapsed) return true;
    return false;
  }
  function neighbor(dir) { var i = ORDER.indexOf(cur()); if (i < 0) return null; return ORDER[i + dir] || null; }

  function start(e) {
    if (e.touches.length !== 1 || blocked(e.target)) { g = null; return; }
    var t = e.touches[0], el = viewEl(cur());
    g = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, lock: "", el: el, w: el ? el.clientWidth || window.innerWidth : window.innerWidth };
  }
  function move(e) {
    if (!g || e.touches.length !== 1) return;
    var t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.lock) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
      if (g.lock === "y") { g = null; return; }
      if (g.el) { g.el.style.transition = "none"; g.el.style.willChange = "transform"; }
    }
    e.preventDefault();
    g.dx = dx;
    var has = neighbor(dx < 0 ? 1 : -1), shift = has ? dx : dx * 0.25; // 끝 탭에서는 살짝만 끌림
    if (g.el && !reduce) { g.el.style.transform = "translateX(" + shift + "px)"; g.el.style.opacity = String(1 - Math.min(Math.abs(shift) / g.w, 1) * 0.35); }
  }
  function end() {
    if (!g) return;
    var s = g; g = null;
    if (s.lock !== "x") return;
    var dir = s.dx < 0 ? 1 : -1, to = neighbor(dir), v = Math.abs(s.dx) / Math.max(1, Date.now() - s.t);
    var go = to && (Math.abs(s.dx) > s.w * 0.25 || (Math.abs(s.dx) > 50 && v > 0.45));
    var el = s.el; if (!el) { if (go) location.hash = to; return; }
    function clear() { el.style.transition = ""; el.style.transform = ""; el.style.opacity = ""; el.style.willChange = ""; }
    if (!go) {
      if (reduce) { clear(); return; }
      el.style.transition = "transform .2s ease, opacity .2s ease"; el.style.transform = "translateX(0)"; el.style.opacity = "1";
      setTimeout(clear, 220); return;
    }
    if (reduce) { clear(); location.hash = to; return; }
    el.style.transition = "transform .16s ease-in, opacity .16s ease-in";
    el.style.transform = "translateX(" + (-dir * s.w) + "px)"; el.style.opacity = "0";
    setTimeout(function () { clear(); location.hash = to; }, 160);
  }

  /* 탭이 바뀌면 새 화면이 방향에 맞춰 옆에서 미끄러져 들어오고, 위 탭 띠도 고른 탭이 보이게 옮긴다 */
  function changed() {
    var now = cur(), a = ORDER.indexOf(lastView), b = ORDER.indexOf(now);
    lastView = now;
    var el = viewEl(now);
    if (el && !reduce && a >= 0 && b >= 0 && a !== b && el.animate) {
      var from = (b > a ? 1 : -1) * 40;
      el.animate([{ transform: "translateX(" + from + "%)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,.7,.3,1)" });
    }
    var bar = document.querySelector("nav.tabs .wrap"), on = bar && bar.querySelector('a[href="#' + now + '"]');
    if (bar && on && bar.scrollWidth > bar.clientWidth) {
      var l = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
      try { bar.scrollTo({ left: Math.max(0, l), behavior: reduce ? "auto" : "smooth" }); } catch (x) { bar.scrollLeft = Math.max(0, l); }
    }
  }

  /* 화면 아래 빈 곳에서 밀어도 되도록 문서 전체에서 받는다 */
  var main = document;
  main.addEventListener("touchstart", start, { passive: true });
  main.addEventListener("touchmove", move, { passive: false });
  main.addEventListener("touchend", end, { passive: true });
  main.addEventListener("touchcancel", function () { if (g && g.el) { g.el.style.transition = ""; g.el.style.transform = ""; g.el.style.opacity = ""; } g = null; }, { passive: true });
  window.addEventListener("hashchange", changed);
})();
