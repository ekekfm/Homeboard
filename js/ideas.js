/* 신규 사업 아이디어: 문제 → 고객 → 수익모델 가설 → 검증 실험 → 비용·결과 → 계속·수정·중단 */
(function () {
  "use strict";
  var DEC = { "": ["미정", "plain"], "계속": ["계속", "good"], "수정": ["수정", "warn"], "중단": ["중단", "crit"] };
  var FIELDS = [["problem", "해결하려는 문제"], ["customer", "대상 고객"], ["model", "수익모델 가설"], ["experiment", "검증 실험"], ["result", "실제 결과"]];
  var W, ready = false, open = {}, pending = false, force = false;
  function S() { return W.state(); }
  function list() { return S().ideas || (S().ideas = []); }
  function patch(id, p) { var x = list().filter(function (i) { return i.id === id; })[0]; if (!x) return; Object.assign(x, p); force = true; W.save(); W.draw(); }
  function setup() {
    W = window.WB; ready = true;
    W.on("#idea-form", function (f) { var id = W.newId(); list().push({ id: id, title: W.val("#idea-title"), decision: "", created: W.today() }); open[id] = true; f.reset(); W.save(); W.draw(); });
    W.$("#idea-list").addEventListener("focusout", function () { if (pending) { pending = false; setTimeout(W.draw, 0); } });
  }
  function render() {
    if (!window.WB) return;
    if (!ready) setup();
    var h = W.h, box = W.$("#idea-list"), all = list();
    var c = { "계속": 0, "수정": 0, "중단": 0 }; all.forEach(function (i) { if (c[i.decision] != null) c[i.decision]++; });
    W.$("#idea-count").textContent = all.length ? all.length + "개 · 계속 " + c["계속"] + " · 수정 " + c["수정"] + " · 중단 " + c["중단"] : "";
    if (!force && box.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { pending = true; return; }
    force = false;
    box.textContent = "";
    if (!all.length) { box.appendChild(h("p", { class: "empty" }, "아이디어를 적고, 검증 실험 결과에 따라 계속·수정·중단을 정하세요.")); return; }
    W.sortBy(all, function (i) { return (i.decision === "중단" ? "1" : "0") + (i.created || "") + i.id; }).reverse().forEach(function (i) {
      var d = h("details", { class: "witem" }); if (open[i.id]) d.open = true;
      d.addEventListener("toggle", function () { if (d.open) open[i.id] = true; else delete open[i.id]; });
      var dc = DEC[i.decision || ""] || DEC[""];
      var filled = FIELDS.filter(function (f) { return i[f[0]]; }).length;
      d.appendChild(h("summary", null, h("span", { class: "pill " + dc[1] }, dc[0]),
        h("span", { class: "main" }, h("b", null, i.title),
          h("div", { class: "sub" }, ["적은 항목 " + filled + "/" + FIELDS.length, i.estCost ? "예상 비용 " + W.won(i.estCost) : "", i.created ? "등록 " + W.nice(i.created) : ""].filter(Boolean).join(" · ")))));
      var b = h("div", { class: "wbody" });
      FIELDS.forEach(function (f) {
        b.appendChild(h("div", { class: "wfield" }, h("span", { class: "wlabel" }, f[1]),
          h("textarea", { class: "field", rows: "2", onchange: function (e) { var p = {}; p[f[0]] = e.target.value.trim(); patch(i.id, p); } }, i[f[0]] || "")));
        if (f[0] === "experiment") b.appendChild(h("div", { class: "wfield" }, h("span", { class: "wlabel" }, "예상 비용"),
          h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", placeholder: "원", value: i.estCost || "", onchange: function (e) { patch(i.id, { estCost: Math.round(+e.target.value || 0) }); } })));
      });
      var seg = h("div", { class: "seg", role: "radiogroup", "aria-label": "결정" });
      ["", "계속", "수정", "중단"].forEach(function (v) {
        seg.appendChild(h("label", null, h("input", { type: "radio", name: "idd-" + i.id, checked: (i.decision || "") === v ? true : null, onchange: function () { patch(i.id, { decision: v }); } }), h("span", null, DEC[v][0])));
      });
      b.appendChild(h("div", { class: "wfield" }, h("span", { class: "wlabel" }, "결정"), seg));
      b.appendChild(h("div", { class: "row wfoot" }, h("span", { class: "muted" }, "제목 바꾸기:"),
        h("input", { class: "field grow", value: i.title, onchange: function (e) { if (e.target.value.trim()) patch(i.id, { title: e.target.value.trim() }); } }),
        W.delBtn(function () { W.del("ideas", i.id); })));
      d.appendChild(b);
      box.appendChild(d);
    });
  }
  (window.WBViews = window.WBViews || []).push(render);
})();
