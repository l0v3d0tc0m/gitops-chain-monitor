// Generates fake history in site/data/demo.json, so the page looks alive locally.
// Open the page with ?demo to see it. Real data lives in history.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sites = JSON.parse(await readFile(join(root, "sites.json"), "utf8"));
const out = join(root, "site", "data", "demo.json");

const STEP = 15 * 60 * 1000;
const COUNT = 96 * 3; // three days
const now = Date.now();

const data = { updatedAt: new Date(now).toISOString(), sites: {} };
sites.forEach((site, i) => {
  const base = 150 + i * 60;
  const checks = [];
  for (let k = COUNT - 1; k >= 0; k--) {
    const t = new Date(now - k * STEP).toISOString();
    const outage = i === 1 && k > 40 && k < 44; // a short incident for one service
    const spike = Math.random() < 0.03;
    const ms = Math.round(base + Math.sin(k / 10) * 40 + Math.random() * 60 + (spike ? 1600 : 0));
    checks.push(outage ? { t, ok: false, code: 503, ms: 120 } : { t, ok: true, code: 200, ms });
  }
  data.sites[site.name] = { url: site.url, checks };
});

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(data) + "\n");
console.log("demo data written to", out);
