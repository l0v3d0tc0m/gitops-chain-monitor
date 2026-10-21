// Generates fake history (site/data/demo-*.json) so the page looks alive locally
// and in screenshots. Open the page with ?demo to see it. Real data is never touched.
import { loadConfig, writeJson, dataPath, nowSec } from "./lib.mjs";

const STEP = 15 * 60;
const COUNT = 96 * 3; // three days
const now = nowSec();
const rand = (a, b) => a + Math.random() * (b - a);

const config = await loadConfig();

/* infra: mostly healthy, with one outage and one lagging node to show the states */
const groups = config.infra.map((g, gi) => ({
  name: g.name,
  type: g.type,
  symbol: g.symbol,
  targets: g.targets.map((t, ti) => {
    const base = 180 + gi * 25 + ti * 40;
    let block = 20_000_000 + gi * 1_000_000;
    const checks = [];
    for (let k = COUNT - 1; k >= 0; k--) {
      const t0 = now - k * STEP;
      block += 75;
      const ms = Math.round(base + Math.sin(k / 9) * 30 + rand(0, 60));
      const c = { t: t0, s: "up", ms, c: 200 };
      if (g.type !== "http") c.b = block;
      if (g.type === "evm") c.a = Math.round(rand(0, 8));
      if (g.gas) c.g = Math.round(rand(0.15, 3) * 100) / 100;

      if (g.name === "Polygon" && ti === 1 && k > 50 && k < 56) Object.assign(c, { s: "down", c: 0, ms: 10000, e: "timeout" });
      if (g.type === "solana" && ti === 1 && k < 3) Object.assign(c, { s: "slow", l: 410, b: block - 410, e: "410 behind" });
      if (Math.random() < 0.02) Object.assign(c, { s: "slow", ms: ms + 1700, e: "slow response" });
      checks.push(c);
    }
    return { name: t.name, host: new URL(t.url).host, checks };
  }),
}));
await writeJson(dataPath("demo-infra.json"), { updatedAt: new Date(now * 1000).toISOString(), groups });

/* markets: sample questions with random-walk odds */
const samples = [
  ["Will ETH reach a new all-time high this year?", 0.34],
  ["Will Bitcoin close the month above its 50-day average?", 0.58],
  ["Will the Fed cut rates at the next meeting?", 0.71],
  ["Will a spot SOL ETF be approved this quarter?", 0.22],
  ["Will average Ethereum gas stay under 5 gwei this week?", 0.83],
  ["Will Base process more transactions than Arbitrum this month?", 0.46],
  ["Will Bitcoin dominance stay above 55% until the end of the month?", 0.64],
  ["Will total stablecoin supply hit a new record this quarter?", 0.52],
  ["Will Solana have a network outage this month?", 0.09],
  ["Will an Ethereum L2 surpass $20B in total value locked this year?", 0.27],
  ["Will US inflation come in below 3% in the next CPI report?", 0.61],
  ["Will a top-10 crypto exchange halt withdrawals this year?", 0.14],
];
const markets = {};
const tracked = [];
samples.forEach(([question, start], i) => {
  let p = start;
  const points = [];
  for (let k = COUNT - 1; k >= 0; k--) {
    p = Math.min(0.97, Math.max(0.03, p + rand(-0.012, 0.012) + (i === 2 && k === 40 ? 0.12 : 0)));
    points.push([now - k * STEP, Math.round(p * 1000) / 1000]);
  }
  const id = `demo-${i}`;
  tracked.push(id);
  markets[id] = {
    question,
    event: "",
    outcome: "Yes",
    change24h: Math.round((points.at(-1)[1] - points.at(-97)[1]) * 1000) / 1000,
    volume24h: Math.round(rand(80_000, 2_500_000)),
    endDate: new Date((now + rand(5, 60) * 86400) * 1000).toISOString(),
    image: "",
    lastSeen: now,
    points,
  };
});
const movers = tracked
  .map((id) => ({ ...markets[id], price: markets[id].points.at(-1)[1] }))
  .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
  .slice(0, config.markets.movers)
  .map(({ question, event, price, change24h }) => ({ question, event, price, change24h }));

await writeJson(dataPath("demo-markets.json"), { updatedAt: new Date(now * 1000).toISOString(), tracked, movers, markets });
console.log("demo data written: site/data/demo-infra.json, site/data/demo-markets.json");
