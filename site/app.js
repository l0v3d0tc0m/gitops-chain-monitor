// chainpulse frontend: renders site/data/infra.json and site/data/markets.json.
// Add ?demo to the URL to load generated demo data instead.
const BARS = 60;
const DAY = 86400;

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has("demo");
const file = (name) => `data/${demo ? "demo-" : ""}${name}.json`;

// API text goes into innerHTML, so it must be escaped
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pct = (n) => (n >= 99.995 ? "100%" : n.toFixed(2) + "%");
const odds = (p) => {
  const v = p * 100;
  return (v < 1 || v > 99 ? v.toFixed(1) : Math.round(v)) + "%";
};
const usd = (n) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const fmtTime = (sec) =>
  new Date(sec * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function deltaChip(change) {
  const pp = Math.round(change * 100);
  const cls = pp > 0 ? "pos" : pp < 0 ? "neg" : "flat";
  return `<span class="delta ${cls}">${pp > 0 ? "+" : ""}${pp}pp</span>`;
}

/* ---------------- infrastructure ---------------- */

function targetStats(checks) {
  const now = Date.now() / 1000;
  const up = checks.filter((c) => c.s !== "down").length;
  const day = checks.filter((c) => now - c.t < DAY && c.s !== "down");
  const avg = day.length ? Math.round(day.reduce((s, c) => s + c.ms, 0) / day.length) : null;
  return { uptime: checks.length ? (up / checks.length) * 100 : 0, avg, last: checks.at(-1) };
}

// A network is down only when every provider is down: that is what users feel.
function groupState(group) {
  const states = group.targets.map((t) => t.checks.at(-1)?.s ?? "down");
  if (states.every((s) => s === "down")) return "down";
  if (states.some((s) => s !== "up")) return "slow";
  return "up";
}

function barTip(c) {
  const parts = [fmtTime(c.t), c.s.toUpperCase(), `${c.ms}ms`];
  if (c.b) parts.push(`#${c.b.toLocaleString("en")}`);
  if (c.l) parts.push(`lag ${c.l}`);
  if (c.e) parts.push(c.e);
  return parts.join(" · ");
}

function targetHtml(t) {
  const s = targetStats(t.checks);
  const recent = t.checks.slice(-BARS);
  const bars = Array(BARS - recent.length)
    .fill(`<span class="bar empty"></span>`)
    .concat(recent.map((c) => `<span class="bar ${c.s}" data-tip="${esc(barTip(c))}"></span>`))
    .join("");
  const note = s.last && s.last.s !== "up" && s.last.e
    ? `<span class="svc-note ${s.last.s}">${esc(s.last.e)}</span>` : "";

  return `<div class="svc">
    <div class="svc-head">
      <div class="svc-name"><span class="dot ${s.last?.s}"></span>${esc(t.name)}
        <span class="host">${esc(t.host)}</span>${note}</div>
      <div class="svc-stats">
        <span>uptime <b>${pct(s.uptime)}</b></span>
        <span>avg 24h <b>${s.avg ?? "–"}${s.avg ? "ms" : ""}</b></span>
      </div>
    </div>
    <div class="bars">${bars}</div>
    <div class="bars-legend"><span>${recent.length ? fmtTime(recent[0].t) : ""}</span><span>now</span></div>
  </div>`;
}

function groupHtml(g) {
  const lasts = g.targets.map((t) => t.checks.at(-1)).filter((c) => c && c.s !== "down");
  const meta = [];
  const head = lasts.reduce((best, c) => (c.b > (best?.b ?? 0) ? c : best), null);
  if (head?.b) meta.push(`${g.type === "solana" ? "slot" : "block"} <b>#${head.b.toLocaleString("en")}</b>`);
  if (head?.a !== undefined) meta.push(`<b>${head.a}s</b> ago`);
  const gas = lasts.find((c) => c.g !== undefined)?.g;
  if (gas !== undefined) meta.push(`gas <b>${gas}</b> gwei`);

  return `<article class="card group">
    <div class="group-head">
      <div class="group-name"><span class="dot ${groupState(g)}"></span>${esc(g.name)}
        ${g.symbol ? `<span class="chip">${esc(g.symbol)}</span>` : ""}</div>
      <div class="group-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>
    </div>
    ${g.targets.map(targetHtml).join("")}
  </article>`;
}

function renderInfra(data) {
  const groups = data.groups ?? [];
  if (!groups.length) {
    $("groups").innerHTML = `<div class="card empty-state">No checks yet. Run <code>npm run infra</code>.</div>`;
    return;
  }

  const states = groups.map((g) => [g.name, groupState(g)]);
  const down = states.filter(([, s]) => s === "down").map(([n]) => n);
  const slow = states.filter(([, s]) => s === "slow").map(([n]) => n);
  const banner = $("banner");
  if (down.length) {
    banner.dataset.state = "down";
    $("banner-text").textContent = `Outage: ${down.join(", ")}`;
  } else if (slow.length) {
    banner.dataset.state = "slow";
    $("banner-text").textContent = `Degraded: ${slow.join(", ")}`;
  } else {
    banner.dataset.state = "up";
    $("banner-text").textContent = "All networks operational";
  }

  const healthy = states.filter(([, s]) => s === "up").length;
  const rpcChecks = groups.filter((g) => g.type !== "http").flatMap((g) => g.targets.flatMap((t) => t.checks));
  const rpcAvg = targetStats(rpcChecks).avg;
  const eth = groups.find((g) => g.targets.some((t) => t.checks.at(-1)?.g !== undefined));
  const gas = eth?.targets.map((t) => t.checks.at(-1)).find((c) => c?.g !== undefined)?.g;

  $("summary").innerHTML = [
    ["Healthy", `${healthy}<small> / ${groups.length}</small>`],
    ["RPC avg 24h", rpcAvg ? `${rpcAvg}<small>ms</small>` : "–"],
    ["ETH gas", gas !== undefined ? `${gas}<small> gwei</small>` : "–"],
  ]
    .map(([k, v]) => `<div class="tile"><div class="tile-label">${k}</div><div class="tile-value">${v}</div></div>`)
    .join("");

  $("groups").innerHTML = groups.map(groupHtml).join("");
}

/* ---------------- markets ---------------- */

function chart(points, change) {
  if (points.length < 2) return "";
  const w = 300, h = 56, pad = 4;
  const ys = points.map((p) => p[1]);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 0.02) { // keep tiny wiggles from looking dramatic
    const mid = (max + min) / 2;
    min = mid - 0.01;
    max = mid + 0.01;
  }
  const t0 = points[0][0], t1 = points.at(-1)[0];
  const xy = points.map(([t, p]) => [((t - t0) / (t1 - t0 || 1)) * w, pad + (1 - (p - min) / (max - min)) * (h - pad * 2)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const dir = ys.at(-1) > ys[0] ? "pos" : ys.at(-1) < ys[0] ? "neg" : change > 0 ? "pos" : change < 0 ? "neg" : "flat";
  return `<svg class="chart ${dir}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Odds history">
    <path class="area" d="${line}L${w},${h}L0,${h}Z"/>
    <path class="line" d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
}

const marketUrl = (event) => (event ? `https://polymarket.com/event/${encodeURIComponent(event)}` : "https://polymarket.com");

function daysLeft(iso) {
  const d = Math.round((Date.parse(iso) - Date.now()) / 86400000);
  return d <= 0 ? "ends today" : d === 1 ? "ends in 1 day" : `ends in ${d} days`;
}

function marketHtml(m) {
  const price = m.points.at(-1)[1];
  const outcome = m.outcome && m.outcome !== "Yes" ? `<span class="market-outcome">${esc(m.outcome)}</span>` : `<span class="market-outcome">chance</span>`;
  const history = m.points.length >= 2
    ? chart(m.points, m.change24h)
    : `<div class="market-empty">collecting history · ${m.points.length} snapshot</div>`;
  const img = m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : "";

  return `<a class="card market" href="${marketUrl(m.event)}" target="_blank" rel="noopener">
    <div class="market-head">${img}<div class="market-q">${esc(m.question)}</div></div>
    <div class="market-row"><span class="market-price">${odds(price)}</span>${outcome}${deltaChip(m.change24h)}</div>
    ${history}
    <div class="market-foot"><span>vol 24h ${usd(m.volume24h)}</span><span>${m.endDate ? daysLeft(m.endDate) : ""}</span></div>
  </a>`;
}

function renderMarkets(data) {
  const tracked = (data.tracked ?? []).map((id) => data.markets[id]).filter(Boolean);
  $("markets").innerHTML = tracked.length
    ? tracked.map(marketHtml).join("")
    : `<div class="card empty-state">No snapshots yet. Run <code>npm run markets</code>.</div>`;

  $("movers").innerHTML = (data.movers ?? [])
    .map((m) => `<a class="mover" href="${marketUrl(m.event)}" target="_blank" rel="noopener">
      <span class="q">${esc(m.question)}</span><span class="price">${odds(m.price)}</span>${deltaChip(m.change24h)}</a>`)
    .join("") || `<div class="empty-state">No big moves right now.</div>`;
}

/* ---------------- app ---------------- */

async function getJson(name) {
  const res = await fetch(`${file(name)}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  const [infra, markets] = await Promise.allSettled([getJson("infra"), getJson("markets")]);

  if (infra.status === "fulfilled") renderInfra(infra.value);
  else {
    $("banner").dataset.state = "down";
    $("banner-text").textContent = "Could not load status data";
  }
  if (markets.status === "fulfilled") renderMarkets(markets.value);

  const updated = [infra, markets].filter((r) => r.status === "fulfilled").map((r) => r.value.updatedAt).sort().at(-1);
  $("updated").textContent = updated ? `updated ${ago(updated)}` : "";
  $("updated").title = updated ? new Date(updated).toLocaleString() : "";
}

function showTab() {
  const tab = location.hash === "#markets" ? "markets" : "infra";
  for (const el of document.querySelectorAll(".tab")) el.setAttribute("aria-selected", el.dataset.tab === tab);
  $("view-infra").hidden = tab !== "infra";
  $("view-markets").hidden = tab !== "markets";
}

// tooltip for status bars
const tip = $("tip");
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return (tip.hidden = true);
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
});
document.addEventListener("mousemove", (e) => {
  if (tip.hidden) return;
  tip.style.left = Math.max(8, Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)) + "px";
  tip.style.top = e.clientY + 16 + "px";
});

$("demo-chip").hidden = !demo;
addEventListener("hashchange", showTab);
showTab();
load();
setInterval(load, 60_000);
