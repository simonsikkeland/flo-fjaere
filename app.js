/* Flo og fjære – statisk klient mot Kartverkets åpne API-er.
 * Stedssøk:  https://api.kartverket.no/stedsnavn/v1/  (JSON)
 * Tidevann:  https://vannstand.kartverket.no/tideapi.php  (XML)
 */

const SEARCH_API = "https://api.kartverket.no/stedsnavn/v1/navn";
const TIDE_API = "https://vannstand.kartverket.no/tideapi.php";
const DAYS_AHEAD = 7;
const DEFAULT_PLACE = { name: "Ålesund", meta: "By i Ålesund, Møre og Romsdal", lat: 62.47226, lon: 6.1549 };

const el = {
  search: document.getElementById("search"),
  suggestions: document.getElementById("suggestions"),
  favorites: document.getElementById("favorites"),
  favToggle: document.getElementById("fav-toggle"),
  result: document.getElementById("result"),
  locationName: document.getElementById("location-name"),
  locationMeta: document.getElementById("location-meta"),
  nowCard: document.getElementById("now-card"),
  nowValue: document.getElementById("now-value"),
  nowTrend: document.getElementById("now-trend"),
  nowNext: document.getElementById("now-next"),
  updated: document.getElementById("updated"),
  chartTitle: document.getElementById("chart-title"),
  chart: document.getElementById("chart"),
  tables: document.getElementById("tide-tables"),
  status: document.getElementById("status"),
};

let currentPlace = null;

/* ---------- Hjelpere ---------- */

// Dagens dato (YYYY-MM-DD) i norsk tid, uavhengig av leserens tidssone.
function osloToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Viser klokkeslett slik API-et oppgir det (norsk lokaltid), uten tidssone-kluss.
const clockOf = (isoString) => isoString.slice(11, 16);
const dateOf = (isoString) => isoString.slice(0, 10);

function dayLabel(isoDate) {
  const today = osloToday();
  if (isoDate === today) return "I dag";
  if (isoDate === addDays(today, 1)) return "I morgen";
  return new Intl.DateTimeFormat("nb-NO", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Oslo",
  }).format(new Date(isoDate + "T12:00:00Z"));
}

function setStatus(message, isError = false) {
  el.status.hidden = !message;
  el.status.textContent = message || "";
  el.status.classList.toggle("error", isError);
}

/* ---------- Favoritter ---------- */

const placeKey = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

function getFavorites() {
  try {
    const favs = JSON.parse(localStorage.getItem("floFjaereFavs"));
    return Array.isArray(favs) ? favs : [];
  } catch { return []; }
}

function saveFavorites(favs) {
  localStorage.setItem("floFjaereFavs", JSON.stringify(favs));
}

function isFavorite(place) {
  return getFavorites().some((f) => placeKey(f) === placeKey(place));
}

function renderFavorites() {
  const favs = getFavorites();
  el.favorites.hidden = !favs.length;
  el.favorites.innerHTML = "";
  for (const fav of favs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fav-chip";
    btn.textContent = `★ ${fav.name}`;
    btn.addEventListener("click", () => choosePlace(fav));
    el.favorites.appendChild(btn);
  }
}

function updateFavToggle() {
  if (!currentPlace) return;
  const fav = isFavorite(currentPlace);
  el.favToggle.textContent = fav ? "★" : "☆";
  const label = fav ? "Fjern fra favoritter" : "Legg til i favoritter";
  el.favToggle.title = label;
  el.favToggle.setAttribute("aria-label", label);
}

el.favToggle.addEventListener("click", () => {
  if (!currentPlace) return;
  let favs = getFavorites();
  if (isFavorite(currentPlace)) {
    favs = favs.filter((f) => placeKey(f) !== placeKey(currentPlace));
  } else {
    favs.push(currentPlace);
  }
  saveFavorites(favs);
  renderFavorites();
  updateFavToggle();
});

/* ---------- Stedssøk ---------- */

let debounceTimer = null;
let activeIndex = -1;
let currentSuggestions = [];

el.search.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const q = el.search.value.trim();
  if (q.length < 2) { hideSuggestions(); return; }
  debounceTimer = setTimeout(() => searchPlaces(q), 250);
});

el.search.addEventListener("keydown", (e) => {
  const items = el.suggestions.querySelectorAll("li[data-index]");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!items.length) return;
    e.preventDefault();
    activeIndex = e.key === "ArrowDown"
      ? (activeIndex + 1) % items.length
      : (activeIndex - 1 + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("active", i === activeIndex));
    items[activeIndex].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    if (activeIndex >= 0 && currentSuggestions[activeIndex]) {
      choosePlace(currentSuggestions[activeIndex]);
    } else if (currentSuggestions.length) {
      choosePlace(currentSuggestions[0]);
    }
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) hideSuggestions();
});

