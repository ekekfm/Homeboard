/* 업무 화면: 업무 목록(상태·다음 행동·체크리스트·선행 업무·메모), 주간 작업 시간 */
(function () {
  "use strict";
  var STATUS = ["예정", "진행 중", "완료", "보류"];
  var STATUS_CLASS = { "예정": "plain", "진행 중": "info", "완료": "good", "보류": "warn" };
  /* 주간 시간 계획(분). 합계 20시간 = 분야별 15시간 + 유동 5시간 */
  var AREAS = [["카토리지", 240], ["경영·재무", 180], ["신규 사업·개발", 120], ["점검·정리", 180], ["변동 대응", 180], ["유동", 300]];
  var CAT_AREA = { "카토리지 사업": "카토리지", "경영·재무": "경영·재무", "신규 사업·브랜드": "신규 사업·개발", "투자·부동산": "유동", "콘텐츠·학습": "유동" };

  /* 작업 지시서의 기존 업무 29개(상태 그대로, 완료일 등 모르는 값은 비워 둠) */
  var SEED = [
    ["카토리지 사업", "완료", "사업자 및 사업 운영 기본 설정"], ["카토리지 사업", "완료", "홈페이지 구축 및 정상 운영"],
    ["카토리지 사업", "완료", "고객 상담·문의 접수 시스템"], ["카토리지 사업", "완료", "관리자 페이지 및 고객 관리"],
    ["카토리지 사업", "완료", "장기렌트·리스 제휴사 확보"], ["카토리지 사업", "완료", "영업사원·프리랜서 수수료 체계"],
    ["카토리지 사업", "진행 중", "광고·마케팅 및 고객 유입"], ["카토리지 사업", "진행 중", "차량 정보 콘텐츠 및 데이터베이스"],
    ["카토리지 사업", "예정", "사무실 입주 검토"],
    ["경영·재무", "진행 중", "개인·사업 자금 분리"], ["경영·재무", "진행 중", "매출·비용·순이익 관리"],
    ["경영·재무", "진행 중", "영업 수수료 및 급여 계산 시스템"], ["경영·재무", "진행 중", "세금·회계·증빙 관리"],
    ["경영·재무", "진행 중", "사업 운영 예산 및 현금흐름 관리"], ["경영·재무", "진행 중", "법인 설립 계획"],
    ["신규 사업·브랜드", "보류", "Trustory 교육·컨설팅 사업"], ["신규 사업·브랜드", "진행 중", "GreenRest 기부·스마트팜 사업"],
    ["신규 사업·브랜드", "진행 중", "AI 활용 신규 수익사업 탐색"], ["신규 사업·브랜드", "진행 중", "커플 캘린더 서비스 개발"],
    ["신규 사업·브랜드", "진행 중", "기타 신규 사업 아이디어 검토"],
    ["투자·부동산", "완료", "국내외 주식 투자 및 포트폴리오 관리"], ["투자·부동산", "완료", "개인 자산관리 가계부"],
    ["투자·부동산", "완료", "밀양 토지 매입 및 활용 검토"], ["투자·부동산", "진행 중", "장기 자산 형성 계획"],
    ["콘텐츠·학습", "예정", "루려하다 유튜브 채널"], ["콘텐츠·학습", "예정", "글쓰기·브런치 작가 활동"],
    ["콘텐츠·학습", "진행 중", "스마트팜 관련 학업·연구"], ["콘텐츠·학습", "진행 중", "AWS·AI·개발 역량 학습"],
    ["콘텐츠·학습", "완료", "영어·일본어 학습"]
  ];

  var W, ready = false, catF = "", statF = "", weekOff = 0, open = {}, pendingDraw = false, force = false, focusKey = null;

  function S() { return W.state(); }
  function works() { return S().work || (S().work = []); }
  function logs() { return S().timelog || (S().timelog = []); }
  function byId(id) { return works().filter(function (w) { return w.id === id; })[0]; }
  function hm(min) { min = Math.round(min || 0); var h = Math.floor(min / 60), m = min % 60; return h ? h + "시간" + (m ? " " + m + "분" : "") : m + "분"; }
  function blockers(w) { return (w.deps || []).map(byId).filter(function (d) { return d && d.status !== "완료"; }); }
  /* 업무에 연결된 가계부 지출(일회성·반복) */
  function spending(w) {
    var list = [], m = S().money || {};
    Object.keys(m).forEach(function (k) { Object.keys(m[k] || {}).forEach(function (id) { var e = m[k][id]; if (e.work === w.id && e.type === "out") list.push(Object.assign({ id: id, key: k }, e)); }); });
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { list: list, total: list.reduce(function (a, e) { return a + (+e.amt || 0); }, 0) };
  }
  function progress(w) { var c = w.checklist || []; if (!c.length) return null; var d = c.filter(function (x) { return x.done; }).length; return { done: d, total: c.length, pct: Math.round(d / c.length * 100) }; }
  function weekRange(off) {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var mon = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86400000 + off * 7 * 86400000);
    var sun = new Date(mon.getTime() + 6 * 86400000);
    return { from: W.ymd(mon), to: W.ymd(sun) };
  }
  function inWeek(r, x) { return x.date >= r.from && x.date <= r.to; }
  function save() { W.save(); W.draw(); }
  /* 내가 고친 것은 바로 다시 그리고, 입력하던 칸에 커서를 돌려놓는다 */
  function patch(id, p) {
    var w = byId(id); if (!w) return;
    var a = document.activeElement; focusKey = a && a.getAttribute && a.getAttribute("data-focus");
    force = true; Object.assign(w, p); save();
  }

  function setup() {
    W = window.WB; ready = true;
    var $ = W.$;
    /* 분류·분야 선택지 */
    $("#w-cated").appendChild(W.catEditor("work", "업무 분류"));
    AREAS.forEach(function (a) { $("#wt-area").appendChild(W.h("option", { value: a[0] }, a[0])); });
    $("#wt-date").value = W.today();
    W.on("#w-form", function (f) {
      W.add("work", { title: W.val("#w-title"), cat: $("#w-cat").value, status: $("#w-status").value, next: "", checklist: [], deps: [], memo: "", created: W.today() });
      f.reset(); W.toast("업무를 추가했습니다");
    });
    W.on("#w-time-form", function (f) {
      var min = Math.round(+$("#wt-min").value || 0);
      if (min < 1) { W.toast("작업 시간을 분으로 적어 주세요"); return; }
      var o = { area: $("#wt-area").value, date: W.val("#wt-date") || W.today(), min: min, memo: W.val("#wt-memo") };
      if ($("#wt-work").value) o.workId = $("#wt-work").value;
      W.add("timelog", o);
      $("#wt-min").value = ""; $("#wt-memo").value = ""; W.toast(hm(min) + " 기록했습니다");
    });
    $("#w-time-form").addEventListener("click", function (e) { var m = e.target.getAttribute && e.target.getAttribute("data-min"); if (m) $("#wt-min").value = m; });
    $("#wt-work").addEventListener("change", function (e) { var w = byId(e.target.value); if (w && CAT_AREA[w.cat]) $("#wt-area").value = CAT_AREA[w.cat]; });
    $("#w-q").addEventListener("input", W.draw);
    $("#w-prev").addEventListener("click", function () { weekOff--; W.draw(); });
    $("#w-next").addEventListener("click", function () { if (weekOff < 0) { weekOff++; W.draw(); } });
    /* 입력 중에는 목록을 다시 그리지 않고, 입력을 마치면 그린다 */
    $("#w-list").addEventListener("focusout", function () { if (pendingDraw) { pendingDraw = false; setTimeout(W.draw, 0); } });
  }

  function importSeed() {
    var have = {}; works().forEach(function (w) { have[w.title] = 1; });
    var add = SEED.filter(function (x) { return !have[x[2]]; });
    if (!add.length) { W.toast("이미 모두 들어 있습니다"); return; }
    var td = W.today();
    add.forEach(function (x) { works().push({ id: W.newId(), title: x[2], cat: x[0], status: x[1], next: "", checklist: [], deps: [], memo: "", created: td }); });
    S().config.workImported = td;
    save(); W.toast("기존 업무 " + add.length + "개를 가져왔습니다");
  }

  /* ---------- 이번 주 시간 ---------- */
  function renderWeek() {
    var h = W.h, $ = W.$, r = weekRange(weekOff), cfg = S().config || {};
    var target = +cfg.weeklyTargetMin || 1200;
    var list = logs().filter(function (x) { return inWeek(r, x); });
    var used = {}, total = 0;
    list.forEach(function (x) { used[x.area] = (used[x.area] || 0) + (+x.min || 0); total += +x.min || 0; });
    $("#w-week-label").textContent = weekOff === 0 ? "이번 주" : W.nice(r.from) + " 주";
    $("#w-next").disabled = weekOff >= 0;
    var box = $("#w-week"); box.textContent = "";
    var pct = Math.min(100, Math.round(total / target * 100)), over = total > target;
    box.appendChild(h("div", { class: "wsum" },
      h("div", null, h("span", { class: "k" }, "실제 작업"), h("b", { class: "amt" }, hm(total))),
      h("div", null, h("span", { class: "k" }, "계획"), h("b", { class: "amt" }, hm(target))),
      h("div", null, h("span", { class: "k" }, over ? "초과" : "남은 시간"), h("b", { class: "amt" + (over ? " over" : "") }, hm(Math.abs(target - total)))),
      h("div", null, h("span", { class: "k" }, "달성률"), h("b", { class: "amt" }, Math.round(total / target * 100) + "%"))));
    box.appendChild(h("div", { class: "meter" + (over ? " over" : ""), role: "img", "aria-label": "주간 달성률 " + pct + "%" }, h("i", { style: "width:" + pct + "%" })));
    if (over) box.appendChild(h("p", { class: "warnline" }, h("span", { class: "pill crit" }, "시간 초과"), " 이번 주 계획 시간(" + hm(target) + ")을 " + hm(total - target) + " 넘었습니다."));
    var grid = h("div", { class: "wareas" });
    AREAS.forEach(function (a) {
      var u = used[a[0]] || 0, p = Math.min(100, Math.round(u / a[1] * 100));
      grid.appendChild(h("div", { class: "warea" + (u > a[1] ? " over" : "") },
        h("div", { class: "top" }, h("span", null, a[0]), h("span", { class: "amt" }, hm(u) + " / " + hm(a[1]))),
        h("div", { class: "meter" + (u > a[1] ? " over" : "") }, h("i", { style: "width:" + p + "%" }))));
    });
    box.appendChild(grid);
    /* 이번 주 기록 목록 */
    var names = {}; works().forEach(function (w) { names[w.id] = w.title; });
    W.fill($("#w-time-list"), W.sortBy(list, function (x) { return x.date + x.id; }).reverse().map(function (x) {
      return h("li", null, h("span", { class: "main" }, h("b", null, hm(x.min)), " ", x.area,
        h("div", { class: "sub", text: [W.nice(x.date), names[x.workId], x.memo].filter(Boolean).join(" · ") })),
        W.delBtn(function () { W.del("timelog", x.id); }));
    }), (weekOff === 0 ? "이번 주" : "이 주") + " 기록이 없습니다.");
    /* 업무 선택지 */
    var sel = $("#wt-work");
    if (document.activeElement !== sel) {
      var keep = sel.value; sel.textContent = "";
      sel.appendChild(h("option", { value: "" }, "업무 선택 안 함"));
      W.sortBy(works().filter(function (w) { return w.status !== "완료"; }), function (w) { return w.cat + w.title; })
        .forEach(function (w) { sel.appendChild(h("option", { value: w.id }, w.title)); });
      sel.value = keep;
    }
  }

  /* ---------- 업무 목록 ---------- */
  function chips(el, items, cur, set) {
    el.textContent = "";
    items.forEach(function (x) {
      el.appendChild(W.h("button", { type: "button", class: cur === x[0] ? "on" : "", "aria-pressed": cur === x[0] ? "true" : "false", onclick: function () { set(x[0]); W.draw(); } }, x[1]));
    });
  }

  function renderList() {
    var h = W.h, $ = W.$, all = works();
    var counts = {}; STATUS.forEach(function (s) { counts[s] = 0; }); var blocked = 0;
    all.forEach(function (w) { counts[w.status] = (counts[w.status] || 0) + 1; if (w.status !== "완료" && blockers(w).length) blocked++; });
    $("#w-count").textContent = all.length ? "전체 " + all.length + " · 진행 중 " + counts["진행 중"] + " · 예정 " + counts["예정"] + " · 보류 " + counts["보류"] + " · 완료 " + counts["완료"] : "";
    var imp = $("#w-import"); imp.textContent = "";
    if (!S().config.workImported) imp.appendChild(h("div", { class: "importbox" },
      h("p", null, "작업 지시서의 기존 업무 29개(완료 10 · 진행 중 15 · 예정 3 · 보류 1)를 상태 그대로 가져옵니다. 완료일처럼 모르는 값은 비워 둡니다."),
      h("button", { class: "btn", type: "button", onclick: importSeed }, "기존 업무 29개 가져오기"),
      h("button", { class: "btn ghost sm", type: "button", onclick: function () { S().config.workImported = "skip"; save(); } }, "안 가져옴")));
    var CATS = W.cats("work"), extra = {};
    all.forEach(function (w) { if (w.cat && CATS.indexOf(w.cat) < 0) extra[w.cat] = 1; });
    CATS = CATS.concat(Object.keys(extra));       /* 편집에서 뺀 분류라도 그 분류의 업무가 남아 있으면 보여준다 */
    var sel = $("#w-cat");
    if (document.activeElement !== sel) { var keep = sel.value; sel.textContent = ""; W.cats("work").forEach(function (c) { sel.appendChild(h("option", { value: c }, c)); }); if (keep) sel.value = keep; }
    if (catF && CATS.indexOf(catF) < 0) catF = "";
    chips($("#w-cats"), [["", "전체"]].concat(CATS.map(function (c) { return [c, c]; })), catF, function (v) { catF = v; });
    chips($("#w-stats"), [["", "모든 상태"]].concat(STATUS.map(function (s) { return [s, s + " " + counts[s]]; })).concat([["차단됨", "차단됨 " + blocked]]), statF, function (v) { statF = v; });

    var listEl = $("#w-list");
    if (!force && listEl.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { pendingDraw = true; return; }
    force = false;
    if (window.WBOpenWork) { open[window.WBOpenWork] = true; catF = ""; statF = ""; }

    var q = ($("#w-q").value || "").trim().toLowerCase();
    var shown = all.filter(function (w) {
      if (catF && w.cat !== catF) return false;
      if (statF === "차단됨") { if (w.status === "완료" || !blockers(w).length) return false; }
      else if (statF && w.status !== statF) return false;
      return !q || (w.title + " " + (w.next || "") + " " + (w.memo || "") + " " + (w.checklist || []).map(function (c) { return c.t; }).join(" ")).toLowerCase().indexOf(q) >= 0;
    });
    listEl.textContent = "";
    if (!shown.length) { listEl.appendChild(h("p", { class: "empty", text: all.length ? "조건에 맞는 업무가 없습니다." : "아직 업무가 없습니다. 위에서 추가하거나 기존 업무를 가져오세요." })); return; }
    var weekR = weekRange(0), weekMin = {};
    logs().forEach(function (x) { if (x.workId && inWeek(weekR, x)) weekMin[x.workId] = (weekMin[x.workId] || 0) + (+x.min || 0); });
    CATS.concat(["분류 없음"]).forEach(function (cat) {
      var rows = shown.filter(function (w) { return (CATS.indexOf(w.cat) >= 0 ? w.cat : "분류 없음") === cat; });
      if (!rows.length) return;
      var order = { "진행 중": 0, "예정": 1, "보류": 2, "완료": 3 };
      rows = W.sortBy(rows, function (w) { return (order[w.status] != null ? order[w.status] : 4) + (w.title || ""); });
      listEl.appendChild(h("h3", { class: "subh" }, cat, h("small", null, rows.length + "개")));
      rows.forEach(function (w) { listEl.appendChild(item(w, weekMin[w.id] || 0)); });
    });
    window.WBOpenWork = null;
    if (focusKey) { var f = listEl.querySelector('[data-focus="' + focusKey + '"]'); focusKey = null; if (f) f.focus(); }
  }

  function item(w, weekMin) {
    var h = W.h, bl = w.status === "완료" ? [] : blockers(w), pg = progress(w);
    var d = h("details", { class: "witem", "data-id": w.id });
    if (open[w.id]) d.open = true;
    d.addEventListener("toggle", function () { if (d.open) open[w.id] = true; else delete open[w.id]; });
    var sub = [];
    if (w.next) sub.push("다음: " + w.next);
    if (pg) sub.push("체크 " + pg.done + "/" + pg.total);
    if (weekMin) sub.push("이번 주 " + hm(weekMin));
    var sp = (w.approved || w.est) ? spending(w) : null, overB = sp && w.approved && sp.total > w.approved;
    if (sp) sub.push("지출 " + W.won(sp.total) + (w.approved ? " / 승인 " + W.won(w.approved) : ""));
    d.appendChild(h("summary", null,
      h("span", { class: "pill " + (STATUS_CLASS[w.status] || "plain") }, w.status),
      h("span", { class: "main" }, h("b", { class: w.status === "완료" ? "done" : null }, w.title),
        bl.length ? h("span", { class: "pill crit", style: "margin-left:6px" }, "차단됨") : null,
        overB ? h("span", { class: "pill crit", style: "margin-left:6px" }, "예산 초과") : null,
        sub.length ? h("div", { class: "sub" }, sub.join(" · ")) : null,
        pg ? h("div", { class: "meter thin" }, h("i", { style: "width:" + pg.pct + "%" })) : null)));
    if (d.open) d.appendChild(body(w, bl));
    else d.addEventListener("toggle", function once() { if (d.open && !d.querySelector(".wbody")) d.appendChild(body(w, blockers(w))); }, { once: false });
    return d;
  }

  function body(w, bl) {
    var h = W.h, b = h("div", { class: "wbody" });
    /* 상태 */
    var seg = h("div", { class: "seg", role: "radiogroup", "aria-label": "상태" });
    STATUS.forEach(function (s) {
      seg.appendChild(h("label", null, h("input", { type: "radio", name: "ws-" + w.id, value: s, checked: w.status === s ? true : null,
        onchange: function () {
          var p = { status: s };
          if (s === "완료" && w.status !== "완료") p.doneAt = W.today();
          if (s !== "완료") p.doneAt = null;
          if (s === "완료" && blockers(w).length) W.toast("선행 업무가 아직 끝나지 않았습니다. 상태는 바꿨습니다.");
          patch(w.id, p);
        } }), h("span", null, s)));
    });
    b.appendChild(field("상태", seg));
    if (bl.length) b.appendChild(h("p", { class: "warnline" }, h("span", { class: "pill crit" }, "차단됨"), " 먼저 끝나야 하는 업무: " + bl.map(function (x) { return x.title + "(" + x.status + ")"; }).join(", ")));
    /* 다음 행동 */
    b.appendChild(field("다음 행동", h("input", { class: "field grow", value: w.next || "", placeholder: "바로 할 한 가지", onchange: function (e) { patch(w.id, { next: e.target.value.trim() }); } })));
    /* 체크리스트 */
    var cl = h("ul", { class: "list check" });
    (w.checklist || []).forEach(function (c, i) {
      cl.appendChild(h("li", null,
        h("input", { type: "checkbox", checked: c.done ? true : null, "aria-label": c.t, onchange: function (e) { var l = (w.checklist || []).slice(); l[i] = Object.assign({}, l[i], { done: e.target.checked }); patch(w.id, { checklist: l }); } }),
        h("span", { class: "main" + (c.done ? " done" : "") }, c.t),
        h("button", { class: "mini danger", type: "button", "aria-label": c.t + " 지우기", onclick: function () { var l = (w.checklist || []).slice(); l.splice(i, 1); patch(w.id, { checklist: l }); } }, "×")));
    });
    var ci = h("input", { class: "field grow", placeholder: "체크 항목 추가 후 Enter", "data-focus": "ck-" + w.id });
    ci.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); var t = ci.value.trim(); if (!t) return; patch(w.id, { checklist: (w.checklist || []).concat([{ t: t, done: false }]) }); } });
    b.appendChild(field("체크리스트", h("div", null, cl, ci)));
    /* 선행 업무 */
    var deps = h("div", { class: "chips" });
    (w.deps || []).forEach(function (id) {
      var x = byId(id); if (!x) return;
      deps.appendChild(h("button", { type: "button", title: "누르면 연결을 풉니다", onclick: function () { patch(w.id, { deps: (w.deps || []).filter(function (y) { return y !== id; }) }); } },
        x.title + " · " + x.status + " ×"));
    });
    var ds = h("select", { class: "field grow", "aria-label": "선행 업무 추가", onchange: function (e) { if (e.target.value) patch(w.id, { deps: (w.deps || []).concat([e.target.value]) }); } },
      h("option", { value: "" }, "먼저 끝나야 하는 업무 추가…"));
    W.sortBy(works().filter(function (x) { return x.id !== w.id && (w.deps || []).indexOf(x.id) < 0 && (x.deps || []).indexOf(w.id) < 0; }), function (x) { return x.cat + x.title; })
      .forEach(function (x) { ds.appendChild(h("option", { value: x.id }, x.title)); });
    b.appendChild(field("선행 업무", h("div", null, deps, ds)));
    /* 메모 */
    b.appendChild(field("메모", h("textarea", { class: "field", rows: "3", placeholder: "업무 메모", onchange: function (e) { patch(w.id, { memo: e.target.value }); } }, w.memo || "")));
    var linked = (S().notes || []).filter(function (n) { return n.workId === w.id && !n.trashed; });
    if (linked.length) b.appendChild(field("연결된 메모", h("ul", { class: "list" }, linked.map(function (n) {
      return h("li", null, h("span", { class: "main", style: "white-space:pre-wrap" }, n.text));
    }))));
    /* 시간 기록 */
    var mine = logs().filter(function (x) { return x.workId === w.id; }), tot = mine.reduce(function (a, x) { return a + (+x.min || 0); }, 0);
    b.appendChild(field("작업 시간", h("div", { class: "row" },
      h("span", null, mine.length ? "누적 " + hm(tot) + " (" + mine.length + "번)" : "기록 없음"),
      h("button", { class: "btn ghost sm", type: "button", onclick: function () {
        var $ = W.$; $("#w-time-box").open = true; $("#wt-work").value = w.id; if (CAT_AREA[w.cat]) $("#wt-area").value = CAT_AREA[w.cat];
        $("#w-time-box").scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(function () { $("#wt-min").focus(); }, 300);
      } }, "시간 기록"))));
    /* 예산 */
    b.appendChild(field("예산", budget(w)));
    /* 날짜·삭제 */
    b.appendChild(h("div", { class: "row wfoot" },
      h("span", { class: "muted" }, [w.created ? "등록 " + W.nice(w.created) : "", w.doneAt ? "완료 " + W.nice(w.doneAt) : ""].filter(Boolean).join(" · ")),
      h("select", { class: "field", "aria-label": "분류 바꾸기", onchange: function (e) { patch(w.id, { cat: e.target.value }); } },
        W.cats("work").concat(W.cats("work").indexOf(w.cat) < 0 && w.cat ? [w.cat] : []).map(function (c) { return h("option", { value: c, selected: c === w.cat ? true : null }, c); })),
      W.delBtn(function () { works().forEach(function (x) { if ((x.deps || []).indexOf(w.id) >= 0) x.deps = x.deps.filter(function (y) { return y !== w.id; }); }); W.del("work", w.id); })));
    return b;
  }
  function budget(w) {
    var h = W.h, sp = spending(w), rest = (+w.approved || 0) - sp.total;
    var num = function (key, ph) {
      return h("label", { class: "bnum" }, h("span", null, ph),
        h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", step: "10000", placeholder: "원", value: w[key] || "", "data-focus": key + "-" + w.id,
          onchange: function (e) { var p = {}; p[key] = Math.round(+e.target.value || 0); patch(w.id, p); } }));
    };
    var box = h("div", { class: "wbudget" });
    box.appendChild(h("div", { class: "row" }, num("est", "예상"), num("approved", "승인")));
    box.appendChild(h("p", { class: rest < 0 && w.approved ? "warnline" : "muted", style: "margin:4px 0;font-size:13.5px" },
      rest < 0 && w.approved ? h("span", { class: "pill crit" }, "예산 초과") : null,
      " 실제 지출 " + W.won(sp.total) + (w.approved ? (rest < 0 ? " · 승인 예산보다 " + W.won(-rest) + " 많음" : " · 남은 승인 예산 " + W.won(rest)) : " · 승인 예산을 적으면 남은 금액을 계산합니다")));
    /* 지출 추가 → 가계부에 '사업' 지출로 기록 */
    var amt = h("input", { class: "field", type: "number", inputmode: "numeric", min: "1", placeholder: "지출 금액(원)", style: "flex:1 1 130px" });
    var memo = h("input", { class: "field grow", placeholder: "내용 (선택)" });
    var date = h("input", { class: "field", type: "date", value: W.today(), style: "width:auto" });
    var kind = h("select", { class: "field", style: "width:auto", "aria-label": "일회성·반복" }, h("option", { value: "once" }, "일회성"), h("option", { value: "monthly" }, "매달 반복"));
    box.appendChild(h("div", { class: "row" }, amt, memo, date, kind, h("button", { class: "btn sm", type: "button", onclick: function () {
      var a = Math.round(+amt.value || 0), d = date.value || W.today();
      if (a <= 0) { W.toast("지출 금액을 적어 주세요"); return; }
      var title = w.title + (memo.value.trim() ? " · " + memo.value.trim() : "");
      if (kind.value === "monthly") {
        var r = { id: W.newId(), title: title, amt: a, cat: "사업", acct: "main", day: +d.slice(8, 10), active: true, work: w.id };
        (S().recurring || (S().recurring = [])).push(r);
        if (window.WBMoney) window.WBMoney.post(d.slice(0, 7), r); else W.save();
        W.toast("매달 " + (+d.slice(8, 10)) + "일 반복 지출로 등록하고 이번 달 것을 기록했습니다");
      } else {
        W.moneyAdd(d.slice(0, 7), { type: "out", amt: a, cat: "사업", memo: title, date: d, work: w.id });
        W.toast("가계부에 사업 지출로 기록했습니다");
      }
      force = true;
    } }, "지출 추가")));
    if (sp.list.length) box.appendChild(h("ul", { class: "list" }, sp.list.slice(0, 8).map(function (e) {
      return h("li", null, h("span", { class: "pill " + (e.rec ? "info" : "plain") }, e.rec ? "반복" : "일회성"),
        h("span", { class: "main" }, h("b", { class: "amt" }, W.won(e.amt)), h("div", { class: "sub" }, W.nice(e.date) + (e.memo ? " · " + e.memo : ""))),
        W.delBtn(function () { force = true; W.moneyDel(e.key, e.id); }));
    })));
    if (sp.list.length > 8) box.appendChild(h("p", { class: "muted", style: "font-size:13px" }, "외 " + (sp.list.length - 8) + "건은 가계부 달력에서 볼 수 있습니다."));
    return box;
  }
  function field(label, el) { return W.h("div", { class: "wfield" }, W.h("span", { class: "wlabel" }, label), el); }

  function render() {
    if (!window.WB) return;
    if (!ready) setup();
    renderWeek();
    renderList();
  }
  (window.WBViews = window.WBViews || []).push(render);
})();
