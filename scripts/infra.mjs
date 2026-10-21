// Checks crypto infrastructure from config.json and appends results to site/data/infra.json.
//
// A check is stored compactly to keep the file small:
//   t  - unix time (seconds)
//   s  - state: "up" | "slow" | "down"
//   ms - response time
//   c  - HTTP status (0 = no response)
//   b  - block height (EVM) or slot (Solana)
//   a  - age of the latest block, seconds (EVM)
//   l  - how far behind the best provider of the same network (blocks/slots)
//   g  - gas price, gwei (Ethereum)
//   e  - error or reason for a degraded state
import { loadConfig, readJson, writeJson, dataPath, rpc, errorText, nowSec, TIMEOUT_MS, SLOW_MS } from "./lib.mjs";

const FILE = dataPath("infra.json");
const MAX_CHECKS = 672; // 7 days at one check per 15 minutes

async function checkHttp(target) {
  const started = performance.now();
  const res = await fetch(target.url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "crypto-status-bot/1.0" },
  });
  await res.body?.cancel();
  const ms = Math.round(performance.now() - started);
  return { ms, c: res.status, ok: res.status < 400, e: res.status < 400 ? undefined : `HTTP ${res.status}` };
}

async function checkEvm(target, group) {
  const block = await rpc(target.url, "eth_getBlockByNumber", ["latest", false]);
  const out = {
    ms: block.ms,
    c: block.code,
    ok: true,
    b: parseInt(block.result.number, 16),
    a: Math.max(0, nowSec() - parseInt(block.result.timestamp, 16)),
  };
  if (group.gas) {
    const gas = await rpc(target.url, "eth_gasPrice").catch(() => null);
    if (gas) out.g = Math.round((parseInt(gas.result, 16) / 1e9) * 100) / 100;
  }
  return out;
}

async function checkSolana(target) {
  const slot = await rpc(target.url, "getSlot", [{ commitment: "confirmed" }]);
  return { ms: slot.ms, c: slot.code, ok: true, b: slot.result };
}

const checkers = { http: checkHttp, evm: checkEvm, solana: checkSolana };

async function runTarget(target, group) {
  try {
    return await checkers[group.type](target, group);
  } catch (err) {
    return { ok: false, ms: err.ms ?? TIMEOUT_MS, c: err.code ?? 0, e: errorText(err) };
  }
}

// Turns raw results of one network into states. A node that answers 200
// but serves an old block is not healthy, so freshness matters as much as status.
function judge(group, results, prevChecks) {
  const best = Math.max(0, ...results.filter((r) => r.ok && r.b).map((r) => r.b));

  return results.map((r, i) => {
    const check = { t: nowSec(), ms: r.ms, c: r.c };
    if (r.b !== undefined) check.b = r.b;
    if (r.a !== undefined) check.a = r.a;
    if (r.g !== undefined) check.g = r.g;

    if (!r.ok) return { ...check, s: "down", e: r.e };

    const reasons = [];
    if (r.b !== undefined && best) {
      check.l = best - r.b;
      if (group.maxLag && check.l > group.maxLag) reasons.push(`${check.l} behind`);
    }
    if (group.maxBlockAge && r.a > group.maxBlockAge) reasons.push(`block ${r.a}s old`);

    const prev = prevChecks[i]?.at(-1);
    if (group.type === "solana" && prev?.b && r.b <= prev.b) reasons.push("slot not advancing");

    if (r.ms > SLOW_MS) reasons.push("slow response");
    return reasons.length ? { ...check, s: "slow", e: reasons.join(", ") } : { ...check, s: "up" };
  });
}

const config = await loadConfig();
const history = await readJson(FILE, { groups: [] });
const old = new Map(history.groups.flatMap((g) => g.targets.map((t) => [`${g.name}/${t.name}`, t.checks])));

const groups = await Promise.all(
  config.infra.map(async (group) => {
    const results = await Promise.all(group.targets.map((t) => runTarget(t, group)));
    const prevChecks = group.targets.map((t) => old.get(`${group.name}/${t.name}`) ?? []);
    const checks = judge(group, results, prevChecks);

    return {
      name: group.name,
      type: group.type,
      symbol: group.symbol,
      targets: group.targets.map((t, i) => ({
        name: t.name,
        host: new URL(t.url).host,
        checks: [...prevChecks[i], checks[i]].slice(-MAX_CHECKS),
      })),
    };
  })
);

for (const g of groups) {
  for (const t of g.targets) {
    const c = t.checks.at(-1);
    const extra = [c.b && `#${c.b}`, c.a !== undefined && `age ${c.a}s`, c.l && `lag ${c.l}`, c.g && `${c.g} gwei`, c.e]
      .filter(Boolean)
      .join("  ");
    console.log(`${c.s.toUpperCase().padEnd(4)} ${(g.name + " / " + t.name).padEnd(34)} ${String(c.ms).padStart(5)}ms  ${extra}`);
  }
}

await writeJson(FILE, { updatedAt: new Date().toISOString(), groups });
