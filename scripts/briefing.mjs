// 매일 아침 GitHub Actions가 실행: 구글 뉴스(한국) 헤드라인을 받아 data/briefing.json 에 저장한다.
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../data/briefing.json", import.meta.url);
const FEEDS = {
  economy: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko",
  news: "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
};
const decode = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
};
async function headlines(url, count) {
  const res = await fetch(url, { headers: { "user-agent": "homeboard-briefing" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const xml = await res.text();
  return xml.split("<item>").slice(1, count + 1).map((b) => {
    const src = pick(b, "source");
    let t = pick(b, "title");
    if (src && t.endsWith(` - ${src}`)) t = t.slice(0, -(src.length + 3));
    return { t, src, url: pick(b, "link") };
  }).filter((x) => x.t && /^https?:\/\//.test(x.url));
}

let prev = { updatedAt: null, economy: [], news: [], week: [] };
try { prev = { ...prev, ...JSON.parse(await readFile(FILE, "utf8")) }; } catch {}

const next = { ...prev };
let ok = 0;
for (const [key, url] of Object.entries(FEEDS)) {
  try { const list = await headlines(url, 6); if (list.length) { next[key] = list; ok++; } }
  catch (e) { console.error("실패:", e.message); }
}
if (ok) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const date = kst.toISOString().slice(0, 10);
  next.updatedAt = new Date().toISOString();
  next.week = [...(prev.week || []).filter((g) => g.date !== date), { date, items: (next.economy || []).slice(0, 3) }]
    .sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-7);
  await writeFile(FILE, JSON.stringify(next, null, 1) + "\n");
  console.log(`갱신: 경제 ${next.economy.length}건, 뉴스 ${next.news.length}건`);
} else {
  console.log("받아온 헤드라인이 없어 기존 파일을 유지합니다.");
}
