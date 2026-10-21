// chainpulse frontend: renders site/data/infra.json and site/data/markets.json.
// Add ?demo to the URL to load generated demo data instead.
const BARS = 60;
const DAY = 86400;

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has("demo");
const file = (name) => `data/${demo ? "demo-" : ""}${name}.json`;

/* ---------------- settings: language and theme ---------------- */

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {}
  },
};

const LANGS = Object.keys(I18N);

function detectLang() {
  const saved = store.get("cp-lang");
  if (LANGS.includes(saved)) return saved;
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return "en";
}

let lang = detectLang();

function t(key, ...args) {
  const v = I18N[lang][key] ?? I18N.en[key] ?? key;
  return typeof v === "function" ? v(...args) : v;
}

function applyStaticText() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute("aria-label", el.title);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  $("lang").value = lang;
}

function setLang(next) {
  lang = LANGS.includes(next) ? next : "en";
  store.set("cp-lang", lang);
  applyStaticText();
  render();
}

// "system" = no data-theme attribute, so CSS follows prefers-color-scheme
function setTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  store.set("cp-theme", theme === "system" ? null : theme);
  for (const b of document.querySelectorAll("#theme button")) {
    b.setAttribute("aria-pressed", b.dataset.theme === (document.documentElement.dataset.theme ?? "system"));
  }
}

/* ---------------- formatting ---------------- */

// API text goes into innerHTML, so it must be escaped
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n) => n.toLocaleString(t("locale"));
const pct = (n) => (n >= 99.995 ? "100%" : n.toFixed(2) + "%");
const odds = (p) => {
  const v = p * 100;
  return (v < 1 || v > 99 ? v.toFixed(1) : Math.round(v)) + "%";
};
const usd = (n) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const fmtTime = (sec) =>
  new Date(sec * 1000).toLocaleString(t("locale"), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return t("justNow");
  if (min < 60) return t("minAgo", min);
  const h = Math.round(min / 60);
  return h < 24 ? t("hAgo", h) : t("dAgo", Math.round(h / 24));
}

function deltaChip(change) {
  const pp = Math.round(change * 100);
  const cls = pp > 0 ? "pos" : pp < 0 ? "neg" : "flat";
  return `<span class="delta ${cls}">${pp > 0 ? "+" : ""}${pp}${t("pp")}</span>`;
}

// The collector writes reasons in English ("410 behind, slow response"); translate the known ones.
function reason(text) {
  return String(text)
    .split(", ")
    .map((part) => {
      let m;
      if ((m = part.match(/^(\d+) behind$/))) return t("behind", num(+m[1]));
      if ((m = part.match(/^block (\d+)s old$/))) return t("blockOld", m[1]);
      if (part === "slow response") return t("slowResponse");
      if (part === "slot not advancing") return t("slotStuck");
      if (part === "timeout") return t("timeout");
      return part;
    })
    .join(", ");
}

const stateLabel = (s) => t({ up: "stateUp", slow: "stateSlow", down: "stateDown" }[s] ?? "stateDown");

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
  const parts = [fmtTime(c.t), stateLabel(c.s), `${c.ms} ${t("ms")}`];
  if (c.b) parts.push(`#${num(c.b)}`);
  if (c.l) parts.push(`${t("lag")} ${num(c.l)}`);
  if (c.e) parts.push(reason(c.e));
  return parts.join(" · ");
}

function targetHtml(target) {
  const s = targetStats(target.checks);
  const recent = target.checks.slice(-BARS);
  const bars = Array(BARS - recent.length)
    .fill(`<span class="bar empty"></span>`)
    .concat(recent.map((c) => `<span class="bar ${c.s}" data-tip="${esc(barTip(c))}"></span>`))
    .join("");
  const note = s.last && s.last.s !== "up" && s.last.e
    ? `<span class="svc-note ${s.last.s}">${esc(reason(s.last.e))}</span>` : "";

  return `<div class="svc">
    <div class="svc-head">
      <div class="svc-name"><span class="dot ${s.last?.s}"></span>${esc(target.name)}
        <span class="host">${esc(target.host)}</span>${note}</div>
      <div class="svc-stats">
        <span>${t("uptime")} <b>${pct(s.uptime)}</b></span>
        <span>${t("avg24h")} <b>${s.avg ? `${s.avg} ${t("ms")}` : "–"}</b></span>
      </div>
    </div>
    <div class="bars">${bars}</div>
    <div class="bars-legend"><span>${recent.length ? fmtTime(recent[0].t) : ""}</span><span>${t("now")}</span></div>
  </div>`;
}

