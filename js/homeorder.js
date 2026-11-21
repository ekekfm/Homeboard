/* 홈 화면 순서 바꾸기: "⇅ 홈 순서"를 누르면 홈 칸들이 이름표로 접히고,
   ⠿ 손잡이를 끌거나 ▲▼ 를 눌러 순서를 바꾼다. 숨길 칸은 "숨기기"로 감출 수 있다.
   순서와 숨김은 S.config.homeOrder / S.config.homeHide 에 저장되어 다른 기기와 동기화된다. */
(function () {
  "use strict";
  var W, ready = false, editing = false, drag = null, DEFAULT = [], NOHIDE = { settings: 1 };

  function view() { return document.getElementById("v-home"); }
  function blocks() { return Array.prototype.slice.call(view().querySelectorAll(":scope > .hblk")); }
  function cfg() { return W.state().config || (W.state().config = {}); }
  function wanted() {
    var have = blocks().map(function (b) { return b.dataset.blk; });
    var order = (cfg().homeOrder || []).filter(function (id) { return have.indexOf(id) >= 0; });
    DEFAULT.forEach(function (id, i) { if (order.indexOf(id) < 0) order.splice(Math.min(i, order.length), 0, id); });
    return order;
  }
  function apply() {
    var v = view(), cur = blocks(), want = wanted(), hide = cfg().homeHide || [];
    if (!drag && cur.map(function (b) { return b.dataset.blk; }).join() !== want.join()) {
      var byId = {}; cur.forEach(function (b) { byId[b.dataset.blk] = b; });
      var ae = document.activeElement;
      want.forEach(function (id) { v.appendChild(byId[id]); });
      if (ae && ae !== document.activeElement && ae.focus && document.contains(ae)) try { ae.focus({ preventScroll: true }); } catch (e) {}
    }
    blocks().forEach(function (b) {
      var off = hide.indexOf(b.dataset.blk) >= 0 && !NOHIDE[b.dataset.blk];
      b.classList.toggle("hb-off", off);
      var kids = Array.prototype.filter.call(b.children, function (c) { return !c.classList.contains("hb-bar"); });
      b.classList.toggle("hb-empty", kids.length > 0 && kids.every(function (c) { return c.hidden; }));
      if (editing) paintBar(b, off);
    });
  }
  function save(order) {
    cfg().homeOrder = order || blocks().map(function (b) { return b.dataset.blk; });
    W.save();
  }

  function paintBar(b, off) {
    var bar = b.querySelector(":scope > .hb-bar");
    if (!bar) {
      var h = W.h, name = b.dataset.name || b.dataset.blk;
      bar = h("div", { class: "hb-bar" },
        h("button", { class: "hb-grip", type: "button", "aria-label": name + " 끌어서 옮기기", title: "끌어서 옮기기", text: "⠿" }),
        h("span", { class: "hb-name", text: name }),
        h("span", { class: "hb-state" }),
        h("button", { class: "hb-btn", type: "button", "aria-label": name + " 위로", text: "▲", onclick: function () { step(b, -1); } }),
        h("button", { class: "hb-btn", type: "button", "aria-label": name + " 아래로", text: "▼", onclick: function () { step(b, 1); } }),
        NOHIDE[b.dataset.blk] ? null : h("button", { class: "hb-btn hb-hide", type: "button", onclick: function () { toggleHide(b); } }));
      b.insertBefore(bar, b.firstChild);
      bar.querySelector(".hb-grip").addEventListener("pointerdown", grab);
    }
    var hb = bar.querySelector(".hb-hide");
    if (hb) { hb.textContent = off ? "보이기" : "숨기기"; hb.setAttribute("aria-pressed", off ? "true" : "false"); }
    bar.querySelector(".hb-state").textContent = off ? "숨김" : "";
    var list = blocks(), i = list.indexOf(b);
    bar.children[3].disabled = i === 0; bar.children[4].disabled = i === list.length - 1;
  }
  function step(b, d) {
    var list = blocks(), i = list.indexOf(b), j = i + d;
    if (j < 0 || j >= list.length) return;
    var ids = list.map(function (x) { return x.dataset.blk; });
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    save(ids); apply();
    var btn = b.querySelector(".hb-bar").children[d < 0 ? 3 : 4];
    if (btn.disabled) btn = b.querySelector(".hb-bar").children[d < 0 ? 4 : 3];
    btn.focus();
    announce((b.dataset.name || "") + " " + (j + 1) + "번째");
  }
  function toggleHide(b) {
    var id = b.dataset.blk, hide = (cfg().homeHide || []).slice(), k = hide.indexOf(id);
    if (k >= 0) hide.splice(k, 1); else hide.push(id);
    cfg().homeHide = hide; W.save(); apply();
  }
  function announce(t) { var a = document.getElementById("hb-live"); if (a) { a.textContent = ""; setTimeout(function () { a.textContent = t; }, 30); } }

  /* ⠿ 손잡이 끌기 (손가락·마우스 모두) */
  function grab(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var b = e.currentTarget.closest(".hblk"); if (!b) return;
    e.preventDefault();
    var r = b.getBoundingClientRect();
    drag = { b: b, id: e.pointerId, y0: e.clientY, top: r.top };
    b.classList.add("hb-drag");
    /* 칸을 옮기면 손잡이도 문서 안에서 자리를 옮겨 pointer capture 가 풀리므로 window 에서 받는다 */
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", dropDrag);
    window.addEventListener("pointercancel", dropDrag);
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var b = drag.b, list = blocks().filter(function (x) { return x !== b; }), y = e.clientY;
    var before = null;
    for (var i = 0; i < list.length; i++) { var r = list[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { before = list[i]; break; } }
    var v = view();
    if (before) { if (b.nextElementSibling !== before) v.insertBefore(b, before); }
    else if (v.lastElementChild !== b) v.appendChild(b);
    /* 화면 끝에 가까우면 천천히 스크롤 */
    if (y < 70) window.scrollBy(0, -12); else if (y > window.innerHeight - 70) window.scrollBy(0, 12);
  }
  function dropDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener("pointermove", moveDrag); window.removeEventListener("pointerup", dropDrag); window.removeEventListener("pointercancel", dropDrag);
    drag.b.classList.remove("hb-drag");
    var b = drag.b; drag = null;
    save(); apply();
    announce((b.dataset.name || "") + " " + (blocks().indexOf(b) + 1) + "번째");
  }

  function setEdit(on) {
    editing = on;
    var v = view(), btn = document.getElementById("home-edit");
    v.classList.toggle("hedit", on);
    btn.textContent = on ? "완료" : "⇅ 홈 순서";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    document.getElementById("home-reset").hidden = !on;
    document.getElementById("home-help").hidden = !on;
    if (!on) blocks().forEach(function (b) { var bar = b.querySelector(":scope > .hb-bar"); if (bar) bar.remove(); });
    apply();
  }

  function setup() {
    W = window.WB; ready = true;
    DEFAULT = blocks().map(function (b) { return b.dataset.blk; });
    var bar = document.getElementById("home-bar"), h = W.h;
    bar.insertBefore(h("span", { class: "hb-help", id: "home-help", hidden: true, text: "⠿ 를 끌거나 ▲▼ 로 순서를 바꾸세요" }), bar.firstChild);
    bar.appendChild(h("button", { class: "hb-edit ghost", id: "home-reset", type: "button", hidden: true, text: "기본 순서", onclick: function () {
      cfg().homeOrder = DEFAULT.slice(); cfg().homeHide = []; W.save(); apply(); W.toast("기본 순서로 되돌렸습니다");
    } }));
    bar.appendChild(h("span", { class: "sr", id: "hb-live", "aria-live": "polite" }));
    document.getElementById("home-edit").addEventListener("click", function () { setEdit(!editing); });
    window.addEventListener("hashchange", function () { if (editing) setEdit(false); });
  }
  function render() {
    if (!window.WB || !view()) return;
    if (!ready) setup();
    apply();
  }
  (window.WBViews = window.WBViews || []).push(render);
})();
