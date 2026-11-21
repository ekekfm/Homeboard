/* 일정 알림 창: 업무 보드를 열었을 때(그리고 열어 둔 동안 30초마다) 알림 시각이 된 일정을 창으로 보여준다.
   - 알림이 걸린 일정이 없거나 모두 확인했으면 창을 띄우지 않는다.
   - 확인한 알림은 S.config.remDone 에 남겨 다른 기기와 동기화한다.
   - 서버 푸시가 아니므로 앱이 닫혀 있으면 알림이 오지 않는다(정확한 시각 도착을 보장하지 않음). */
(function () {
  "use strict";
  var W, ready = false, shownSig = "", hiddenSig = "";
  var BASE_HOUR = 9; // 시간이 없는 일정의 알림 기준 시각

  function S() { return W.state(); }
  function ymdOf(d) { return d.getFullYear() + "-" + W.pad(d.getMonth() + 1) + "-" + W.pad(d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function at(date, time) {
    var p = date.split("-"), t = (time || "").split(":");
    var hh = time ? +t[0] : BASE_HOUR, mm = time ? +t[1] || 0 : 0;
    return new Date(+p[0], +p[1] - 1, +p[2], hh, mm, 0, 0);
  }
  function labelOf(m) { var L = window.WBRemindLabel || {}; return L[String(m)] || ""; }

  /* 지금 띄워야 할 알림 목록 */
  function due(now) {
    now = now || new Date();
    var done = (S().config && S().config.remDone) || {}, out = [];
    var start = addDays(now, -1);
    (S().events || []).forEach(function (e) {
      if (e.remind == null || e.remind === "" || !e.title) return;
      var m = +e.remind; if (isNaN(m) || m < 0) return;
      for (var i = 0; i <= 2; i++) {
        var d = ymdOf(addDays(start, i));
        if (!W.occurs(e, d)) continue;
        var key = e.id + "@" + d;
        if (done[key]) continue;
        var base = at(d, e.allDay ? "" : e.time), fire = base.getTime() - m * 60000;
        var expire = (e.time && !e.allDay) ? base.getTime() + 60 * 60000 : at(d, "23:59").getTime() + 59999;
        if (now.getTime() >= fire && now.getTime() < expire) out.push({ key: key, e: e, date: d, base: base });
      }
    });
    out.sort(function (a, b) { return a.base - b.base; });
    return out;
  }

  function whenText(x, now) {
    var diff = Math.round((x.base.getTime() - now.getTime()) / 60000), t = x.e.allDay || !x.e.time ? "하루 종일" : x.e.time;
    var day = x.date === W.today() ? "오늘" : x.date === ymdOf(addDays(now, 1)) ? "내일" : W.nice(x.date);
    var rel = "";
    if (x.e.time && !x.e.allDay) rel = diff > 0 ? (diff >= 60 ? Math.floor(diff / 60) + "시간 " + (diff % 60 ? diff % 60 + "분 " : "") : diff + "분 ") + "후" : diff === 0 ? "지금" : "시작함";
    return day + " " + t + (rel ? " · " + rel : "");
  }

  function dismiss(list) {
    var old = (S().config && S().config.remDone) || {}, keep = {}, cut = ymdOf(addDays(new Date(), -3));
    Object.keys(old).forEach(function (k) { var d = k.split("@")[1] || ""; if (d >= cut) keep[k] = old[k]; });
    list.forEach(function (x) { keep[x.key] = 1; });
    S().config.remDone = keep;
    W.save();
  }

  function sysNotify(list) {
    if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
    var seen; try { seen = JSON.parse(localStorage.getItem("homeboard-remind-notified") || "{}"); } catch (e) { seen = {}; }
    var fresh = list.filter(function (x) { return !seen[x.key]; });
    if (!fresh.length) return;
    fresh.forEach(function (x) { seen[x.key] = x.date; });
    try { localStorage.setItem("homeboard-remind-notified", JSON.stringify(seen)); } catch (e) {}
    var title = "업무 보드 · 일정 알림", body = fresh.map(function (x) { return x.e.title + " (" + whenText(x, new Date()) + ")"; }).join("\n");
    if (navigator.serviceWorker && navigator.serviceWorker.controller)
      navigator.serviceWorker.ready.then(function (r) { return r.showNotification(title, { body: body, icon: "icons/icon-192.png", tag: "homeboard-remind", data: { url: "./#plan" } }); }).catch(function () {});
    else try { new Notification(title, { body: body, icon: "icons/icon-192.png", tag: "homeboard-remind" }); } catch (e) {}
  }

  function paint() {
    var el = W.$("#remind"); if (!el) return;
    var now = new Date(), list = due(now), sig = list.map(function (x) { return x.key; }).join(",");
    if (!list.length) { el.hidden = true; shownSig = ""; return; }
    sysNotify(list);
    if (sig === hiddenSig) { el.hidden = true; return; }
    if (sig === shownSig && !el.hidden) { // 남은 시간 글자만 새로 고침
      el.querySelectorAll("[data-k]").forEach(function (s) { var x = list.filter(function (y) { return y.key === s.dataset.k; })[0]; if (x) s.textContent = whenText(x, now); });
      return;
    }
    shownSig = sig;
    var h = W.h;
    el.textContent = "";
    el.appendChild(h("div", { class: "nh" }, h("b", { id: "rm-title", text: "🔔 일정 알림 " + list.length + "건" }), h("small", { text: "확인하면 다시 뜨지 않습니다" })));
    list.forEach(function (x) {
      el.appendChild(h("div", { class: "nr" },
        h("span", { class: "lb", text: labelOf(x.e.remind) || "알림" }),
        h("span", { class: "rt" }, h("b", { text: x.e.title }), h("span", { class: "muted", "data-k": x.key, text: whenText(x, now) }))));
    });
    el.appendChild(h("div", { class: "acts" },
      h("button", { class: "btn ghost sm", type: "button", text: "나중에", title: "이번에만 닫고, 다음에 열면 다시 보여줍니다", onclick: function () { hiddenSig = sig; el.hidden = true; } }),
      h("button", { class: "btn ghost sm", type: "button", text: "일정 보기", onclick: function () { dismiss(list); el.hidden = true; location.hash = "plan"; } }),
      h("button", { class: "btn sm", type: "button", text: "확인", onclick: function () { dismiss(list); el.hidden = true; W.toast("알림을 확인했습니다"); } })));
    el.hidden = false;
  }

  function render() {
    if (!window.WB) return;
    if (!ready) {
      W = window.WB; ready = true;
      setInterval(paint, 30000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) paint(); });
    }
    paint();
  }
  window.WBRemind = { due: function (now) { return W ? due(now) : []; } };
  (window.WBViews = window.WBViews || []).push(render);
})();
