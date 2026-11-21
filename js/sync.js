// 업무 보드: Google 로그인과 PC·폰 동기화 화면
import { SyncCore, LABEL, collections, clean, rid } from "./sync-core.js";
import { firebaseConfig } from "./firebase-config.js";

const app = window.WBApp;
const box = document.getElementById("sync-card");
const chip = document.getElementById("syncchip");
const ls = window.localStorage;

let backend = null, user = null, core = null, loadError = null, busy = false, lastStatus = {}, checkResult = null, authError = "";

const DEV = (() => { let d = ls.getItem("wb-device"); if (!d) { d = "d" + rid().slice(0, 12); ls.setItem("wb-device", d); } return d; })();
const secKey = () => "wb-secok-" + user.uid;
const ledgerKey = () => "wb-ledger-" + user.uid;
const ledgerOn = () => !!user && ls.getItem(ledgerKey()) === "1" && !!ls.getItem(secKey());

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === "text") e.textContent = attrs[k];
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const btn = (text, onclick, cls) => el("button", { type: "button", class: "btn " + (cls || "ghost sm"), onclick }, text);
const toast = (m) => app && app.toast(m);
const day = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

function errText(e) {
  const c = String((e && (e.code || e.message)) || e || "");
  if (/unauthorized-domain/.test(c)) return "Firebase의 승인된 도메인에 ekekfm.github.io가 없습니다. Authentication → 설정 → 승인된 도메인에 추가해 주세요.";
  if (/operation-not-allowed/.test(c)) return "Firebase에서 Google 로그인이 꺼져 있습니다. Authentication → 로그인 방법에서 Google을 사용 설정해 주세요.";
  if (/popup-blocked/.test(c)) return "로그인 창이 막혔습니다. 브라우저에서 팝업을 허용한 뒤 다시 눌러 주세요.";
  if (/network/.test(c)) return "인터넷 연결을 확인해 주세요.";
  if (/permission/.test(c)) return "서버가 요청을 거부했습니다. 보안 규칙이 아직 등록되지 않았을 수 있습니다(설명서 2단계).";
  if (/unavailable|offline/.test(c)) return "서버에 연결하지 못했습니다. 이 기기에 저장해 두고, 연결되면 보냅니다.";
  return "오류: " + c;
}

function statusText() {
  if (!user) return "";
  const s = lastStatus;
  if (s.error) return errText(s.error);
  if (!navigator.onLine) return s.pending ? "오프라인 · 보낼 기록 " + s.pending + "건 대기" : "오프라인 · 이 기기에 저장 중";
  if (s.pending) return "보내는 중 " + s.pending + "건";
  if (!s.ready) return "계정 기록을 받는 중";
  return "동기화됨";
}

function paintChip() {
  if (!chip) return;
  if (loadError || !backend) { chip.hidden = true; return; }
  chip.hidden = false;
  if (!user || !core) { chip.textContent = "동기화 꺼짐 · 로그인"; chip.className = "syncchip off"; return; }
  const s = lastStatus;
  chip.textContent = s.error ? "동기화 확인 필요" : !navigator.onLine ? "오프라인" : s.pending ? "저장 중 " + s.pending : !s.ready ? "받는 중" : "동기화됨";
  chip.className = "syncchip" + (s.error ? " bad" : (!navigator.onLine || s.pending || !s.ready) ? " wait" : "");
}

function paint() {
  paintChip();
  if (!box) return;
  box.textContent = "";
  box.append(el("h2", {}, "PC·폰 동기화", user ? el("small", { text: user.email }) : null));

  if (loadError) {
    box.append(el("p", { class: "muted", text: "동기화 기능을 불러오지 못했습니다. 인터넷에 연결된 뒤 새로고침해 주세요. 그동안 기록은 이 기기에 그대로 저장됩니다." }));
    return;
  }
  if (!backend) { box.append(el("p", { class: "muted", text: "준비 중…" })); return; }

  if (!user) {
    box.append(el("p", { class: "muted", text: "Google 계정으로 로그인하면 PC와 폰에서 같은 기록을 봅니다. 로그인하지 않으면 지금처럼 이 기기에만 저장됩니다." }));
    if (authError) box.append(el("p", { class: "sync-err", text: authError }));
    box.append(el("div", { class: "row" }, btn("Google로 로그인", signIn, "")));
    return;
  }

  box.append(el("p", { class: "sync-state" + (lastStatus.error ? " bad" : ""), text: statusText() }));

  // 동기화 현황
  if (core) {
    const counts = core.counts();
    box.append(el("details", {}, el("summary", { text: "동기화 현황" }),
      el("ul", { class: "list" }, Object.keys(counts).map((c) =>
        el("li", {}, el("span", { class: "main" }, LABEL[c] || c),
          el("span", { class: "muted", text: "이 기기 " + counts[c].here + "건 · 계정 " + counts[c].synced + "건" }))))));
  }

  // 보안 점검 → 가계부 동기화
  const ok = ls.getItem(secKey());
  const sec = el("div", { class: "sync-sec" });
  sec.append(el("p", { class: "muted", text: ok ? "보안 점검 통과: " + day(ok) : "가계부·자산배분은 보안 점검을 통과한 뒤에 동기화할 수 있습니다. 지금은 이 기기에만 저장됩니다." }));
  const row = el("div", { class: "row" }, btn(busy ? "점검 중…" : "보안 점검 실행", runCheck));
  if (ok) row.append(ledgerOn()
    ? btn("가계부 동기화 끄기", () => setLedger(false))
    : btn("가계부·자산배분도 동기화", () => setLedger(true), "sm"));
  sec.append(row);
  if (checkResult) sec.append(el("ul", { class: "list" }, checkResult.map((r) =>
    el("li", {}, el("span", { class: "main", text: r.name }),
      el("span", { class: "pill " + (r.ok === true ? "good" : r.ok === null ? "warn" : "crit"), text: r.ok === true ? "통과" : r.ok === null ? "확인 못 함" : "실패" }),
      r.ok === true ? null : el("span", { class: "sub", text: r.detail })))));
  box.append(sec);

  // 충돌 기록
  const cf = core ? core.conflicts() : [];
  if (cf.length) {
    box.append(el("details", {}, el("summary", { text: "충돌 기록 " + cf.length + "건 (다른 기기 내용으로 바뀌기 전 내 내용)" }),
      el("ul", { class: "list" }, cf.map((x, i) => el("li", {},
        el("span", { class: "main" }, el("b", { text: (LABEL[x.col] || x.col) + " · " + summary(x.data) }),
          el("div", { class: "sub", text: x.why + " · " + day(x.at) })),
        btn("되살리기", () => restore(i)), btn("지우기", () => { core.dropConflict(i); paint(); }))))));
  }

  // 동기화 전 기록
  if (ls.getItem("homeboard-v2-before-sync")) box.append(el("p", { class: "muted", style: "font-size:13px" },
    "동기화를 시작하기 전 이 기기 기록을 따로 보관해 두었습니다. ",
    el("a", { href: "#", onclick: (e) => { e.preventDefault(); downloadBefore(); } }, "내려받기")));

  box.append(el("div", { class: "row" }, btn("로그아웃", () => backend.signOut())));
}

