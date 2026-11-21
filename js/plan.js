/* 일정 탭: 좌우로 밀어 넘기는 달력 + 고른 날의 일정·할 일 입력 */
(function () {
  "use strict";
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var W, ready = false, month = "", sel = "", busy = false, settleT = 0, lastSig = "";

  function S() { return W.state(); }
  function mkey(d) { return d.getFullYear() + "-" + W.pad(d.getMonth() + 1); }
  function shiftMonth(k, n) { var p = k.split("-"); return mkey(new Date(+p[0], +p[1] - 1 + n, 1)); }
  function evsOn(date) {
    return W.sortBy((S().events || []).filter(function (e) { return W.occurs(e, date); }), function (e) { return e.time || ""; });
  }
  function tasksOn(date) { return (S().tasks || []).filter(function (t) { return t.due === date; }); }

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
    document.querySelectorAll('input[name="ptype"]').forEach(function (r) { r.addEventListener("change", formMode); });
    $("#p-allday").addEventListener("change", function (e) { $("#p-time").disabled = e.target.checked; if (e.target.checked) $("#p-time").value = ""; });
    $("#p-repeat").addEventListener("change", function (e) { $("#p-until").hidden = !e.target.value; });
    W.on("#p-form", function (f) {
      var title = W.val("#p-title"); if (!title) return;
      if (type() === "task") {
        W.add("tasks", { text: title, due: sel, done: false });
        W.toast(W.nice(sel) + " 할 일을 추가했습니다");
      } else {
        var all = $("#p-allday").checked, rp = $("#p-repeat").value, o = { title: title, date: sel, time: all ? "" : W.val("#p-time") };
        if (all) o.allDay = true;
        if (rp) { o.repeat = rp; if (W.val("#p-until")) o.until = W.val("#p-until"); }
        W.add("events", o);
        W.toast(W.nice(sel) + " 일정을 추가했습니다");
      }
      $("#p-title").value = ""; $("#p-time").value = ""; $("#p-allday").checked = false; $("#p-time").disabled = false;
      $("#p-repeat").value = ""; $("#p-until").value = ""; $("#p-until").hidden = true;
      $("#p-title").focus();
    });
    formMode();
  }
  function type() { return (document.querySelector('input[name="ptype"]:checked') || {}).value || "event"; }
  function formMode() { var ev = type() === "event"; W.$("#p-evopts").hidden = !ev; W.$("#p-title").placeholder = ev ? "일정 이름" : "할 일"; }
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
      var date = k + "-" + W.pad(d), ev = evsOn(date), tk = tasksOn(date), open = tk.filter(function (t) { return !t.done; }).length, wd = (first + d - 1) % 7;
      var label = d + "일" + (ev.length ? " 일정 " + ev.length + "개" : "") + (tk.length ? " 할 일 " + tk.length + "개" : "");
      g.appendChild(h("button", { type: "button", class: "pcell" + (date === td ? " today" : "") + (date === sel ? " sel" : "") + (wd === 0 ? " sun" : wd === 6 ? " sat" : ""),
        "aria-label": label, "aria-pressed": date === sel ? "true" : "false",
        onclick: function () { sel = date; lastSig = ""; W.draw(); } },
        h("span", { class: "n" }, d),
        ev.slice(0, 2).map(function (e) { return h("span", { class: "ev" }, e.title); }),
        ev.length > 2 ? h("span", { class: "more" }, "+" + (ev.length - 2)) : null,
        tk.length ? h("span", { class: "tk" + (open ? "" : " done") }, "할 일 " + (open || tk.length)) : null));
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
    var h = W.h, $ = W.$, ev = evsOn(sel), tk = W.sortBy(tasksOn(sel), function (t) { return (t.done ? "1" : "0") + t.id; });
    $("#p-day-title").textContent = W.nice(sel) + (sel === W.today() ? " · 오늘" : "");
    var items = ev.map(function (e) {
      return h("li", null, h("span", { class: "pill info" }, e.time || "종일"),
        h("span", { class: "main" }, h("b", null, e.title),
          e.repeat ? h("div", { class: "sub" }, "↻ " + W.REP[e.repeat] + (e.until ? " ~" + W.nice(e.until) : "")) : null),
        W.delBtn(function () { W.del("events", e.id); if (e.repeat) W.toast("반복 일정 전체를 지웠습니다"); }));
    }).concat(tk.map(function (t) {
      return h("li", null, h("input", { type: "checkbox", checked: t.done ? true : null, "aria-label": "완료", onchange: function (e) { W.upd("tasks", t.id, { done: e.target.checked }); } }),
        h("span", { class: "main" + (t.done ? " done" : "") }, t.text || t.title, h("div", { class: "sub" }, "할 일")),
        W.delBtn(function () { W.del("tasks", t.id); }));
    }));
    W.fill($("#p-day-list"), items, "이 날 일정과 할 일이 없습니다. 위에서 바로 적으세요.");
  }

  function render() {
    if (!window.WB) return;
    if (!ready) setup();
    if (!W.$("#v-plan").classList.contains("on")) return;
    var sig = month + "|" + sel + "|" + JSON.stringify(S().events || []) + JSON.stringify((S().tasks || []).map(function (t) { return [t.id, t.due, t.done, t.text]; })) + W.today();
    if (sig !== lastSig && !busy) { lastSig = sig; paintCal(); }
    dayList();
  }
  (window.WBViews = window.WBViews || []).push(render);
})();
