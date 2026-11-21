/* 가계부 확장: 계좌·이체·부채, 분류별 월 예산, 반복 지출 */
(function () {
  "use strict";
  var KIND = { bank: "통장", cash: "현금", invest: "증권·투자", other: "기타 자산", card: "신용카드", loan: "대출" };
  var DEBT = { card: 1, loan: 1 };
  var W, ready = false;

  function S() { return W.state(); }
  function accts() {
    return [{ id: "main", name: "기본 계좌", kind: "bank", opening: +S().config.base || 0, main: true }].concat(S().accounts || []);
  }
  function acct(id) { return accts().filter(function (a) { return a.id === (id || "main"); })[0]; }
  window.WBAcctName = function (id) { var a = acct(id); return a ? a.name : "(지운 계좌)"; };

  function entries() {
    var out = [], m = S().money || {};
    Object.keys(m).forEach(function (k) { Object.keys(m[k] || {}).forEach(function (id) { out.push(Object.assign({ id: id, key: k }, m[k][id])); }); });
    return out;
  }
  /* 계좌별 잔액(자산은 +, 부채는 −). 평가액을 넣은 투자 계좌는 평가액을 쓴다. */
  function balances() {
    var b = {}, used = {};
    accts().forEach(function (a) { b[a.id] = DEBT[a.kind] ? -(+a.opening || 0) : (+a.opening || 0); });
    entries().forEach(function (e) {
      var a = e.acct || "main", v = +e.amt || 0;
      used[a] = 1; if (e.to) used[e.to] = 1;
      if (b[a] == null) b[a] = 0;
      if (e.type === "in") b[a] += v;
      else if (e.type === "tr") { b[a] -= v; if (e.to) b[e.to] = (b[e.to] || 0) + v; }
      else b[a] -= v;
    });
    var shown = {};
    accts().forEach(function (a) { shown[a.id] = a.value != null && a.value !== "" && !DEBT[a.kind] ? +a.value : b[a.id] || 0; });
    return { flow: b, shown: shown, used: used };
  }
  function save() { W.save(); W.draw(); }
  function opts(sel, list, keepEmpty) {
    if (document.activeElement === sel) return;
    var keep = sel.value; sel.textContent = "";
    if (keepEmpty) sel.appendChild(W.h("option", { value: "" }, keepEmpty));
    list.forEach(function (x) { sel.appendChild(W.h("option", { value: x[0] }, x[1])); });
    if ([].some.call(sel.options, function (o) { return o.value === keep; })) sel.value = keep;
  }
  function askAmount(msg, cur) {
    var v = prompt(msg, cur != null ? String(cur) : "");
    if (v == null) return null;
    v = Math.round(+String(v).replace(/[^0-9.-]/g, ""));
    if (!isFinite(v)) { W.toast("숫자로 적어 주세요"); return null; }
    return v;
  }

  function setup() {
    W = window.WB; ready = true;
    var $ = W.$;
    W.on("#acct-form", function (f) {
      var o = { name: W.val("#acct-name"), kind: $("#acct-kind").value, opening: Math.round(+W.val("#acct-open") || 0), ord: Date.now() };
      W.add("accounts", o); f.reset(); $("#acct-add").open = false; W.toast(o.name + " 계좌를 추가했습니다");
    });
    W.on("#rec-form", function (f) {
      var day = Math.min(31, Math.max(1, Math.round(+W.val("#rec-day") || 1)));
      W.add("recurring", { title: W.val("#rec-title"), amt: Math.round(+W.val("#rec-amt") || 0), cat: $("#rec-cat").value, acct: $("#rec-acct").value || "main", day: day, active: true });
      f.reset(); W.toast("반복 지출을 추가했습니다");
    });
    $("#bud-box").addEventListener("focusout", function () { setTimeout(function () { if (!$("#bud-box").contains(document.activeElement)) W.draw(); }, 0); });
  }

  /* ---------- 계좌 ---------- */
  function renderAccounts() {
    var h = W.h, box = W.$("#acct-list"), bal = balances();
    box.textContent = "";
    var ul = h("ul", { class: "list" });
    accts().forEach(function (a) {
      var v = bal.shown[a.id], isDebt = !!DEBT[a.kind], valued = a.value != null && a.value !== "" && !isDebt;
      ul.appendChild(h("li", null,
        h("span", { class: "pill " + (isDebt ? "crit" : a.kind === "invest" ? "info" : "plain") }, KIND[a.kind] || a.kind),
        h("span", { class: "main" }, h("b", null, a.name),
          h("div", { class: "sub" }, (isDebt ? "갚을 돈 " + W.won(-v) : W.won(v)) +
            (valued ? " · 평가액(" + W.nice(a.valueAt || W.today()) + "), 기록 기준 " + W.won(bal.flow[a.id] || 0) : "") +
            " · 시작 " + W.won(+a.opening || 0))),
        a.kind === "invest" || a.kind === "other" ? h("button", { class: "btn ghost sm", type: "button", onclick: function () {
          var n = askAmount(a.name + "의 지금 평가액(원). 비우면 기록 기준으로 계산합니다.", a.value);
          if (n == null) return;
          W.upd("accounts", a.id, { value: n, valueAt: W.today() });
        } }, "평가액") : null,
        h("button", { class: "btn ghost sm", type: "button", onclick: function () {
          var n = askAmount(a.name + "의 시작 금액(원)" + (isDebt ? " — 갚을 돈을 양수로" : ""), a.opening || 0);
          if (n == null) return;
          if (a.main) { S().config.base = n; save(); } else W.upd("accounts", a.id, { opening: n });
        } }, "시작 금액"),
        a.main ? null : W.delBtn(function () {
          if (bal.used[a.id]) { W.toast("이 계좌로 적은 기록이 있어 지울 수 없습니다"); return; }
          if ((S().recurring || []).some(function (r) { return r.acct === a.id; })) { W.toast("이 계좌를 쓰는 반복 지출이 있어 지울 수 없습니다"); return; }
          W.del("accounts", a.id);
        })));
    });
    box.appendChild(ul);
    var list = accts().map(function (a) { return [a.id, a.name]; });
    opts(W.$("#m-acct"), list);
    opts(W.$("#m-to"), list, "받는 계좌");
    opts(W.$("#rec-acct"), list);
    opts(W.$("#rec-cat"), W.cats("money").filter(function (c) { return c !== "저축·투자"; }).map(function (c) { return [c, c]; }));
  }

  /* ---------- 예산 ---------- */
  function budgets() { var m = {}; (S().budgets || []).forEach(function (b) { m[b.cat] = +b.amt || 0; }); return m; }
  function setBudget(cat, amt) {
    var list = S().budgets || (S().budgets = []), hit = list.filter(function (b) { return b.cat === cat; })[0];
    if (!amt) { if (hit) W.del("budgets", hit.id); return; }
    if (hit) W.upd("budgets", hit.id, { amt: amt }); else W.add("budgets", { cat: cat, amt: amt });
  }
  function renderBudget() {
    var h = W.h, key = W.viewMonth(), m = W.monthSum(key), bud = budgets(), box = W.$("#bud-box"), p = key.split("-");
    W.$("#bud-month").textContent = p[0] + "년 " + (+p[1]) + "월 지출 기준 · 달력에서 달을 바꾸면 따라 바뀝니다";
    if (box.contains(document.activeElement)) return;
    box.textContent = "";
    var tb = 0, ts = 0, rows = h("div", { class: "budrows" });
    W.cats("money").filter(function (c) { return c !== "저축·투자"; }).forEach(function (c) {
      var spent = m.cats[c] || 0, b = bud[c] || 0, pct = b ? Math.round(spent / b * 100) : 0;
      tb += b; if (b) ts += spent;
      var inp = h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", step: "10000", value: b || "", placeholder: "예산 없음", "aria-label": c + " 월 예산(원)",
        onchange: function (e) { setBudget(c, Math.round(+e.target.value || 0)); } });
      rows.appendChild(h("div", { class: "budrow" + (b && spent > b ? " over" : "") },
        h("span", { class: "nm" }, c),
        h("div", { class: "meter" + (b && spent > b ? " over" : "") }, h("i", { style: "width:" + Math.min(100, pct) + "%" })),
        h("span", { class: "amt" }, W.won(spent) + (b ? " / " + W.short(b) : ""),
          b && spent > b ? h("span", { class: "pill crit" }, "초과 " + W.short(spent - b)) : b && pct >= 90 ? h("span", { class: "pill warn" }, pct + "%") : null),
        inp));
    });
    box.appendChild(h("div", { class: "tiles", style: "margin-bottom:10px" },
      W.tile("예산 합계", W.won(tb)), W.tile("예산 잡은 분류 지출", W.won(ts)), W.tile(ts > tb ? "초과" : "남은 예산", W.won(Math.abs(tb - ts))), W.tile("이번 달 전체 지출", W.won(m.out))));
    box.appendChild(rows);
    box.appendChild(h("p", { class: "muted", style: "font-size:13px;margin:8px 0 0" }, "예산은 매달 같은 금액으로 적용됩니다. 칸에 금액을 적고 다른 곳을 누르면 저장됩니다."));
  }
  function renderBudgetWarn() {
    var h = W.h, m = W.monthSum(W.viewMonth()), bud = budgets(), el = W.$("#bud-warn"), over = [], near = [];
    Object.keys(bud).forEach(function (c) { var s = m.cats[c] || 0, b = bud[c]; if (!b) return; if (s > b) over.push(c + " " + W.short(s) + "/" + W.short(b)); else if (s >= b * 0.9) near.push(c); });
    el.textContent = "";
    if (over.length) el.appendChild(h("p", { class: "warnline" }, h("span", { class: "pill crit" }, "예산 초과"), " " + over.join(", ")));
    if (near.length) el.appendChild(h("p", { class: "warnline warn" }, h("span", { class: "pill warn" }, "90% 넘음"), " " + near.join(", ")));
  }

  /* ---------- 반복 지출 ---------- */
  function dayOf(key, day) { var p = key.split("-"), last = new Date(+p[0], +p[1], 0).getDate(); return key + "-" + W.pad(Math.min(day, last)); }
  function posted(key, id) { var it = (S().money || {})[key] || {}; return Object.keys(it).some(function (k) { return it[k].rec === id; }); }
  function post(key, r) {
    var o = { type: "out", amt: +r.amt, cat: r.cat || "기타", memo: r.title, date: dayOf(key, r.day || 1), rec: r.id };
    if (r.acct && r.acct !== "main") o.acct = r.acct;
    if (r.work) o.work = r.work;
    W.moneyAdd(key, o);
  }
  function renderRecurring() {
    var h = W.h, list = W.sortBy(S().recurring || [], function (r) { return W.pad(r.day || 1) + r.title; });
    W.fill(W.$("#rec-list"), list.map(function (r) {
      return h("li", { class: r.active === false ? "muted" : null },
        h("span", { class: "pill plain" }, "매달 " + (r.day || 1) + "일"),
        h("span", { class: "main" }, h("b", null, r.title), " ", h("span", { class: "amt" }, W.won(r.amt)),
          h("div", { class: "sub" }, [r.cat, window.WBAcctName(r.acct), r.active === false ? "멈춤" : ""].filter(Boolean).join(" · "))),
        h("button", { class: "btn ghost sm", type: "button", onclick: function () { W.upd("recurring", r.id, { active: r.active === false }); } }, r.active === false ? "다시 켜기" : "멈추기"),
        W.delBtn(function () { W.del("recurring", r.id); }));
    }), "반복 지출이 없습니다. 통신비·구독료처럼 매달 나가는 돈을 등록하세요.");
    /* 이번 달에 아직 안 적은 반복 지출 */
    var key = W.nowKey(), td = W.today(), due = list.filter(function (r) { return r.active !== false && !posted(key, r.id); });
    var box = W.$("#rec-due"); box.textContent = "";
    var calTab = W.$("#mtab-cal") && W.$("#mtab-cal").checked;
    box.hidden = !due.length || W.viewMonth() !== key || !calTab;
    if (box.hidden) return;
    box.appendChild(h("h2", null, "이번 달 반복 지출 " + due.length + "건 아직 안 적음",
      h("button", { class: "btn sm", type: "button", onclick: function () { due.forEach(function (r) { post(key, r); }); W.toast(due.length + "건 기록했습니다"); } }, "모두 기록")));
    box.appendChild(h("ul", { class: "list" }, due.map(function (r) {
      var d = dayOf(key, r.day || 1);
      return h("li", null, h("span", { class: "pill " + (d <= td ? "warn" : "plain") }, d <= td ? "날짜 지남" : W.nice(d)),
        h("span", { class: "main" }, h("b", null, r.title), " ", h("span", { class: "amt" }, W.won(r.amt))),
        h("button", { class: "btn ghost sm", type: "button", onclick: function () { post(key, r); W.toast(r.title + " 기록"); } }, "기록"));
    })));
  }

  function render() {
    if (!window.WB) return;
    if (!ready) setup();
    renderAccounts();
    renderBudget();
    renderBudgetWarn();
    renderRecurring();
  }
  (window.WBViews = window.WBViews || []).push(render);
  window.WBMoney = { post: post, entries: entries };
})();