function summary(d) {
  const t = d.title || d.text || d.name || d.memo || d.body || (d.amt != null ? Number(d.amt).toLocaleString("ko-KR") + "원" : "") || d.id;
  return String(t).slice(0, 40);
}

function restore(i) {
  const x = core.conflicts()[i];
  if (!x) return;
  const S = app.state(), cols = collections(), c = cols[x.col];
  if (!c) return;
  const items = c.get(S).slice();
  items.push(Object.assign(clean(x.data), { id: rid() }));
  c.set(S, items);
  core.dropConflict(i);
  app.save();            // 저장하면 새 기록으로 서버에 올라간다
  toast("되살렸습니다");
  paint();
}

function downloadBefore() {
  const a = el("a", { href: URL.createObjectURL(new Blob([ls.getItem("homeboard-v2-before-sync")], { type: "application/json" })), download: "업무보드-동기화전-기록.json" });
  document.body.append(a); a.click(); a.remove();
}

async function signIn() {
  authError = "";
  try { await backend.signIn(); }
  catch (e) {
    const c = String(e && e.code || "");
    if (!/popup-closed|cancelled-popup/.test(c)) { authError = errText(e); paint(); }
  }
}

async function runCheck() {
  if (busy || !user) return;
  busy = true; checkResult = null; paint();
  try {
    checkResult = await backend.securityCheck(user.uid);
    if (checkResult.every((r) => r.ok === true)) { ls.setItem(secKey(), new Date().toISOString()); toast("보안 점검을 모두 통과했습니다"); }
    else { ls.removeItem(secKey()); if (ls.getItem(ledgerKey()) === "1") setLedger(false, true); toast("통과하지 못한 항목이 있습니다"); }
  } catch (e) { checkResult = [{ name: "보안 점검", ok: null, detail: errText(e) }]; }
  busy = false; paint();
}

function setLedger(on, quiet) {
  if (on) {
    if (!confirm("가계부와 자산배분 기록도 계정에 올려 PC·폰에서 함께 봅니다. 진행할까요?")) return;
    ls.setItem(ledgerKey(), "1");
  } else ls.removeItem(ledgerKey());
  if (core) core.refreshCols();
  if (!quiet) toast(on ? "가계부 동기화를 켰습니다" : "가계부 동기화를 껐습니다. 기록은 이 기기에 남습니다");
  paint();
}

function startUser(u) {
  user = u;
  authError = "";
  if (!ls.getItem("homeboard-v2-before-sync")) {
    const cur = ls.getItem("homeboard-v2");
    if (cur) try { ls.setItem("homeboard-v2-before-sync", cur); } catch (e) {}
  }
  core = new SyncCore({
    uid: u.uid, dev: DEV, backend, app, storage: ls, ledgerOn,
    onStatus: (s) => { lastStatus = s; paintSoon(); },
    onConflict: (n) => { toast("다른 기기 내용과 겹친 기록이 있어 충돌 기록에 남겼습니다(" + n + "건)"); paintSoon(); },
  });
  core.start();
  paint();
}
function stopUser() {
  if (core) core.stop();
  core = null; user = null; lastStatus = {}; checkResult = null;
  paint();
}
let paintTimer = 0;
function paintSoon() { clearTimeout(paintTimer); paintTimer = setTimeout(paint, 150); }

window.WBSync = { changed() { if (core) core.changed(); } };

window.addEventListener("online", paintSoon);
if (chip) chip.addEventListener("click", () => setTimeout(() => box && box.scrollIntoView({ behavior: "smooth", block: "start" }), 80));
window.addEventListener("offline", paintSoon);

paint();
try {
  const mod = await import("./firebase-backend.js");
  backend = await mod.createBackend(firebaseConfig);
  backend.onAuth((u) => { if (u && (!user || user.uid !== u.uid)) { if (core) stopUser(); startUser(u); } else if (!u && user) stopUser(); else paint(); });
} catch (e) {
  loadError = e;
}
paint();
