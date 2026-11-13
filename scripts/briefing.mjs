// 하루 세 번(아침·오후·밤) GitHub Actions가 실행: 구글 뉴스(한국) 헤드라인을 받아 data/briefing.json 에 시간대별로 저장한다.
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

// 한국 시간 기준 시간대: 05~11시 아침, 11~17시 오후, 17~05시 밤 (자정 넘어 실행되면 전날 밤으로 본다)
function slotOf(now) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const hour = kst.getUTCHours();
  if (hour < 5) return { date: new Date(kst.getTime() - 86400000).toISOString().slice(0, 10), slot: "night" };
  return { date: kst.toISOString().slice(0, 10), slot: hour < 11 ? "morning" : hour < 17 ? "afternoon" : "night" };
}

const now = process.env.BRIEFING_NOW ? new Date(process.env.BRIEFING_NOW) : new Date();
const { date, slot } = slotOf(now);

let prev = {};
try { prev = JSON.parse(await readFile(FILE, "utf8")); } catch {}
const slots = prev.date === date && prev.slots ? { ...prev.slots } : {};

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
