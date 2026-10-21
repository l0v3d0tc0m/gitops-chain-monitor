// Snapshots Polymarket odds into site/data/markets.json. Read-only public API, no key needed.
//
// Tracks the busiest long-running markets (by 24h volume) and keeps a price history
// for each, so the page can draw how the odds moved over time.
import { loadConfig, readJson, writeJson, dataPath, nowSec, TIMEOUT_MS } from "./lib.mjs";

const FILE = dataPath("markets.json");
const API = "https://gamma-api.polymarket.com/markets";
const MAX_POINTS = 672;        // 7 days at one snapshot per 15 minutes
const FORGET_AFTER = 3 * 86400; // drop markets we have not seen for 3 days

const { markets: cfg } = await loadConfig();

const params = new URLSearchParams({
  active: "true",
  closed: "false",
  order: "volume24hr",
  ascending: "false",
  limit: "100",
});
const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
if (!res.ok) throw new Error(`Polymarket API: HTTP ${res.status}`);
const raw = await res.json();

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
};

const now = nowSec();
const all = raw
  .map((m) => {
    const outcomes = parse(m.outcomes);
    const prices = parse(m.outcomePrices).map(Number);
    return {
      id: m.id,
      question: m.question,
      event: m.events?.[0]?.slug || m.slug,
      outcome: outcomes[0] ?? "Yes",
      price: prices[0],
      change24h: m.oneDayPriceChange ?? 0,
      volume24h: Math.round(m.volume24hr ?? 0),
      endDate: m.endDate,
      image: m.icon || m.image,
      game: Boolean(m.gameStartTime || m.sportsMarketType),
    };
  })
  .filter((m) => Number.isFinite(m.price) && m.price > 0 && m.price < 1);

// Long-running and still undecided. Same-day markets (sports, "BTC above X today")
// swing 60pp just because they are resolving, and a 0.1% market says nothing.
const minEnd = now + cfg.minDaysToEnd * 86400;
const live = all
  .filter((m) => !m.game) // single matches resolve within hours
  .filter((m) => m.endDate && Date.parse(m.endDate) / 1000 > minEnd)
  .filter((m) => m.price >= 0.02 && m.price <= 0.98);

const top = live.slice(0, cfg.track);

const movers = live
  .filter((m) => m.volume24h >= cfg.moversMinVolume && m.change24h)
  .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
  .slice(0, cfg.movers);

// merge into history
const history = await readJson(FILE, { markets: {} });
const markets = history.markets;

for (const m of top) {
  const prev = markets[m.id];
  const points = [...(prev?.points ?? []), [now, m.price]].slice(-MAX_POINTS);
  const { id, price, game, ...meta } = m;
  markets[id] = { ...meta, lastSeen: now, points };
}
for (const [id, m] of Object.entries(markets)) {
  if (now - m.lastSeen > FORGET_AFTER) delete markets[id];
}

await writeJson(FILE, {
  updatedAt: new Date().toISOString(),
  tracked: top.map((m) => m.id),
  movers: movers.map(({ question, event, price, change24h }) => ({ question, event, price, change24h })),
  markets,
});

for (const m of top) console.log(`${(m.price * 100).toFixed(1).padStart(5)}%  ${m.question}`);
console.log(`movers: ${movers.map((m) => `${m.change24h > 0 ? "+" : ""}${Math.round(m.change24h * 100)}pp`).join(" ")}`);