async function searchPlaces(query) {
  const url = `${SEARCH_API}?sok=${encodeURIComponent(query)}*&fuzzy=true&treffPerSide=10&utkoordsys=4258`;
  let data;
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch {
    return; // stille feil i søket; brukeren kan prøve igjen
  }
  if (el.search.value.trim() !== query) return; // utdatert svar

  currentSuggestions = (data.navn || []).map((n) => ({
    name: n.skrivemåte,
    meta: [n.navneobjekttype, n.kommuner?.[0]?.kommunenavn, n.fylker?.[0]?.fylkesnavn]
      .filter(Boolean).join(", "),
    lat: n.representasjonspunkt?.nord,
    lon: n.representasjonspunkt?.øst,
  })).filter((p) => p.lat != null && p.lon != null);

  renderSuggestions();
}

function renderSuggestions() {
  activeIndex = -1;
  el.suggestions.innerHTML = "";
  if (!currentSuggestions.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = "Ingen treff";
    el.suggestions.appendChild(li);
  } else {
    currentSuggestions.forEach((p, i) => {
      const li = document.createElement("li");
      li.dataset.index = i;
      li.innerHTML = `<span class="s-name"></span><br><span class="s-meta"></span>`;
      li.querySelector(".s-name").textContent = p.name;
      li.querySelector(".s-meta").textContent = p.meta;
      li.addEventListener("click", () => choosePlace(p));
      el.suggestions.appendChild(li);
    });
  }
  el.suggestions.hidden = false;
}

function hideSuggestions() {
  el.suggestions.hidden = true;
  el.suggestions.innerHTML = "";
  currentSuggestions = [];
  activeIndex = -1;
}

/* ---------- Tidevannsdata ---------- */

function choosePlace(place) {
  hideSuggestions();
  el.search.value = place.name;
  const params = new URLSearchParams({
    sted: place.name, lat: place.lat.toFixed(5), lon: place.lon.toFixed(5),
  });
  history.replaceState(null, "", "?" + params.toString());
  localStorage.setItem("floFjaerePlace", JSON.stringify(place));
  loadTides(place);
}

async function loadTides(place) {
  el.result.hidden = true;
  setStatus("Henter tidevannsdata …");

  const from = osloToday();
  const to = addDays(from, DAYS_AHEAD);
  const common = `lat=${place.lat}&lon=${place.lon}&refcode=cd&lang=nb&dst=1&tzone=1&tide_request=locationdata`;
  const tabUrl = `${TIDE_API}?${common}&datatype=tab&fromtime=${from}T00%3A00&totime=${to}T00%3A00`;
  const curveUrl = `${TIDE_API}?${common}&datatype=all&interval=10&fromtime=${from}T00%3A00&totime=${addDays(from, 1)}T00%3A00`;

  let tabXml, curveXml;
  try {
    [tabXml, curveXml] = await Promise.all([fetchXml(tabUrl), fetchXml(curveUrl)]);
  } catch (err) {
    setStatus(friendlyError(err), true);
    return;
  }

  const extremes = parseWaterlevels(tabXml);
  const curve = parseWaterlevels(curveXml);
  if (!extremes.length) {
    setStatus("Fant ingen flo- og fjæredata for dette stedet.", true);
    return;
  }

  currentPlace = place;
  el.locationName.textContent = place.name;
  el.locationMeta.textContent = place.meta || "";
  updateFavToggle();
  renderNow(curve, extremes);
  renderChart(curve, extremes);
  renderTables(extremes);
  el.updated.textContent = "Sist oppdatert " + new Intl.DateTimeFormat("nb-NO", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo",
  }).format(new Date());
  setStatus("");
  el.result.hidden = false;
}

async function fetchXml(url) {
  const res = await fetch(url);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const error = doc.querySelector("error");
  if (error) throw new Error(error.textContent.trim());
  const nodata = doc.querySelector("nodata");
  if (nodata) throw new Error(nodata.getAttribute("info") || "Ingen data for dette stedet.");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return doc;
}

function friendlyError(err) {
  const msg = String(err.message || err);
  if (/for langt fra kysten|outside|coverage|too far/i.test(msg)) {
    return msg + " Velg et sted nærmere kysten.";
  }
  return "Klarte ikke å hente tidevannsdata: " + msg;
}

function parseWaterlevels(doc) {
  // API-et kan returnere flere serier (prediksjon, prognose, observasjon) – bruk prediksjonen.
  const scope = doc.querySelector('data[type="prediction"]') || doc;
  return [...scope.querySelectorAll("waterlevel")].map((w) => ({
    value: parseFloat(w.getAttribute("value")),
    time: w.getAttribute("time"),
    flag: w.getAttribute("flag"), // "high" | "low" | null
  }));
}

/* ---------- Visning ---------- */

function renderNow(curve, extremes) {
  const now = Date.now();
  const idx = curve.findIndex((p) => new Date(p.time).getTime() >= now);

  if (idx > 0) {
    const level = curve[idx].value;
    const rising = curve[idx].value >= curve[idx - 1].value;
    el.nowValue.textContent = `${Math.round(level)} cm ${rising ? "↑" : "↓"}`;
    el.nowTrend.textContent = rising ? "stiger" : "synker";
  } else {
    el.nowValue.textContent = "–";
    el.nowTrend.textContent = "";
  }

  const next = extremes.find((x) => new Date(x.time).getTime() > now);
  el.nowNext.textContent = next
    ? `${next.flag === "high" ? "Flo" : "Fjære"} kl. ${clockOf(next.time)} (${Math.round(next.value)} cm)`
    : "–";
  el.nowCard.hidden = false;
}

