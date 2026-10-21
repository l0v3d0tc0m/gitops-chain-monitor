// Renders site/data/history.json. Open with ?demo to load generated demo data.
const BARS = 60;          // how many recent checks to draw per service
const SLOW_MS = 1500;     // slower than this counts as "degraded"
const DAY_MS = 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const dataUrl = new URLSearchParams(location.search).has("demo") ? "data/demo.json" : "data/history.json";

function stateOf(check) {
  if (!check) return "empty";
  if (!check.ok) return "down";
  return check.ms > SLOW_MS ? "slow" : "up";
}

function pct(n) {
  return n === 100 ? "100%" : n.toFixed(2) + "%";
}

function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stats(checks) {
  const total = checks.length;
  const up = checks.filter((c) => c.ok).length;
  const day = checks.filter((c) => Date.now() - new Date(c.t) < DAY_MS && c.ok);
  const avg = day.length ? Math.round(day.reduce((s, c) => s + c.ms, 0) / day.length) : null;
  return { uptime: total ? (up / total) * 100 : 0, avg, last: checks[checks.length - 1] };
}

function sparkline(checks) {
  const pts = checks.slice(-BARS).filter((c) => c.ok);
  if (pts.length < 2) return "";
  const w = 600, h = 36, pad = 3;
  const max = Math.max(...pts.map((c) => c.ms));
  const min = Math.min(...pts.map((c) => c.ms));
  const span = max - min || 1;
  const xy = pts.map((c, i) => [
    (i / (pts.length - 1)) * w,
    pad + (1 - (c.ms - min) / span) * (h - pad * 2),
  ]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Response time trend">
    <path class="area" d="${line}L${w},${h}L0,${h}Z"/><path class="line" d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
}

function serviceHtml(name, { url, checks }) {
  const s = stats(checks);
  const recent = checks.slice(-BARS);
  const padded = Array(BARS - recent.length).fill(null).concat(recent);
  const bars = padded
    .map((c) => {
      const st = stateOf(c);
      if (!c) return `<span class="bar empty"></span>`;
      const label = `${fmtTime(c.t)} · ${c.ok ? c.code + " · " + c.ms + "ms" : "DOWN · " + (c.error || c.code)}`;
      return `<span class="bar ${st}" data-tip="${label}"></span>`;
    })
    .join("");
  const host = new URL(url).host;

  return `<article class="svc">
    <div class="svc-head">
      <div class="svc-name"><span class="dot ${stateOf(s.last)}"></span>${name}
        <a href="${url}" target="_blank" rel="noopener">${host}</a></div>
      <div class="svc-stats">
        <span>uptime <b>${pct(s.uptime)}</b></span>
        <span>avg 24h <b>${s.avg ?? "–"}${s.avg ? "ms" : ""}</b></span>
      </div>
    </div>
    <div class="bars">${bars}</div>
    <div class="bars-legend"><span>${recent.length ? fmtTime(recent[0].t) : ""}</span><span>now</span></div>
    ${sparkline(checks)}
  </article>`;
}

function render(data) {
  const entries = Object.entries(data.sites || {});
  if (!entries.length) {
    $("services").innerHTML = `<div class="empty-state">No checks yet. Run <code>node scripts/check.mjs</code>.</div>`;
    return;
  }

  const lastStates = entries.map(([, s]) => stateOf(s.checks[s.checks.length - 1]));
  const down = lastStates.filter((x) => x === "down").length;
  const slow = lastStates.filter((x) => x === "slow").length;

  const banner = $("banner");
  if (down) {
    banner.dataset.state = "down";
    $("banner-text").textContent = `${down} of ${entries.length} services are down`;
  } else if (slow) {
    banner.dataset.state = "slow";
    $("banner-text").textContent = `Degraded performance on ${slow} service${slow > 1 ? "s" : ""}`;
  } else {
    banner.dataset.state = "up";
    $("banner-text").textContent = "All systems operational";
  }

  const all = entries.flatMap(([, s]) => s.checks);
  const overall = stats(all);
  $("summary").innerHTML = [
    ["Services", entries.length],
    ["Overall uptime", pct(overall.uptime)],
    ["Avg response 24h", overall.avg ? overall.avg + "ms" : "–"],
  ]
    .map(([k, v]) => `<div class="tile"><div class="tile-label">${k}</div><div class="tile-value">${v}</div></div>`)
    .join("");

  $("services").innerHTML = entries.map(([name, s]) => serviceHtml(name, s)).join("");
  $("updated").textContent = data.updatedAt ? `updated ${ago(data.updatedAt)}` : "";
  $("updated").title = data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "";
}

async function load() {
  try {
    const res = await fetch(`${dataUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    render(await res.json());
  } catch (err) {
    $("banner").dataset.state = "down";
    $("banner-text").textContent = "Could not load status data";
    console.error(err);
  }
}

// tooltip for bars
const tip = $("tip");
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return (tip.hidden = true);
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
});
document.addEventListener("mousemove", (e) => {
  if (tip.hidden) return;
  const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + "px";
  tip.style.top = e.clientY + 16 + "px";
});

load();
setInterval(load, 60_000);
