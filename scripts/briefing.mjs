// 매일 세 번(아침·점심·저녁) GitHub Actions가 실행: 구글 뉴스(한국) 경제·증권·주요 헤드라인을 받아 data/briefing.json 에 저장한다.
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../data/briefing.json", import.meta.url);
const FEEDS = {
  economy: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko",
  // 증권: 최근 하루 안의 증시·주식 기사 검색
  stock: "https://news.google.com/rss/search?q=" + encodeURIComponent("코스피 OR 코스닥 OR 증시 OR 주가 when:1d") + "&hl=ko&gl=KR&ceid=KR:ko",
  news: "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
};
const PICK = 6;      // 시간대별로 보여줄 개수
const MIN_FRESH = 4; // 새 헤드라인이 부족하면 이 개수까지는 앞 시간대와 겹쳐도 채운다

const decode = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
};
async function headlines(url) {
  const res = await fetch(url, { headers: { "user-agent": "homeboard-briefing" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const xml = await res.text();
  return xml.split("<item>").slice(1, 41).map((b) => {
    const src = pick(b, "source");
    let t = pick(b, "title");
    if (src && t.endsWith(` - ${src}`)) t = t.slice(0, -(src.length + 3));
    const pub = new Date(pick(b, "pubDate"));
    return { t, src, url: pick(b, "link"), d: isNaN(pub) ? undefined : pub.toISOString() };
  }).filter((x) => x.t && /^https?:\/\//.test(x.url));
}

// 실행 시각(한국)으로 시간대를 정한다: 11시 전 아침(morning), 16시 전 점심(afternoon), 그 뒤 저녁(night).
// 새벽 5시 전에 손으로 실행하면 전날 저녁으로 친다. 키 이름은 예전 파일과 맞추려고 그대로 둔다.
function slotOf(now) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const hr = kst.getUTCHours();
  if (hr < 5) return { date: new Date(kst.getTime() - 86400000).toISOString().slice(0, 10), slot: "night" };
  return { date: kst.toISOString().slice(0, 10), slot: hr < 11 ? "morning" : hr < 16 ? "afternoon" : "night" };
}

// GitHub 예약 실행은 몇 시간씩 늦게 시작될 때가 있다. 그래서 예약 실행이면 "실제로 시작한 시각"이 아니라
// "어느 예약 시간(cron)으로 실행됐는지"로 시간대와 날짜를 정한다. (손으로 실행하면 지금 시각 기준)
const CRON_SLOT = { "7 22 * * *": "morning", "37 23 * * *": "morning", "7 3 * * *": "afternoon", "7 4 * * *": "afternoon", "7 9 * * *": "night", "7 10 * * *": "night" };
async function scheduledCron() {
  if (process.env.BRIEFING_CRON) return process.env.BRIEFING_CRON;
  if (process.env.GITHUB_EVENT_NAME !== "schedule" || !process.env.GITHUB_EVENT_PATH) return "";
  try { return JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")).schedule || ""; } catch { return ""; }
}
function slotOfCron(cron, now) {
  const p = cron.trim().split(/\s+/), mm = +p[0], hh = +p[1];
  if (!CRON_SLOT[cron.trim()] || isNaN(mm) || isNaN(hh)) return null;
  // 지금보다 앞선 가장 가까운 예약 시각(UTC)을 찾고, 그 시각의 한국 날짜를 쓴다
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm);
  if (t > now.getTime()) t -= 86400000;
  return { date: new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10), slot: CRON_SLOT[cron.trim()], late: Math.round((now.getTime() - t) / 60000) };
}

const now = process.env.BRIEFING_NOW ? new Date(process.env.BRIEFING_NOW) : new Date();
const cron = await scheduledCron();
const byCron = cron ? slotOfCron(cron, now) : null;
const { date, slot } = byCron || slotOf(now);
console.log(byCron ? `예약(${cron}) 실행 → ${date} ${slot} (예약보다 ${byCron.late}분 늦게 시작)` : `수동/시각 기준 실행 → ${date} ${slot}`);

let prev = {};
try { prev = JSON.parse(await readFile(FILE, "utf8")); } catch {}
// 아주 늦게 도착한 예약 실행이 이미 넘어간 다음 날 파일을 덮어쓰지 않게 한다
if (prev.date && date < prev.date) {
  console.log(`${date} ${slot}: 이미 ${prev.date} 뉴스가 있어 늦게 도착한 이번 실행은 건너뜁니다.`);
  process.exit(0);
}
const slots = prev.date === date && prev.slots ? { ...prev.slots } : {};

// 예약 실행이 빠질 때를 대비해 시간대마다 예비 실행이 한 번 더 온다.
// 그 시간대 뉴스가 이미 있으면 예비 실행은 아무것도 하지 않는다 (수동 실행은 항상 새로 받는다).
if (process.env.GITHUB_EVENT_NAME === "schedule" && slots[slot]) {
  console.log(`${date} ${slot}: 이미 갱신된 시간대라 이번 예비 실행은 건너뜁니다.`);
  process.exit(0);
}

// 같은 날 다른 시간대에 이미 나온 헤드라인은 빼서, 시간대마다 새 소식이 보이게 한다
const seen = new Set();
for (const [k, v] of Object.entries(slots)) {
  if (k === slot || !v) continue;
  for (const x of [...(v.economy || []), ...(v.stock || []), ...(v.news || [])]) seen.add(x.t);
}
const fresh = (list) => {
  const out = list.filter((x) => !seen.has(x.t)).slice(0, PICK);
  for (const x of list) { if (out.length >= MIN_FRESH) break; if (!out.includes(x)) out.push(x); }
  out.forEach((x) => seen.add(x.t));
  return out;
};

const entry = { at: now.toISOString() };
let ok = 0;
for (const [key, url] of Object.entries(FEEDS)) {
  try {
    const list = await headlines(url);
    if (list.length) { entry[key] = fresh(list); ok++; }
  } catch (e) { console.error("실패:", key, e.message); }
}
if (!ok) {
  console.log("받아온 헤드라인이 없어 기존 파일을 유지합니다.");
  process.exit(0);
}
entry.economy ||= slots[slot]?.economy || [];
entry.stock ||= slots[slot]?.stock || [];
entry.news ||= slots[slot]?.news || [];
slots[slot] = entry;

const first = slots.morning || slots.afternoon || slots.night;
const week = [...(prev.week || []).filter((g) => g.date !== date), { date, items: (first.economy || []).slice(0, 3) }]
  .sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-7);

// economy/news 는 예전 버전 앱도 읽을 수 있게 최신 시간대를 그대로 둔다
const next = { date, slot, updatedAt: entry.at, slots, economy: entry.economy, news: entry.news, week };
await writeFile(FILE, JSON.stringify(next, null, 1) + "\n");
console.log(`${date} ${slot}: 경제 ${entry.economy.length}건, 증권 ${entry.stock.length}건, 뉴스 ${entry.news.length}건`);
