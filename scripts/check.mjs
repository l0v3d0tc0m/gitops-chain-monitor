// Checks every site from sites.json and appends the result to site/data/history.json.
// No dependencies: needs Node 18+ (built-in fetch).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITES_FILE = join(root, "sites.json");
const HISTORY_FILE = join(root, "site", "data", "history.json");

const TIMEOUT_MS = 10_000;
const MAX_CHECKS = 1440; // ~15 days at one check per 15 minutes

async function checkSite({ url }) {
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "status-page-bot/1.0 (+https://github.com)" },
    });
    await res.body?.cancel(); // we only need the status, not the body
    const ms = Math.round(performance.now() - started);
    return { ok: res.status < 400, code: res.status, ms };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const reason = err.name === "TimeoutError" ? "timeout" : err.cause?.code || err.message;
    return { ok: false, code: 0, ms, error: reason };
  }
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf8"));
  } catch {
    return { updatedAt: null, sites: {} };
  }
}

const sites = JSON.parse(await readFile(SITES_FILE, "utf8"));
const history = await loadHistory();
const now = new Date().toISOString();

const results = await Promise.all(sites.map(checkSite));

const next = {};
sites.forEach((site, i) => {
  const prev = history.sites[site.name]?.checks ?? [];
  const check = { t: now, ...results[i] };
  next[site.name] = { url: site.url, checks: [...prev, check].slice(-MAX_CHECKS) };

  const mark = check.ok ? "UP  " : "DOWN";
  console.log(`${mark} ${site.name.padEnd(16)} ${String(check.code).padStart(3)} ${check.ms}ms${check.error ? "  " + check.error : ""}`);
});

await mkdir(dirname(HISTORY_FILE), { recursive: true });
await writeFile(HISTORY_FILE, JSON.stringify({ updatedAt: now, sites: next }) + "\n");