function renderChart(curve, extremes) {
  el.chartTitle.textContent = "I dag – " + new Intl.DateTimeFormat("nb-NO", {
    day: "numeric", month: "long", timeZone: "Europe/Oslo",
  }).format(new Date());

  if (curve.length < 2) { el.chart.innerHTML = ""; return; }

  const W = 800, H = 240, padL = 44, padR = 12, padT = 26, padB = 26;
  const t0 = new Date(curve[0].time).getTime();
  const t1 = new Date(curve[curve.length - 1].time).getTime();
  const values = curve.map((p) => p.value);
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const span = Math.max(vMax - vMin, 20);
  const yMin = vMin - span * 0.12, yMax = vMax + span * 0.12;

  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const pts = curve.map((p) => `${x(new Date(p.time).getTime()).toFixed(1)},${y(p.value).toFixed(1)}`);
  const linePath = "M" + pts.join(" L");
  const areaPath = `${linePath} L${(W - padR).toFixed(1)},${H - padB} L${padL},${H - padB} Z`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vannstandskurve for i dag">`;

  // Rutenett: hver 6. time + y-akse-merker
  for (let h = 0; h <= 24; h += 6) {
    const gx = x(t0 + h * 3600e3);
    svg += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${H - padB}" stroke="#d8e5ec" stroke-width="1"/>`;
    svg += `<text x="${gx}" y="${H - 8}" font-size="11" fill="#5b7482" text-anchor="middle">${String(h).padStart(2, "0")}:00</text>`;
  }
  for (const v of [Math.round(vMin / 10) * 10, Math.round(((vMin + vMax) / 2) / 10) * 10, Math.round(vMax / 10) * 10]) {
    svg += `<text x="${padL - 6}" y="${y(v) + 4}" font-size="11" fill="#5b7482" text-anchor="end">${v}</text>`;
  }

  svg += `<path d="${areaPath}" fill="rgba(13,106,158,0.18)"/>`;
  svg += `<path d="${linePath}" fill="none" stroke="#0d6a9e" stroke-width="2.5" stroke-linejoin="round"/>`;

  // Flo/fjære-markører innenfor dagen
  for (const ex of extremes) {
    const t = new Date(ex.time).getTime();
    if (t < t0 || t > t1) continue;
    const ey = y(ex.value), exx = x(t);
    const isHigh = ex.flag === "high";
    svg += `<circle cx="${exx}" cy="${ey}" r="4.5" fill="${isHigh ? "#0d6a9e" : "#c26a1c"}"/>`;
    const ty = isHigh ? ey - 10 : ey + 18;
    svg += `<text x="${exx}" y="${ty}" font-size="12" font-weight="600" fill="#16323f" text-anchor="middle">${clockOf(ex.time)}</text>`;
  }

  // Nå-markør
  const now = Date.now();
  if (now >= t0 && now <= t1) {
    const nx = x(now);
    svg += `<line x1="${nx}" y1="${padT}" x2="${nx}" y2="${H - padB}" stroke="#16323f" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.6"/>`;
    svg += `<text x="${nx}" y="${padT - 8}" font-size="11" fill="#16323f" text-anchor="middle">nå</text>`;
  }

  svg += "</svg>";
  el.chart.innerHTML = svg;
}

function renderTables(extremes) {
  const byDay = new Map();
  for (const ex of extremes) {
    const day = dateOf(ex.time);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(ex);
  }

  el.tables.innerHTML = "";
  for (const [day, rows] of byDay) {
    const block = document.createElement("div");
    block.className = "day-block";
    const h4 = document.createElement("h4");
    h4.textContent = dayLabel(day);
    block.appendChild(h4);

    const table = document.createElement("table");
    for (const row of rows) {
      const tr = document.createElement("tr");
      const isHigh = row.flag === "high";
      tr.innerHTML = `
        <td class="kind ${isHigh ? "high" : "low"}">${isHigh ? "Flo" : "Fjære"}</td>
        <td class="time">kl. ${clockOf(row.time)}</td>
        <td class="height">${row.value.toFixed(0)} cm</td>`;
      table.appendChild(tr);
    }
    block.appendChild(table);
    el.tables.appendChild(block);
  }
}

/* ---------- Oppstart ---------- */

function initialPlace() {
  const params = new URLSearchParams(location.search);
  const lat = parseFloat(params.get("lat"));
  const lon = parseFloat(params.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { name: params.get("sted") || "Valgt sted", meta: "", lat, lon };
  }
  try {
    const saved = JSON.parse(localStorage.getItem("floFjaerePlace"));
    if (saved && Number.isFinite(saved.lat)) return saved;
  } catch { /* ignorer ødelagt lagring */ }
  return DEFAULT_PLACE;
}

const startPlace = initialPlace();
el.search.value = startPlace.name;
renderFavorites();
loadTides(startPlace);