function groupHtml(g) {
  const lasts = g.targets.map((x) => x.checks.at(-1)).filter((c) => c && c.s !== "down");
  const meta = [];
  const head = lasts.reduce((best, c) => (c.b > (best?.b ?? 0) ? c : best), null);
  if (head?.b) meta.push(`${t(g.type === "solana" ? "slot" : "block")} <b>#${num(head.b)}</b>`);
  if (head?.a !== undefined) meta.push(t("ago", `<b>${t("sec", head.a)}</b>`));
  const gas = lasts.find((c) => c.g !== undefined)?.g;
  if (gas !== undefined) meta.push(`${t("gas")} <b>${gas}</b> gwei`);

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
    $("groups").innerHTML = `<div class="card empty-state">${t("noChecks")} <code>npm run infra</code></div>`;
    return;
  }

  const states = groups.map((g) => [g.name, groupState(g)]);
  const down = states.filter(([, s]) => s === "down").map(([n]) => n);
  const slow = states.filter(([, s]) => s === "slow").map(([n]) => n);
  const banner = $("banner");
  if (down.length) {
    banner.dataset.state = "down";
    $("banner-text").textContent = t("outage", down.join(", "));
  } else if (slow.length) {
    banner.dataset.state = "slow";
    $("banner-text").textContent = t("degraded", slow.join(", "));
  } else {
    banner.dataset.state = "up";
    $("banner-text").textContent = t("allUp");
  }

  const healthy = states.filter(([, s]) => s === "up").length;
  const rpcChecks = groups.filter((g) => g.type !== "http").flatMap((g) => g.targets.flatMap((x) => x.checks));
  const rpcAvg = targetStats(rpcChecks).avg;
  const gas = groups.flatMap((g) => g.targets.map((x) => x.checks.at(-1))).find((c) => c?.g !== undefined)?.g;

  $("summary").innerHTML = [
    [t("healthy"), `${healthy}<small> / ${groups.length}</small>`],
    [t("rpcAvg"), rpcAvg ? `${rpcAvg}<small> ${t("ms")}</small>` : "–"],
    [t("ethGas"), gas !== undefined ? `${gas}<small> gwei</small>` : "–"],
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
  const xy = points.map(([x, p]) => [((x - t0) / (t1 - t0 || 1)) * w, pad + (1 - (p - min) / (max - min)) * (h - pad * 2)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const dir = ys.at(-1) > ys[0] ? "pos" : ys.at(-1) < ys[0] ? "neg" : change > 0 ? "pos" : change < 0 ? "neg" : "flat";
  return `<svg class="chart ${dir}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
    <path class="area" d="${line}L${w},${h}L0,${h}Z"/>
    <path class="line" d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
}

// Questions are translated by the collector (scripts/translate.mjs); fall back to English.
function questionHtml(q, cls) {
  const tr = lang !== "en" ? state.tr?.items?.[q]?.[lang] : null;
  return tr
    ? `<span class="${cls}" lang="${lang}" title="${esc(q)}">${esc(tr)}</span>`
    : `<span class="${cls}" lang="en">${esc(q)}</span>`;
}

const marketUrl = (event) => (event ? `https://polymarket.com/event/${encodeURIComponent(event)}` : "https://polymarket.com");

function daysLeft(iso) {
  const d = Math.round((Date.parse(iso) - Date.now()) / 86400000);
  return d <= 0 ? t("endsToday") : t("endsIn", d);
}

function marketHtml(m) {
  const price = m.points.at(-1)[1];
  const label = m.outcome && m.outcome !== "Yes" ? esc(m.outcome) : t("chance");
  const history = m.points.length >= 2
    ? chart(m.points, m.change24h)
    : `<div class="market-empty">${t("collecting", m.points.length)}</div>`;
  const img = m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : "";

  return `<a class="card market" href="${marketUrl(m.event)}" target="_blank" rel="noopener">
    <div class="market-head">${img}${questionHtml(m.question, "market-q")}</div>
    <div class="market-row"><span class="market-price">${odds(price)}</span><span class="market-outcome">${label}</span>${deltaChip(m.change24h)}</div>
    ${history}
    <div class="market-foot"><span>${t("vol24h")} ${usd(m.volume24h)}</span><span>${m.endDate ? daysLeft(m.endDate) : ""}</span></div>
  </a>`;
}

function renderMarkets(data) {
  const tracked = (data.tracked ?? []).map((id) => data.markets[id]).filter(Boolean);
  $("markets").innerHTML = tracked.length
    ? tracked.map(marketHtml).join("")
    : `<div class="card empty-state">${t("noSnapshots")} <code>npm run markets</code></div>`;

  $("movers").innerHTML = (data.movers ?? [])
    .map((m) => `<a class="mover" href="${marketUrl(m.event)}" target="_blank" rel="noopener">
      ${questionHtml(m.question, "q")}<span class="price">${odds(m.price)}</span>${deltaChip(m.change24h)}</a>`)
    .join("") || `<div class="empty-state">${t("noMovers")}</div>`;
}

/* ---------------- app ---------------- */

const state = { infra: null, markets: null, tr: null, failed: false };

function render() {
  if (state.infra) renderInfra(state.infra);
  else if (state.failed) {
    $("banner").dataset.state = "down";
    $("banner-text").textContent = t("loadError");
  }
  if (state.markets) renderMarkets(state.markets);

  const updated = [state.infra, state.markets].filter(Boolean).map((d) => d.updatedAt).sort().at(-1);
  $("updated").textContent = updated ? t("updated", ago(updated)) : "";
  $("updated").title = updated ? new Date(updated).toLocaleString(t("locale")) : "";
}

async function getJson(name) {
  const res = await fetch(`${file(name)}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  const [infra, markets, tr] = await Promise.allSettled([getJson("infra"), getJson("markets"), getJson("translations")]);
  if (infra.status === "fulfilled") state.infra = infra.value;
  if (markets.status === "fulfilled") state.markets = markets.value;
  if (tr.status === "fulfilled") state.tr = tr.value;
  state.failed = infra.status === "rejected" && !state.infra;
  render();
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
  const el = e.target.closest("[data-tip]");
  if (!el) return (tip.hidden = true);
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
});
document.addEventListener("mousemove", (e) => {
  if (tip.hidden) return;
  tip.style.left = Math.max(8, Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)) + "px";
  tip.style.top = e.clientY + 16 + "px";
});

for (const ev of ["change", "input"]) $("lang").addEventListener(ev, (e) => e.target.value !== lang && setLang(e.target.value));
$("theme").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-theme]");
  if (b) setTheme(b.dataset.theme);
});

$("demo-chip").hidden = !demo;
setTheme(document.documentElement.dataset.theme ?? "system");
applyStaticText();
addEventListener("hashchange", showTab);
showTab();
load();
setInterval(load, 60_000);
