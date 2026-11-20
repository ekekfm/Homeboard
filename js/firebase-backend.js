// Firebase 연결 (로그인 + Firestore). 빌드 없이 Google 공식 CDN에서 불러온다.
// 버전을 올릴 때는 아래 V 하나만 바꾸고, sw.js의 FIREBASE_V도 같이 바꾼다.
const V = "13.2.0";
const B = "https://www.gstatic.com/firebasejs/" + V + "/";

const COLS = ["tasks", "events", "biz", "leads", "logs", "notes", "links", "work", "timelog", "ideas", "settings", "allocs", "ledger", "accounts", "recurring", "budgets"];

export async function createBackend(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(B + "firebase-app.js"),
    import(B + "firebase-auth.js"),
    import(B + "firebase-firestore.js"),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = "ko";
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) {
    db = F.initializeFirestore(app, {}); // 기기 저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등): 메모리만 사용
  }

  const ref = (uid, col, id) => F.doc(db, "users", uid, col, id);
  const toDoc = (snap) => {
    const x = snap.data() || {};
    return { id: snap.id, data: x.data || {}, v: x.v | 0, wid: x.wid || "", deleted: !!x.deletedAt };
  };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no({ code: "timeout" }), ms))]);

  return {
    onAuth(cb) { return A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email || "", name: u.displayName || "" } : null)); },
    async signIn() {
      const p = new A.GoogleAuthProvider();
      p.setCustomParameters({ prompt: "select_account" });
      await A.signInWithPopup(auth, p);
    },
    signOut() { return A.signOut(auth); },

    listen(uid, col, onDocs, onErr) {
      return F.onSnapshot(F.collection(db, "users", uid, col), { includeMetadataChanges: true },
        (snap) => onDocs(snap.docChanges().filter((ch) => ch.type !== "removed").map((ch) => toDoc(ch.doc)), snap.metadata.fromCache),
        (e) => onErr && onErr(e));
    },
    write(uid, col, id, doc, isDelete) {
      const out = { v: doc.v, wid: doc.wid, dev: doc.dev, at: F.serverTimestamp() };
      if (isDelete) {
        out.deletedAt = F.serverTimestamp();
        return F.setDoc(ref(uid, col, id), out, { merge: true });   // 내용은 그대로 두고 휴지통 표시만
      }
      out.data = doc.data;
      out.deletedAt = null;
      return F.setDoc(ref(uid, col, id), out);
    },
    async getServer(uid, col, id) {
      const s = await F.getDocFromServer(ref(uid, col, id));
      return s.exists() ? toDoc(s) : null;
    },

    // 보안 점검: 막혀야 하는 요청이 실제로 막히는지 서버에 직접 확인한다. 아무 기록도 바꾸지 않는다.
    async securityCheck(uid) {
      const T = 12000, results = [];
      const expectDenied = async (name, fn) => {
        try { await withTimeout(fn(), T); results.push({ name, ok: false, detail: "막혀야 하는데 통과됨" }); }
        catch (e) {
          if (e && e.code === "timeout") results.push({ name, ok: null, detail: "응답 없음(인터넷 연결 확인)" });
          else if (/permission/i.test(String(e && (e.code || e.message)))) results.push({ name, ok: true, detail: "막힘" });
          else results.push({ name, ok: false, detail: "예상과 다른 오류: " + String(e && (e.code || e.message)) });
        }
      };
      const other = "zz-not-" + uid.slice(0, 6);
      await expectDenied("다른 사람 기록 읽기", () => F.getDocFromServer(F.doc(db, "users", other, "notes", "probe")));
      await expectDenied("다른 사람 기록 쓰기", () => F.setDoc(F.doc(db, "users", other, "notes", "probe"),
        { data: {}, v: 1, wid: "probe", dev: "probe", at: F.serverTimestamp(), deletedAt: null }));
      await expectDenied("가계부에 음수 금액 저장", () => F.setDoc(ref(uid, "ledger", "probe-bad"),
        { data: { amt: -5, type: "out", date: "2026-01-01" }, v: 1, wid: "probe", dev: "probe", at: F.serverTimestamp(), deletedAt: null }));
      await expectDenied("허용되지 않은 칸 추가", () => F.setDoc(ref(uid, "notes", "probe-extra"),
        { data: {}, v: 1, wid: "probe", dev: "probe", at: F.serverTimestamp(), deletedAt: null, admin: true }));
      await expectDenied("모르는 컬렉션에 저장", () => F.setDoc(ref(uid, "secret", "probe"),
        { data: {}, v: 1, wid: "probe", dev: "probe", at: F.serverTimestamp(), deletedAt: null }));
      // 같은 기록을 처음 만드는 요청(v=1)이 두 번 들어오면 두 번째는 막혀야 한다(중복 입력 방지)
      try {
        await withTimeout(F.setDoc(ref(uid, "probe", "dup"), { data: {}, v: 1, wid: "probe", dev: "probe", at: F.serverTimestamp(), deletedAt: null }), T);
      } catch (e) { /* 이미 있으면 거부되는 것이 정상 */ }
      await expectDenied("같은 기록 중복 생성", () => F.setDoc(ref(uid, "probe", "dup"),
        { data: {}, v: 1, wid: "probe2", dev: "probe", at: F.serverTimestamp(), deletedAt: null }));
      await expectDenied("기록 완전 삭제", () => F.deleteDoc(ref(uid, "probe", "dup")));
      return results;
    },
    collections: COLS,
  };
}
