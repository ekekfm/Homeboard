/* 알림 센터: 기한 지난 할 일, 예산 초과, 업무 예산 초과, 주간 시간 초과, 안 적은 반복 지출을 한곳에 모은다(읽음 표시).
   폰 푸시는 쓰지 않는다. 알림은 업무 보드를 열었을 때 이 화면과 위쪽 "알림" 숫자로만 보인다. */
(function () {
  "use strict";
  var W, ready = false;
  var HOUR = 3600000, DAY = 86400000;
  function S() { return W.state(); }
  function readMap() { var c = S().config; return c.read || (c.read = {}); }
  function at(dateStr, hh, mm) { var p = dateStr.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], hh || 0, mm || 0).getTime(); }
  function when(ms) { var d = new Date(ms); return W.nice(W.ymd(d)) + " " + W.pad(d.getHours()) + ":" + W.pad(d.getMinutes()); }

  /* ---------- 알림 센터 ---------- */
  function alerts() {
    var out = [], td = W.today(), now = Date.now(), key = W.nowKey();
    (S().tasks || []).forEach(function (t) {
      if (!t.done && t.due && t.due < td) out.push({ id: "od-" + t.id, t: at(t.due, 9, 0), kind: "할 일", tone: "crit", title: "기한 지남: " + (t.text || t.title), body: W.nice(t.due) + "까지였습니다", href: "#plan" });
    });
    var m = W.monthSum(key), bud = {};
    (S().budgets || []).forEach(function (b) { bud[b.cat] = +b.amt || 0; });
    Object.keys(bud).forEach(function (c) {
      var s = m.cats[c] || 0;
      if (bud[c] && s > bud[c]) out.push({ id: "bo-" + key + "-" + c, t: now - 1, kind: "예산", tone: "crit", title: c + " 예산 초과", body: W.won(s) + " 썼습니다(예산 " + W.won(bud[c]) + ")", href: "#money" });
    });
    var spent = {}, mm = S().money || {};
    Object.keys(mm).forEach(function (k) { Object.keys(mm[k] || {}).forEach(function (id) { var e = mm[k][id]; if (e.work && e.type === "out") spent[e.work] = (spent[e.work] || 0) + (+e.amt || 0); }); });
    (S().work || []).forEach(function (w) {
      if (w.approved && spent[w.id] > w.approved) out.push({ id: "wb-" + w.id + "-" + w.approved, t: now - 2, kind: "업무 예산", tone: "crit", title: w.title + " 예산 초과", body: "지출 " + W.won(spent[w.id]) + " / 승인 " + W.won(w.approved), href: "#work" });
    });
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var mon = W.ymd(new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY)), sun = W.ymd(new Date(d.getTime() + (6 - (d.getDay() + 6) % 7) * DAY));
    var mins = (S().timelog || []).filter(function (x) { return x.date >= mon && x.date <= sun; }).reduce(function (a, x) { return a + (+x.min || 0); }, 0);
    var target = +S().config.weeklyTargetMin || 1200;
    if (mins > target) out.push({ id: "wt-" + mon, t: now - 3, kind: "작업 시간", tone: "warn", title: "이번 주 계획 시간 초과", body: Math.round(mins / 6) / 10 + "시간 / 계획 " + target / 60 + "시간", href: "#work" });
    (S().recurring || []).forEach(function (r) {
      if (r.active === false) return;
      var p = key.split("-"), last = new Date(+p[0], +p[1], 0).getDate(), dd = key + "-" + W.pad(Math.min(r.day || 1, last));
      var it = (S().money || {})[key] || {}, posted = Object.keys(it).some(function (k) { return it[k].rec === r.id; });
      if (!posted && dd <= td) out.push({ id: "rd-" + key + "-" + r.id, t: at(dd, 9, 0), kind: "반복 지출", tone: "warn", title: r.title + " 아직 안 적음", body: W.nice(dd) + " · " + W.won(r.amt), href: "#money" });
    });
    out.sort(function (a, b) { return b.t - a.t; });
    return out;
  }

  function setup() {
    W = window.WB; ready = true;
    var $ = W.$;
    $("#inbox-all").addEventListener("click", function () {
      var r = readMap(), td = W.today(); alerts().forEach(function (a) { r[a.id] = td; }); W.save(); W.draw();
    });
  }
  function render() {
    if (!window.WB) return;
    if (!ready) setup();
    var h = W.h, $ = W.$, list = alerts(), r = readMap(), unread = list.filter(function (a) { return !r[a.id]; }).length;
    /* 오래된 읽음 기록 정리 */
    var cut = W.ymd(new Date(Date.now() - 60 * DAY)), dirty = false;
    Object.keys(r).forEach(function (k) { if (r[k] < cut) { delete r[k]; dirty = true; } });
    if (dirty) setTimeout(W.save, 0);
    var bell = $("#bell");
    bell.textContent = unread ? "알림 " + unread : "알림";
    bell.classList.toggle("has", !!unread);
    bell.setAttribute("aria-label", unread ? "알림 " + unread + "개 안 읽음" : "알림 센터");
    if ($("#v-inbox").classList.contains("on")) {
      W.fill($("#inbox-list"), list.map(function (a) {
        var isRead = !!r[a.id];
        return h("li", { class: isRead ? "read" : "unread" },
          h("span", { class: "pill " + a.tone }, a.kind),
          h("a", { class: "main", href: a.href, onclick: function () { r[a.id] = W.today(); W.save(); } },
            h("b", null, a.title), h("div", { class: "sub" }, a.body + " · " + when(a.t))),
          isRead ? null : h("button", { class: "btn ghost sm", type: "button", onclick: function () { r[a.id] = W.today(); W.save(); W.draw(); } }, "읽음"));
      }), "알림이 없습니다.");
    }
  }
  (window.WBViews = window.WBViews || []).push(render);
})();
