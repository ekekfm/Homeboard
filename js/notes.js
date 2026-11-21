/* 메모: 왼쪽 노트북 목록(자유롭게 만들기) → 노트북 안의 목차 → 메모
   - 노트북·목차는 이름 바꾸기·지우기 가능. 지우면 그 안의 메모는 지우지 않고 '노트북 없음'으로 옮긴다.
   - 태그, 맨 위 고정, 업무 연결, 휴지통(30일)은 그대로. */
(function () {
  "use strict";
  var W, ready = false, nb = "all", sec = "", tag = "", pending = false, force = false, sideOpen = false;

  function S() { return W.state(); }
  function books() { return W.sortBy(S().notebooks || (S().notebooks = []), function (b) { return (b.ord || 0) + b.name; }); }
  function book(id) { return (S().notebooks || []).filter(function (b) { return b.id === id; })[0]; }
  function live() { return (S().notes || []).filter(function (n) { return !n.trashed; }); }
  function inView(n) {
    if (nb === "all") return true;
    if (nb === "pinned") return !!n.pinned;
    if (nb === "none") return !n.nb || !book(n.nb);
    if (n.nb !== nb) return false;
    return !sec || n.sec === sec;
  }
  function where(n) {
    var b = book(n.nb); if (!b) return "노트북 없음";
    var s = (b.sections || []).filter(function (x) { return x.id === n.sec; })[0];
    return b.name + (s ? " › " + s.name : "");
  }
  function tagList(v) {
    var seen = {};
    return String(v || "").split(/[,#]/).map(function (x) { return x.trim(); }).filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }).slice(0, 10);
  }
  function redraw() { force = true; W.save(); W.draw(); }
  function ask(msg, cur) { var v = prompt(msg, cur || ""); return v == null ? null : v.trim().slice(0, 30); }

  function setup() {
    W = window.WB; ready = true;
    var $ = W.$;
    W.on("#note-form", function () {
      var o = { text: W.val("#note-text"), tag: "메모", at: new Date().toISOString() }, tg = tagList(W.val("#note-tags")), wk = $("#note-work").value;
      if (tg.length) o.tags = tg;
      if (wk) o.workId = wk;
      if (book(nb)) { o.nb = nb; if (sec) o.sec = sec; }
      W.add("notes", o);
      $("#note-text").value = ""; $("#note-tags").value = ""; $("#note-work").value = "";
    });
    $("#note-q").addEventListener("input", W.draw);
    $("#nb-side").addEventListener("focusout", function () { if (pending) { pending = false; setTimeout(W.draw, 0); } });
  }

  function order() { var b = book(nb); return b ? [""].concat((b.sections || []).map(function (x) { return x.id; })) : []; }
  /* 목차 탭: 가로로 스크롤되는 띠. 고른 목차가 보이도록 옮긴다 */
  function tabs() {
    var h = W.h, el = W.$("#nb-tabs"), b = book(nb);
    el.hidden = !b || !(b.sections || []).length;
    if (el.hidden) { el.textContent = ""; return; }
    var cnt = function (id) { return live().filter(function (n) { return n.nb === b.id && (!id || n.sec === id); }).length; };
    el.textContent = "";
    [["", "전체"]].concat((b.sections || []).map(function (x) { return [x.id, x.name]; })).forEach(function (x) {
      el.appendChild(h("button", { type: "button", role: "tab", class: "nb-tab" + (sec === x[0] ? " on" : ""), "aria-selected": sec === x[0] ? "true" : "false",
        onclick: function () { sec = x[0]; force = true; W.draw(); } }, x[1], h("span", { class: "ct" }, cnt(x[0]))));
    });
    var on = el.querySelector(".on");
    if (on) requestAnimationFrame(function () { var l = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2; el.scrollTo({ left: Math.max(0, l), behavior: "smooth" }); });
  }

  /* ---------- 왼쪽: 노트북과 목차 ---------- */
  function side() {
    var h = W.h, box = W.$("#nb-side"), all = live();
    if (!force && box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") { pending = true; return; }
    force = false;
    var cnt = function (f) { return all.filter(f).length; };
    box.textContent = "";
    var cur = nb === "all" ? "전체 메모" : nb === "pinned" ? "고정 메모" : nb === "none" ? "노트북 없음" : (book(nb) || {}).name || "전체 메모";
    var curSec = book(nb) && sec ? ((book(nb).sections || []).filter(function (x) { return x.id === sec; })[0] || {}).name : "";
    /* 폰에서는 접어 둘 수 있게 */
    box.appendChild(h("button", { type: "button", class: "nb-toggle", "aria-expanded": sideOpen ? "true" : "false", onclick: function () { sideOpen = !sideOpen; W.draw(); } },
      h("span", null, "노트북"), h("b", null, cur + (curSec ? " › " + curSec : "")), h("span", { class: "chev" }, sideOpen ? "▲" : "▼")));
    var list = h("div", { class: "nb-list" + (sideOpen ? " open" : "") });
    function item(id, label, n, cls) {
      return h("button", { type: "button", class: "nb-item " + (cls || "") + (nb === id && (!sec || cls !== "book") ? " on" : nb === id ? " on-book" : ""),
        "aria-current": nb === id ? "true" : null, onclick: function () { nb = id; sec = ""; tag = ""; sideOpen = false; force = true; W.draw(); } },
        h("span", { class: "nm" }, label), h("span", { class: "ct" }, n));
    }
    list.appendChild(item("all", "전체 메모", all.length, "sys"));
    list.appendChild(item("pinned", "고정 메모", cnt(function (n) { return n.pinned; }), "sys"));
    list.appendChild(h("div", { class: "nb-head" }, "노트북"));
    books().forEach(function (b) {
      list.appendChild(item(b.id, b.name, cnt(function (n) { return n.nb === b.id; }), "book"));
      if (nb !== b.id) return;
      /* 고른 노트북: 목차와 관리 버튼 */
      var secs = h("div", { class: "nb-secs" });
      (b.sections || []).forEach(function (s) {
        secs.appendChild(h("button", { type: "button", class: "nb-sec" + (sec === s.id ? " on" : ""), onclick: function () { sec = sec === s.id ? "" : s.id; sideOpen = false; force = true; W.draw(); } },
          h("span", { class: "nm" }, s.name), h("span", { class: "ct" }, cnt(function (n) { return n.nb === b.id && n.sec === s.id; }))));
      });
      var si = h("input", { class: "field", placeholder: "+ 새 목차 이름", maxlength: "30" });
      si.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" || e.isComposing) return; e.preventDefault();
        var v = si.value.trim(); if (!v) return;
        var id = W.newId(); b.sections = (b.sections || []).concat([{ id: id, name: v }]); sec = id; redraw(); W.toast("목차 '" + v + "'을(를) 만들었습니다");
      });
      secs.appendChild(si);
      secs.appendChild(h("div", { class: "nb-acts" },
        h("button", { type: "button", class: "mini", onclick: function () { var v = ask("노트북 이름", b.name); if (v) { b.name = v; redraw(); } } }, "이름 바꾸기"),
        sec ? h("button", { type: "button", class: "mini", onclick: function () {
          var s = (b.sections || []).filter(function (x) { return x.id === sec; })[0]; var v = s && ask("목차 이름", s.name); if (v) { s.name = v; b.sections = b.sections.slice(); redraw(); } } }, "목차 이름") : null,
        sec ? h("button", { type: "button", class: "mini danger", onclick: function () {
          if (!confirm("이 목차를 지울까요? 안의 메모는 노트북에 그대로 남습니다.")) return;
          var id = sec; (S().notes || []).forEach(function (n) { if (n.nb === b.id && n.sec === id) delete n.sec; });
          b.sections = (b.sections || []).filter(function (x) { return x.id !== id; }); sec = ""; redraw(); } }, "목차 지우기") : null,
        h("button", { type: "button", class: "mini danger", onclick: function () {
          var n = cnt(function (x) { return x.nb === b.id; });
          if (!confirm("'" + b.name + "' 노트북을 지울까요?" + (n ? " 안의 메모 " + n + "개는 '노트북 없음'으로 옮겨집니다." : ""))) return;
          (S().notes || []).forEach(function (x) { if (x.nb === b.id) { delete x.nb; delete x.sec; } });
          nb = "all"; sec = ""; W.del("notebooks", b.id); force = true; } }, "노트북 지우기")));
      list.appendChild(secs);
    });
    var bi = h("input", { class: "field", placeholder: "+ 새 노트북 이름", maxlength: "30" });
    bi.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing) return; e.preventDefault();
      var v = bi.value.trim(); if (!v) return;
      var id = W.newId(); (S().notebooks || (S().notebooks = [])).push({ id: id, name: v, ord: Date.now(), sections: [] });
      nb = id; sec = ""; redraw(); W.toast("노트북 '" + v + "'을(를) 만들었습니다. 목차도 만들 수 있습니다");
    });
    list.appendChild(bi);
    var none = cnt(function (n) { return !n.nb || !book(n.nb); });
    if (none) list.appendChild(item("none", "노트북 없음", none, "sys"));
    box.appendChild(list);
  }

  /* ---------- 오른쪽: 메모 ---------- */
  function main() {
    var h = W.h, $ = W.$, q = ($("#note-q").value || "").trim().toLowerCase(), all = live(), dead = (S().notes || []).filter(function (n) { return n.trashed; });
    if (nb !== "all" && nb !== "pinned" && nb !== "none" && !book(nb)) { nb = "all"; sec = ""; }
    var b = book(nb), s = b && sec ? (b.sections || []).filter(function (x) { return x.id === sec; })[0] : null;
    $("#nb-title").textContent = b ? b.name + (s ? " › " + s.name : "") : nb === "pinned" ? "고정 메모" : nb === "none" ? "노트북 없음" : "전체 메모";
    $("#note-where").textContent = b ? "저장하면 '" + b.name + (s ? " › " + s.name : "") + "'에 들어갑니다." : "왼쪽에서 노트북을 고르면 그 안에 저장됩니다. 지금은 '노트북 없음'에 저장됩니다.";
    var mine = all.filter(inView), tags = {};
    mine.forEach(function (n) { (n.tags || []).forEach(function (t) { tags[t] = 1; }); });
    if (tag && !tags[tag]) tag = "";
    var tc = $("#note-tagchips"); tc.textContent = "";
    if (Object.keys(tags).length) [["", "모든 태그"]].concat(Object.keys(tags).sort().map(function (t) { return [t, "#" + t]; })).forEach(function (x) {
      tc.appendChild(h("button", { type: "button", class: tag === x[0] ? "on" : "", "aria-pressed": tag === x[0] ? "true" : "false", onclick: function () { tag = x[0]; W.draw(); } }, x[1]));
    });
    var nw = $("#note-work");
    if (document.activeElement !== nw) {
      var keep = nw.value; nw.textContent = ""; nw.appendChild(h("option", { value: "" }, "업무 연결 없음"));
      W.sortBy((S().work || []).filter(function (w) { return w.status !== "완료"; }), function (w) { return w.title; }).forEach(function (w) { nw.appendChild(h("option", { value: w.id }, w.title)); });
      nw.value = keep;
    }
    var wname = {}; (S().work || []).forEach(function (w) { wname[w.id] = w.title; });
    var moveOpts = [["", "노트북 없음"]];
    books().forEach(function (bk) { moveOpts.push([bk.id + "|", bk.name]); (bk.sections || []).forEach(function (x) { moveOpts.push([bk.id + "|" + x.id, bk.name + " › " + x.name]); }); });
    var shown = (q ? all : mine).filter(function (n) {
      if (tag && (n.tags || []).indexOf(tag) < 0) return false;
      return !q || ((n.text || "") + " " + (n.tags || []).join(" ") + " " + (wname[n.workId] || "") + " " + where(n)).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, c) { return (c.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.id < c.id ? 1 : -1); });
    W.fill($("#notes"), shown.map(function (n) {
      var cur = (n.nb && book(n.nb) ? n.nb : "") + (n.nb && book(n.nb) ? "|" + (n.sec || "") : "");
      return h("li", { class: n.pinned ? "pinned" : null },
        h("span", { class: "main" }, h("div", { style: "white-space:pre-wrap", text: n.text }),
          h("div", { class: "sub" }, (n.at && !isNaN(new Date(n.at)) ? W.nice(W.ymd(new Date(n.at))) : ""),
            (nb === "all" || nb === "pinned" || q) ? h("span", { class: "tag", style: "color:var(--muted)" }, where(n)) : null,
            (n.tags || []).map(function (t) { return h("span", { class: "tag", text: "#" + t }); }),
            n.workId && wname[n.workId] ? h("a", { class: "tag work", href: "#work", onclick: function () { window.WBOpenWork = n.workId; } }, "업무: " + wname[n.workId]) : null)),
        h("select", { class: "mini movesel", "aria-label": "다른 노트북으로 옮기기", title: "옮기기", onchange: function (e) {
          var v = e.target.value.split("|"); if (v[0]) { n.nb = v[0]; if (v[1]) n.sec = v[1]; else delete n.sec; } else { delete n.nb; delete n.sec; }
          redraw(); W.toast("'" + where(n) + "'(으)로 옮겼습니다"); } },
          moveOpts.map(function (o) { return h("option", { value: o[0], selected: o[0] === cur || (!cur && !o[0]) ? true : null }, o[1]); })),
        h("button", { class: "btn ghost sm", type: "button", "aria-pressed": n.pinned ? "true" : "false", onclick: function () { W.upd("notes", n.id, { pinned: !n.pinned }); } }, n.pinned ? "고정됨" : "고정"),
        h("button", { class: "btn ghost sm danger", type: "button", onclick: function () { W.upd("notes", n.id, { trashed: new Date().toISOString(), pinned: false }); W.toast("휴지통으로 옮겼습니다"); } }, "지우기"));
    }), q ? "검색 결과가 없습니다." : tag ? "이 태그의 메모가 없습니다." : "이곳에 메모가 없습니다. 위에서 적어 보세요.");
    $("#note-trash").hidden = !dead.length;
    $("#note-trash-n").textContent = dead.length ? dead.length + "개" : "";
    W.fill($("#notes-trash"), dead.sort(function (a, c) { return a.trashed < c.trashed ? 1 : -1; }).map(function (n) {
      return h("li", null, h("span", { class: "main" }, h("div", { class: "done", style: "white-space:pre-wrap", text: n.text }), h("div", { class: "sub", text: "지운 날 " + W.nice(String(n.trashed).slice(0, 10)) })),
        h("button", { class: "btn ghost sm", type: "button", onclick: function () { delete n.trashed; W.save(); W.draw(); W.toast("되돌렸습니다"); } }, "되돌리기"),
        W.delBtn(function () { W.del("notes", n.id); }));
    }), "휴지통이 비었습니다.");
  }

  function render() {
    if (!window.WB) return;
    if (!ready) setup();
    if (!W.$("#v-notes").classList.contains("on")) return;
    side();
    main();
    tabs();
  }
  (window.WBViews = window.WBViews || []).push(render);
})();
