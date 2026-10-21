// Translates Polymarket questions into the site's languages and caches them in
// site/data/translations.json. Each question is translated once; later runs only
// handle new markets, so the free translation quota is plenty.
//
// Provider: MyMemory (https://mymemory.translated.net), free and keyless, ~5000 chars/day.
// Set MYMEMORY_EMAIL (e.g. as a GitHub secret) to raise the limit to ~50000 chars/day.
//
// Usage: node scripts/translate.mjs         -> real data
//        node scripts/translate.mjs demo    -> demo data (demo-markets.json)
import { loadConfig, readJson, writeJson, dataPath, nowSec } from "./lib.mjs";

const demo = process.argv[2] === "demo";
const MARKETS = dataPath(demo ? "demo-markets.json" : "markets.json");
const FILE = dataPath(demo ? "demo-translations.json" : "translations.json");

const { translate: cfg } = await loadConfig();
const email = process.env.MYMEMORY_EMAIL;

const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

class QuotaError extends Error {}

async function translate(text, target) {
  const params = new URLSearchParams({ q: text, langpair: `en|${target}` });
  if (email) params.set("de", email);
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => null);
  const out = body?.responseData?.translatedText;

  // when the quota runs out MyMemory still answers 200, with a warning instead of a translation
  if (body?.quotaFinished || res.status === 429 || /MYMEMORY WARNING/i.test(out ?? "")) throw new QuotaError("daily quota reached");
  if (!res.ok || Number(body?.responseStatus) !== 200 || !out) throw new Error(body?.responseDetails || `HTTP ${res.status}`);
  return decode(out).trim();
}

const markets = await readJson(MARKETS, null);
if (!markets) {
  console.log(`nothing to translate: ${MARKETS} not found`);
  process.exit(0);
}

const questions = [
  ...new Set([
    ...(markets.tracked ?? []).map((id) => markets.markets[id]?.question),
    ...(markets.movers ?? []).map((m) => m.question),
  ].filter(Boolean)),
];

const cache = await readJson(FILE, { items: {} });
const items = cache.items;
const now = nowSec();
let budget = cfg.maxCharsPerRun;
let done = 0, failed = 0;

outer: for (const q of questions) {
  const entry = (items[q] ??= {});
  entry.used = now;
  for (const [lang, target] of Object.entries(cfg.langs)) {
    if (entry[lang]) continue;
    if (budget < q.length) break outer;
    try {
      entry[lang] = await translate(q, target);
      budget -= q.length;
      done++;
    } catch (err) {
      if (err instanceof QuotaError) {
        console.log("stopping:", err.message);
        break outer;
      }
      failed++;
      console.log(`failed [${lang}] ${q}: ${err.message}`);
    }
  }
}

// forget questions that have not been on the page for a while
for (const [q, entry] of Object.entries(items)) {
  if (now - (entry.used ?? 0) > cfg.forgetAfterDays * 86400) delete items[q];
}

await writeJson(FILE, { updatedAt: new Date().toISOString(), items });

const langs = Object.keys(cfg.langs);
const missing = questions.filter((q) => langs.some((l) => !items[q]?.[l])).length;
console.log(`translated ${done} strings, ${failed} failed, ${missing} of ${questions.length} questions still incomplete`);
