// 업무 보드 동기화 핵심 규칙 (Firebase와 화면을 모르는 순수 로직이라 따로 시험할 수 있다)
//
// - 기록 한 건 = Firestore 문서 한 개: users/{uid}/{컬렉션}/{기록 id}
// - 문서 모양: { data: 기록 내용, v: 고친 횟수, wid: 이번 저장의 표식, dev: 기기 표식, at: 서버 시각, deletedAt }
// - 저장할 때마다 v를 1씩 올린다. 서버 규칙이 "직전 v + 1"만 받아 주므로,
//   두 기기가 같은 기록을 동시에 고치면 늦게 도착한 쪽이 거부된다. 거부된 쪽 내용은 지우지 않고 "충돌 기록"에 남긴다.
// - 지우기는 deletedAt만 채운다(휴지통). 문서를 완전히 지우는 요청은 서버 규칙이 막는다.

export function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}
export function hash(v) {
  const s = stable(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function clean(v) { return JSON.parse(JSON.stringify(v)); }
export function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

const LISTS = ["tasks", "events", "biz", "leads", "logs", "notes", "links", "work", "timelog", "ideas", "notebooks"];
export const FIN = ["allocs", "ledger", "accounts", "recurring", "budgets"]; // 가계부 관련: 보안 점검을 통과한 뒤에만 동기화
const NO_CONFLICT = ["links", "settings"];         // 바로가기·설정은 서버 쪽을 그대로 따른다
export const LABEL = { tasks: "할 일", events: "일정", biz: "사업", leads: "상담", logs: "기록", notes: "메모",
  links: "앱 바로가기", work: "업무", timelog: "작업 시간", ideas: "아이디어", notebooks: "노트북", settings: "설정", allocs: "자산배분", ledger: "가계부", accounts: "계좌", recurring: "반복 지출", budgets: "예산" };

// 화면 상태(S)와 컬렉션 사이의 변환
export function collections() {
  const cols = {};
  for (const c of LISTS) cols[c] = { get: (S) => S[c] || [], set: (S, items) => { S[c] = items; } };
  cols.settings = {
    get: (S) => [Object.assign({}, S.config || {}, { id: "main" })],
    set: (S, items) => {
      const m = items.find((x) => x.id === "main");
      if (m) { const o = Object.assign({}, m); delete o.id; S.config = o; }
    },
  };
  for (const c of ["allocs", "accounts", "recurring", "budgets"]) cols[c] = { get: (S) => S[c] || [], set: (S, items) => { S[c] = items; } };
  cols.ledger = {
    get: (S) => {
      const out = [], m = S.money || {};
      for (const k of Object.keys(m)) for (const id of Object.keys(m[k] || {})) {
        const e = m[k][id] || {};
        out.push(Object.assign({}, e, { id, k, amt: Math.round(Number(e.amt) || 0) }));
      }
      return out;
    },
    set: (S, items) => {
      const m = {};
      for (const it of items) {
        const o = Object.assign({}, it), k = o.k, id = o.id;
        delete o.k; delete o.id;
        (m[k] = m[k] || {})[id] = o;
      }
      S.money = m;
    },
  };
  return cols;
}

function denied(e) { return !!e && /permission|denied/i.test(String(e.code || e.message || e)); }

export class SyncCore {
  /**
   * @param o.uid       로그인한 사용자 id
   * @param o.dev       이 기기 표식
   * @param o.backend   { listen(uid,col,onDocs,onErr)->unsub, write(uid,col,id,doc,isDelete)->Promise, getServer(uid,col,id)->Promise<doc|null> }
   * @param o.app       { state()->S, commit() }  commit: 이 기기에 저장하고 화면을 다시 그린다(동기화를 다시 부르지 않음)
   * @param o.storage   localStorage 같은 것
   * @param o.ledgerOn  () => 가계부 동기화를 켰는지
   * @param o.onStatus  (상태) => 화면 표시
   */
  constructor(o) {
    Object.assign(this, o);
    this.cols = collections();
    this.base = this.load("base") || {};
    this.ready = {};
    for (const c of Object.keys(this.base)) if (Object.keys(this.base[c]).length) this.ready[c] = true;
    this.unsubs = {};
    this.pending = 0;
    this.error = null;
    this.timer = null;
    this.baseTimer = null;
  }
  k(n) { return "wb-" + n + "-" + this.uid; }
  load(n) { try { return JSON.parse(this.storage.getItem(this.k(n)) || "null"); } catch (e) { return null; } }
  saveBase(now) {
    clearTimeout(this.baseTimer);
    const run = () => { try { this.storage.setItem(this.k("base"), JSON.stringify(this.base)); } catch (e) {} };
    if (now) run(); else this.baseTimer = setTimeout(run, 300);
  }
  activeCols() { return Object.keys(this.cols).filter((c) => !FIN.includes(c) || this.ledgerOn()); }
  status() { if (this.onStatus) this.onStatus({ pending: this.pending, error: this.error, ready: this.activeCols().every((c) => this.ready[c]) }); }

  start() { this.started = true; for (const c of this.activeCols()) this.listen(c); this.status(); }
  stop() { this.started = false; for (const c of Object.keys(this.unsubs)) this.unsubs[c](); this.unsubs = {}; clearTimeout(this.timer); for (const k in (this.retry || {})) clearTimeout(this.retry[k]); this.saveBase(true); }
  refreshCols() {
    const want = this.activeCols();
    for (const c of Object.keys(this.unsubs)) if (!want.includes(c)) { this.unsubs[c](); delete this.unsubs[c]; }
    for (const c of want) this.listen(c);
    this.status();
  }
  listen(c) {
    if (this.unsubs[c]) return;
    this.unsubs[c] = this.backend.listen(this.uid, c,
      (docs, fromCache) => this.onDocs(c, docs, fromCache),
      (e) => {
        // 듣기가 끊겼다(예: 보안 규칙에 아직 없는 컬렉션). 30초 뒤 다시 시도한다.
        this.error = e; this.status();
        if (this.unsubs[c]) { delete this.unsubs[c]; }
        clearTimeout(this.retry && this.retry[c]);
        this.retry = this.retry || {};
        this.retry[c] = setTimeout(() => { if (this.started && this.activeCols().includes(c)) this.listen(c); }, this.retryMs || 30000);
      });
  }

  // 서버(또는 서버에서 받아 둔 저장본)에서 온 문서를 화면 상태에 반영한다
  onDocs(c, docs, fromCache) {
    const base = this.base[c] || (this.base[c] = {});
    const S = this.app.state();
    const items = this.cols[c].get(S).slice();
    const idx = new Map(items.map((x, i) => [String(x && x.id), i]));
    let changed = false;
    for (const d of docs) {
      const b = base[d.id];
      if (b && d.wid && d.wid === b.w) continue;                // 내가 보낸 저장이 돌아온 것
      if (b && !b.err && d.v < b.v) continue;                  // 내 쪽이 더 최신(아직 서버 확인 전)
      const i = idx.get(d.id);
      const local = i != null ? items[i] : null;
      if (local && !NO_CONFLICT.includes(c)) {
        const lh = hash(clean(local));
        const unsynced = !b || b.p || b.err || lh !== b.h;
        if (unsynced && (d.deleted || lh !== hash(d.data))) this.conflict(c, local, d.deleted ? "다른 기기에서 지움" : "다른 기기에서 먼저 고침");
      }
      if (d.deleted) { if (i != null) items[i] = null; }
      else {
        const data = clean(d.data);
        if (i != null) items[i] = data; else { idx.set(d.id, items.length); items.push(data); }
      }
      base[d.id] = { v: d.v, h: d.deleted ? "" : hash(d.data), w: d.wid || "", d: !!d.deleted };
      changed = true;
    }
    if (!fromCache && this.error && /permission/i.test(String(this.error.code || this.error.message || this.error))) { this.error = null; this.status(); }
    if (!fromCache && !this.ready[c]) { this.ready[c] = true; this.status(); }
    if (changed) {
      this.cols[c].set(S, items.filter((x) => x != null));
      this.saveBase();
      this.app.commit(c);
    }
    if (this.ready[c]) this.schedule();
  }

  changed() { this.schedule(); }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.push(), 400); }

  // 이 기기에서 바뀐 기록만 골라 서버로 보낸다
  push() {
    const S = this.app.state();
    for (const c of this.activeCols()) {
      if (!this.ready[c]) continue;
      const base = this.base[c] || (this.base[c] = {});
      const seen = new Set();
      for (const it of this.cols[c].get(S)) {
        if (!it || it.id == null) continue;
        const id = String(it.id);
        seen.add(id);
        const data = clean(it), h = hash(data), b = base[id];
        if (b && !b.d && b.h === h) continue;                  // 바뀐 것 없음
        const v = b && !b.err ? b.v + 1 : 1;
        this.write(c, id, { data, v, deleted: false }, h);
      }
      for (const id of Object.keys(base)) {
        const b = base[id];
        if (seen.has(id) || b.d || b.err) continue;            // 이 기기에서 지운 기록 → 휴지통으로
        this.write(c, id, { v: b.v + 1, deleted: true }, "");
      }
    }
  }

  write(c, id, obj, h) {
    const w = rid();
    const doc = Object.assign({}, obj, { wid: w, dev: this.dev });
    this.base[c][id] = { v: obj.v, h, w, d: !!obj.deleted, p: true };
    this.saveBase();
    this.pending++; this.status();
    this.backend.write(this.uid, c, id, doc, !!obj.deleted).then(() => {
      const b = this.base[c][id];
      if (b && b.w === w) { delete b.p; this.saveBase(); }
      if (this.error && !denied(this.error)) this.error = null;
    }, (e) => this.rejected(c, id, w, e)).finally(() => { this.pending--; this.status(); });
  }

  // 서버가 저장을 거부했을 때: 서버에 있는 내용을 따르고, 내 내용은 충돌 기록으로 남긴다
  async rejected(c, id, w, e) {
    const b = this.base[c][id];
    if (!b || b.w !== w) return;                               // 이미 다른 기기 내용으로 바뀜
    let srv = null;
    try { srv = await this.backend.getServer(this.uid, c, id); } catch (x) {}
    if (srv) {
      delete this.base[c][id];
      this.onDocs(c, [srv], false);
      return;
    }
    const local = this.cols[c].get(this.app.state()).find((x) => x && String(x.id) === id);
    this.base[c][id] = { v: 0, h: b.h, w: "", err: true };
    this.saveBase();
    if (local) this.conflict(c, local, denied(e) ? "서버가 저장을 거부함(값 확인 필요)" : "저장 실패");
    if (!denied(e)) { this.error = e; this.status(); }
  }

  conflict(c, data, why) {
    let list = [];
    try { list = JSON.parse(this.storage.getItem(this.k("conflicts")) || "[]"); } catch (e) {}
    list.unshift({ col: c, id: String(data.id), data: clean(data), why, at: new Date().toISOString() });
    try { this.storage.setItem(this.k("conflicts"), JSON.stringify(list.slice(0, 50))); } catch (e) {}
    if (this.onConflict) this.onConflict(list.length);
  }
  conflicts() { try { return JSON.parse(this.storage.getItem(this.k("conflicts")) || "[]"); } catch (e) { return []; } }
  dropConflict(i) { const l = this.conflicts(); l.splice(i, 1); this.storage.setItem(this.k("conflicts"), JSON.stringify(l)); }

  counts() {
    const S = this.app.state(), out = {};
    for (const c of this.activeCols()) {
      const base = this.base[c] || {};
      out[c] = { here: this.cols[c].get(S).length, synced: Object.values(base).filter((b) => !b.d && !b.p && !b.err).length };
    }
    return out;
  }
}
