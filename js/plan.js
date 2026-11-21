/* 일정 탭: 좌우로 밀어 넘기는 달력 + 날짜를 누르면 그날 일정 창(일정 등록·알림 설정) */
(function () {
  "use strict";
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var REMIND = { "0": "일정 시각에", "10": "10분 전", "30": "30분 전", "60": "1시간 전", "1440": "하루 전" };
  var W, ready = false, month = "", sel = "", busy = false, settleT = 0, lastSig = "", opened = false, lastFocus = null;

  function S() { return W.state(); }
  function mkey(d) { return d.getFullYear() + "-" + W.pad(d.getMonth() + 1); }
  function shiftMonth(k, n) { var p = k.split("-"); return mkey(new Date(+p[0], +p[1] - 1 + n, 1)); }
  function evsOn(date) {
    return W.sortBy((S().events || []).filter(function (e) { return W.occurs(e, date); }), function (e) { return e.time || ""; });
  }

  function openDay(date) {
    sel = date; lastSig = "";
    if (!opened) lastFocus = document.activeElement;
    opened = true;
    W.$("#p-modal").hidden = false;
    document.body.classList.add("modal-open");
    W.draw();
    setTimeout(function () { var t = W.$("#p-title"); if (t && window.matchMedia("(hover:hover)").matches) t.focus(); }, 30);
  }
  function closeDay() {
    if (!opened) return;
    opened = false;
    W.$("#p-modal").hidden = true;
    document.body.classList.remove("modal-open");
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }

  function resetForm() {
    var $ = W.$;
    $("#p-title").value = ""; $("#p-time").value = ""; $("#p-allday").checked = false; $("#p-time").disabled = false;
    $("#p-repeat").value = ""; $("#p-until").value = ""; $("#p-until").hidden = true; $("#p-remind").value = "";
  }

  function setup() {
    W = window.WB; ready = true;
    var $ = W.$;
    month = mkey(new Date()); sel = W.today();
    $("#p-prev").addEventListener("click", function () { go(-1); });
    $("#p-next").addEventListener("click", function () { go(1); });
    $("#p-now").addEventListener("click", function () { month = mkey(new Date()); sel = W.today(); lastSig = ""; W.draw(); });
    var sc = $("#p-scroll");
    sc.addEventListener("scroll", function () {
      busy = true; clearTimeout(settleT);
      settleT = setTimeout(function () {
        var w = sc.clientWidth || 1, i = Math.round(sc.scrollLeft / w);
        busy = false;
        if (i === 0) go(-1, true); else if (i === 2) go(1, true); else center();
      }, 140);
    }, { passive: true });
    window.addEventListener("resize", center);
    $("#p-close").addEventListener("click", closeDay);
    $("#p-back").addEventListener("click", closeDay);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && opened) closeDay(); });
    window.addEventListener("hashchange", closeDay);
    $("#p-allday").addEventListener("change", function (e) { $("#p-time").disabled = e.target.checked; if (e.target.checked) $("#p-time").value = ""; });
    $("#p-repeat").addEventListener("change", function (e) { $("#p-until").hidden = !e.target.value; });
    W.on("#p-form", function () {
      var title = W.val("#p-title"); if (!title) return;
      var all = $("#p-allday").checked, rp = $("#p-repeat").value, rm = $("#p-remind").value;
      var o = { title: title, date: sel, time: all ? "" : W.val("#p-time") };
      if (all) o.allDay = true;
      if (rp) { o.repeat = rp; if (W.val("#p-until")) o.until = W.val("#p-until"); }
      if (rm !== "") o.remind = +rm;
      W.add("events", o);
      W.toast(W.nice(sel) + " 일정을 추가했습니다" + (rm !== "" ? " · 알림 " + REMIND[rm] : ""));
      resetForm();
      $("#p-title").focus();
    });
  }
  function go(n, fromScroll) {
    month = shiftMonth(month, n);
    if (sel.slice(0, 7) !== month) sel = month === mkey(new Date()) ? W.today() : month + "-01";
    lastSig = "";
    if (fromScroll) paintCal(); else W.draw();
  }
  function center() { var sc = W.$("#p-scroll"); if (!sc || busy) return; sc.scrollLeft = sc.clientWidth; }

  function grid(k) {
    var h = W.h, p = k.split("-"), first = new Date(+p[0], +p[1] - 1, 1).getDay(), days = new Date(+p[0], +p[1], 0).getDate(), td = W.today();
    var g = h("div", { class: "pgrid" });
    DOW.forEach(function (d, i) { g.appendChild(h("div", { class: "pdow" + (i === 0 ? " sun" : i === 6 ? " sat" : "") }, d)); });
    for (var i = 0; i < first; i++) g.appendChild(h("div", { class: "pcell blank" }));
    for (var d = 1; d <= days; d++) (function (d) {
      var date = k + "-" + W.pad(d), ev = evsOn(date), wd = (first + d - 1) % 7;
      var label = d + "일" + (ev.length ? " 일정 " + ev.length + "개" : "") + ". 누르면 일정 창이 열립니다";
      g.appendChild(h("button", { type: "button", class: "pcell" + (date === td ? " today" : "") + (date === sel ? " sel" : "") + (wd === 0 ? " sun" : wd === 6 ? " sat" : ""),
        "aria-label": label, "aria-haspopup": "dialog",
        onclick: function () { openDay(date); } },
        h("span", { class: "n" }, d),
        ev.slice(0, 2).map(function (e) { return h("span", { class: "ev" }, (e.remind != null ? "🔔" : "") + e.title); }),
        ev.length > 2 ? h("span", { class: "more" }, "+" + (ev.length - 2)) : null));
    })(d);
    return g;
  }
  function paintCal() {
    var $ = W.$, p = month.split("-"), sc = $("#p-scroll");
    $("#p-label").textContent = p[0] + "년 " + (+p[1]) + "월";
    $("#p-now").hidden = month === mkey(new Date()) && sel === W.today();
    sc.textContent = "";
    [-1, 0, 1].forEach(function (n) { var k = shiftMonth(month, n); sc.appendChild(W.h("div", { class: "pmonth", "aria-hidden": n ? "true" : null }, grid(k))); });
    center();
    requestAnimationFrame(center);
  }

  function dayList() {
    var h = W.h, $ = W.$, ev = evsOn(sel);
    $("#p-day-title").textContent = W.nice(sel) + (sel === W.today() ? " · 오늘" : "");
    var items = ev.map(function (e) {
      var sub = [];
      if (e.repeat) sub.push("↻ " + W.REP[e.repeat] + (e.until ? " ~" + W.nice(e.until) : ""));
      if (e.remind != null && REMIND[String(e.remind)]) sub.push("🔔 " + REMIND[String(e.remind)]);
      return h("li", null, h("span", { class: "pill info" }, e.time || "종일"),
        h("span", { class: "main" }, h("b", null, e.title), sub.length ? h("div", { class: "sub" }, sub.join(" · ")) : null),
        W.delBtn(function () { W.del("events", e.id); if (e.repeat) W.toast("반복 일정 전체를 지웠습니다"); }));
    });
    W.fill($("#p-day-list"), items, "이 날 일정이 없습니다. 위에서 바로 적으세요.");
  }

  function render() {
    if (!window.WB) return;
    if (!ready) setup();
    if (!W.$("#v-plan").classList.contains("on")) { if (opened) closeDay(); return; }
    var sig = month + "|" + sel + "|" + JSON.stringify(S().events || []) + W.today();
    if (sig !== lastSig && !busy) { lastSig = sig; paintCal(); }
    if (opened) dayList();
  }
  window.WBRemindLabel = REMIND;
  (window.WBViews = window.WBViews || []).push(render);
})();
