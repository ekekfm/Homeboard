// 시험용 가짜 Firestore: 서버 1개 + 기기(클라이언트) 여러 개.
// firestore.rules의 핵심 규칙(새 기록 v=1, 고칠 때 v+1, 완전 삭제 금지, 가계부 금액 검사)을 같은 뜻으로 흉내 낸다.
// 기기는 오프라인일 때 쓰기를 쌓아 두었다가 연결되면 순서대로 보내고, 거부되면 서버 내용으로 되돌린다.

const denied = () => Object.assign(new Error("permission-denied"), { code: "permission-denied" });
const copy = (x) => JSON.parse(JSON.stringify(x));

export class FakeServer {
  constructor() { this.docs = new Map(); this.clients = new Set(); this.writes = 0; this.denyCols = new Set(); }
  key(uid, col, id) { return uid + "/" + col + "/" + id; }
  apply(uid, col, id, doc, isDelete) {
    if (this.denyCols.has(col)) throw denied();
    const k = this.key(uid, col, id), cur = this.docs.get(k);
    if (isDelete) {
      if (!cur || doc.v !== cur.v + 1) throw denied();
      const next = Object.assign({}, cur, { v: doc.v, wid: doc.wid, deleted: true });
      this.docs.set(k, next);
    } else {
      if (cur ? doc.v !== cur.v + 1 : doc.v !== 1) throw denied();
      if (col === "ledger") {
        const x = doc.data;
        if (!Number.isInteger(x.amt) || x.amt <= 0 || !["in", "out"].includes(x.type) || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.date))) throw denied();
      }
      this.docs.set(k, { data: copy(doc.data), v: doc.v, wid: doc.wid, deleted: false });
    }
    this.writes++;
    const out = Object.assign({ id }, copy(this.docs.get(k)));
    for (const c of this.clients) c.serverChanged(uid, col, out);
  }
  get(uid, col, id) { const d = this.docs.get(this.key(uid, col, id)); return d ? Object.assign({ id }, copy(d)) : null; }
  all(uid, col) {
    const out = [];
    for (const [k, d] of this.docs) { const [u, c, id] = k.split("/"); if (u === uid && c === col) out.push(Object.assign({ id }, copy(d))); }
    return out;
  }
}

export class FakeClient {
  constructor(server) { this.server = server; this.online = true; this.queue = []; this.cache = new Map(); this.subs = []; server.clients.add(this); }
  emit(uid, col, docs, fromCache) {
    for (const s of this.subs) if (s.uid === uid && s.col === col) s.cb(docs.map(copy), fromCache);
  }
  serverChanged(uid, col, doc) {
    if (!this.online) return;
    this.cache.set(uid + "/" + col + "/" + doc.id, doc);
    // 내가 보내 아직 확인 안 된 쓰기가 있으면 Firestore처럼 내 쪽 내용을 보여 준다
    if (this.queue.some((q) => q.uid === uid && q.col === col && q.id === doc.id)) return;
    this.emit(uid, col, [doc], false);
  }
  listen(uid, col, cb, err) {
    if (this.server.denyCols.has(col)) { setTimeout(() => err && err(denied()), 5); return () => {}; }
    const sub = { uid, col, cb };
    this.subs.push(sub);
    setTimeout(() => {
      const cached = [...this.cache.entries()].filter(([k]) => k.startsWith(uid + "/" + col + "/")).map(([, d]) => d);
      cb(cached.map(copy), true);
      if (this.online) {
        const docs = this.server.all(uid, col);
        for (const d of docs) this.cache.set(uid + "/" + col + "/" + d.id, d);
        cb(docs.map(copy), false);
      }
    }, 5);
    return () => { this.subs = this.subs.filter((s) => s !== sub); };
  }
  write(uid, col, id, doc, isDelete) {
    return new Promise((resolve, reject) => {
      const k = uid + "/" + col + "/" + id, prev = this.cache.get(k);
      const local = isDelete ? Object.assign({}, prev, { id, v: doc.v, wid: doc.wid, deleted: true })
        : { id, data: copy(doc.data), v: doc.v, wid: doc.wid, deleted: false };
      this.cache.set(k, local);
      this.queue.push({ uid, col, id, doc: copy(doc), isDelete, resolve, reject });
      setTimeout(() => this.emit(uid, col, [local], true), 1);
      if (this.online) setTimeout(() => this.flush(), 10);
    });
  }
  flush() {
    while (this.online && this.queue.length) {
      const q = this.queue.shift();
      try { this.server.apply(q.uid, q.col, q.id, q.doc, q.isDelete); q.resolve(); }
      catch (e) {
        const srv = this.server.get(q.uid, q.col, q.id), k = q.uid + "/" + q.col + "/" + q.id;
        if (srv) { this.cache.set(k, srv); this.emit(q.uid, q.col, [srv], false); } else this.cache.delete(k);
        q.reject(e);
      }
    }
  }
  async getServer(uid, col, id) {
    if (!this.online) throw Object.assign(new Error("unavailable"), { code: "unavailable" });
    return this.server.get(uid, col, id);
  }
  goOffline() { this.online = false; }
  goOnline() {
    this.online = true;
    for (const s of this.subs) {
      const docs = this.server.all(s.uid, s.col).filter((d) => !this.queue.some((q) => q.uid === s.uid && q.col === s.col && q.id === d.id));
      for (const d of docs) this.cache.set(s.uid + "/" + s.col + "/" + d.id, d);
      s.cb(docs.map(copy), false);
    }
    this.flush();
  }
}

export class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
