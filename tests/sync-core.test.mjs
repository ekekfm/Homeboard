// 실행: node tests/sync-core.test.mjs
import assert from "node:assert/strict";
import { SyncCore } from "../js/sync-core.js";
import { FakeServer, FakeClient, MemStorage } from "./fake-firestore.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(700);
const UID = "u1";

function device(server, S, opts = {}) {
  const client = new FakeClient(server);
  const storage = opts.storage || new MemStorage();
  let ledger = !!opts.ledger;
  const dev = {
    S, client, storage, commits: 0, conflicts: 0,
    setLedger(v) { ledger = v; dev.core.refreshCols(); },
  };
  const app = { state: () => dev.S, commit: () => { dev.commits++; } };
  dev.core = new SyncCore({
    uid: UID, dev: opts.name || "d", storage, app, ledgerOn: () => ledger,
    backend: { listen: (u, c, cb, err) => client.listen(u, c, cb, err), write: (...a) => client.write(...a), getServer: (...a) => client.getServer(...a) },
    onConflict: () => { dev.conflicts++; },
  });
  dev.save = () => dev.core.changed();   // 화면의 save()와 같은 역할
  return dev;
}
const blank = () => ({ tasks: [], events: [], biz: [], leads: [], logs: [], notes: [], links: [], config: { region: "서울" }, money: {}, allocs: [] });
const titles = (d) => d.S.tasks.map((t) => t.title).sort();

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("통과:", name); }

const server = new FakeServer();

// 기기 A: 기존 기록이 있는 PC
const A = blank();
A.tasks = [{ id: "t1", title: "세금 신고" }, { id: "t2", title: "홈페이지 점검" }];
A.links = [{ id: "a0", name: "카카오톡", ord: 0 }];
A.money = { "2026-11": { m1: { type: "out", amt: 12000.4, cat: "식비", memo: "점심", date: "2026-11-20" }, m2: { type: "out", amt: -5, cat: "기타", memo: "잘못된 값", date: "2026-11-20" } } };
const a = device(server, A, { name: "A" });

// 기기 B: 다른 기록이 있는 폰
const B = blank();
B.tasks = [{ id: "t3", title: "보험 갱신" }];
B.links = [{ id: "a0", name: "카카오톡", ord: 3 }];
const b = device(server, B, { name: "B" });

await test("첫 기기: 기존 기록을 계정에 올린다(가계부는 꺼 둔 동안 올리지 않음)", async () => {
  a.core.start(); await settle();
  assert.equal(server.all(UID, "tasks").length, 2);
  assert.equal(server.all(UID, "ledger").length, 0);
  assert.equal(server.all(UID, "settings").length, 1);
});

await test("두 번째 기기: 계정 기록과 이 기기 기록을 합친다", async () => {
  b.core.start(); await settle(); await settle();
  assert.deepEqual(titles(b), ["보험 갱신", "세금 신고", "홈페이지 점검"]);
  assert.deepEqual(titles(a), ["보험 갱신", "세금 신고", "홈페이지 점검"]);
  assert.equal(b.S.links.length, 1, "바로가기는 같은 id끼리 하나로");
  assert.equal(b.S.links[0].ord, 0, "바로가기는 계정 쪽을 따름");
});

await test("한 기기에서 고치면 다른 기기에 반영된다", async () => {
  a.S.tasks.find((t) => t.id === "t1").title = "세금 신고(11월)"; a.save(); await settle();
  assert.equal(b.S.tasks.find((t) => t.id === "t1").title, "세금 신고(11월)");
  assert.equal(server.get(UID, "tasks", "t1").v, 2);
});

await test("지우면 다른 기기에서도 사라지고 서버에는 휴지통 표시만 남는다", async () => {
  b.S.tasks = b.S.tasks.filter((t) => t.id !== "t2"); b.save(); await settle();
  assert.ok(!a.S.tasks.some((t) => t.id === "t2"));
  assert.equal(server.get(UID, "tasks", "t2").deleted, true);
});

await test("두 기기가 동시에 같은 기록을 고치면 먼저 도착한 쪽이 남고, 다른 쪽은 충돌 기록에 남는다", async () => {
  a.client.goOffline();
  a.S.tasks.find((t) => t.id === "t3").title = "보험 갱신(A)"; a.save();
  await sleep(500);
  b.S.tasks.find((t) => t.id === "t3").title = "보험 갱신(B)"; b.save();
  await settle();
  a.client.goOnline(); await settle(); await settle();
  assert.equal(server.get(UID, "tasks", "t3").data.title, "보험 갱신(B)");
  assert.equal(a.S.tasks.find((t) => t.id === "t3").title, "보험 갱신(B)");
  assert.equal(b.S.tasks.find((t) => t.id === "t3").title, "보험 갱신(B)");
  const cf = a.core.conflicts();
  assert.equal(cf.length, 1);
  assert.equal(cf[0].data.title, "보험 갱신(A)");
});

await test("오프라인에서 새로 쓴 기록은 연결되면 올라간다(누락·중복 없음)", async () => {
  b.client.goOffline();
  b.S.tasks.push({ id: "t4", title: "오프라인 1" }, { id: "t5", title: "오프라인 2" }, { id: "t6", title: "오프라인 3" });
  b.save(); await settle();
  assert.equal(server.all(UID, "tasks").filter((d) => !d.deleted).length, 2);
  b.client.goOnline(); await settle(); await settle();
  assert.equal(server.all(UID, "tasks").filter((d) => !d.deleted).length, 5);
  assert.equal(a.S.tasks.length, 5);
  assert.equal(new Set(a.S.tasks.map((t) => t.id)).size, 5);
});

await test("가계부 동기화를 켜면 올라가고, 금액이 잘못된 기록은 서버가 거부해 충돌 기록에 남는다", async () => {
  a.setLedger(true); await settle(); await settle();
  const led = server.all(UID, "ledger");
  assert.equal(led.length, 1, "음수 금액은 거부");
  assert.equal(led[0].data.amt, 12000, "금액은 원 단위 정수");
  assert.ok(a.core.conflicts().some((x) => x.col === "ledger" && /거부/.test(x.why)));
  const before = server.writes;
  a.save(); await settle();
  assert.equal(server.writes, before, "거부된 기록을 계속 다시 보내지 않음");
});

await test("가계부를 켜지 않은 기기에는 가계부가 내려오지 않는다", async () => {
  assert.deepEqual(Object.keys(b.S.money), []);
});

await test("앱을 다시 열어도(새로고침) 바뀐 것이 없으면 아무것도 보내지 않는다", async () => {
  a.core.stop();
  const before = server.writes;
  const a2 = device(server, a.S, { name: "A", storage: a.storage, ledger: true });
  a2.core.start(); await settle(); await settle();
  assert.equal(server.writes, before);
  a2.core.stop();
});

b.core.stop();
console.log("\n모든 시험 통과:", passed + "개");
process.exit(0);
