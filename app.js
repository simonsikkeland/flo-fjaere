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
  geoBtn: document.getElementById("geo-btn"),
  shareBtn: document.getElementById("share-btn"),
  shareFeedback: document.getElementById("share-feedback"),
  dayPrev: document.getElementById("day-prev"),
  dayNext: document.getElementById("day-next"),
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
let tideData = null;   // { curve, extremes, days, fromDay, fetchedAt } for currentPlace
let selectedDay = null; // ISO-dato for dagen som vises i grafen

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
  const curveUrl = `${TIDE_API}?${common}&datatype=all&interval=10&fromtime=${from}T00%3A00&totime=${to}T00%3A00`;

  let tabXml, curveXml;
  try {
    [tabXml, curveXml] = await Promise.all([fetchXml(tabUrl), fetchXml(curveUrl)]);
  } catch (err) {
    setStatus(friendlyError(err), true);
    return;
  }

  // API-et kan levere noen punkter forbi totime – kutt ved hele dager.
  const extremes = parseWaterlevels(tabXml).filter((p) => dateOf(p.time) < to);
  const curve = parseWaterlevels(curveXml);
  if (!extremes.length) {
    setStatus("Fant ingen flo- og fjæredata for dette stedet.", true);
    return;
  }

  // Dager fra tabelldataene, så grafnavigasjonen matcher lista (kurven kan ha en delvis dag på slutten).
  const days = [...new Set(extremes.map((p) => dateOf(p.time)))].sort();
  tideData = { curve, extremes, days, fromDay: from, fetchedAt: Date.now() };
  selectedDay = from;

  currentPlace = place;
  el.locationName.textContent = place.name;
  el.locationMeta.textContent = place.meta || "";
  updateFavToggle();
  renderNow();
  renderChart();
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

function countdownText(msUntil) {
  const totalMin = Math.max(0, Math.round(msUntil / 60000));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `om ${h} t ${m} min` : `om ${m} min`;
}

function renderNow() {
  if (!tideData) return;
  const { curve, extremes } = tideData;
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
    ? `${next.flag === "high" ? "Flo" : "Fjære"} kl. ${clockOf(next.time)} (${Math.round(next.value)} cm) – ${countdownText(new Date(next.time).getTime() - now)}`
    : "–";
  el.nowCard.hidden = false;
}

function renderChart() {
  if (!tideData) return;
  const { curve, extremes, days } = tideData;

  const dayIdx = days.indexOf(selectedDay);
  el.dayPrev.disabled = dayIdx <= 0;
  el.dayNext.disabled = dayIdx < 0 || dayIdx >= days.length - 1;

  const label = dayLabel(selectedDay);
  el.chartTitle.textContent = /^I /.test(label)
    ? label + " – " + new Intl.DateTimeFormat("nb-NO", {
        day: "numeric", month: "long", timeZone: "Europe/Oslo",
      }).format(new Date(selectedDay + "T12:00:00Z"))
    : label;

  // Dagens punkter + første punkt neste døgn, så kurven når helt til kl. 24:00.
  const dayCurve = curve.filter((p) => dateOf(p.time) === selectedDay);
  const nextIdx = curve.indexOf(dayCurve[dayCurve.length - 1]) + 1;
  if (curve[nextIdx]) dayCurve.push(curve[nextIdx]);

  if (dayCurve.length < 2) { el.chart.innerHTML = ""; return; }

  const W = 800, H = 240, padL = 44, padR = 12, padT = 26, padB = 26;
  const t0 = new Date(dayCurve[0].time).getTime();
  const t1 = t0 + 24 * 3600e3;
  const values = dayCurve.map((p) => p.value);
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const span = Math.max(vMax - vMin, 20);
  const yMin = vMin - span * 0.12, yMax = vMax + span * 0.12;

  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const pts = dayCurve.map((p) => `${x(new Date(p.time).getTime()).toFixed(1)},${y(p.value).toFixed(1)}`);
  const linePath = "M" + pts.join(" L");
  const lastX = x(new Date(dayCurve[dayCurve.length - 1].time).getTime()).toFixed(1);
  const areaPath = `${linePath} L${lastX},${H - padB} L${padL},${H - padB} Z`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vannstandskurve for ${dayLabel(selectedDay)}">`;

  // Rutenett: hver 6. time + y-akse-merker
  for (let h = 0; h <= 24; h += 6) {
    const gx = x(t0 + h * 3600e3);
    svg += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${H - padB}" style="stroke:var(--grid)" stroke-width="1"/>`;
    svg += `<text x="${gx}" y="${H - 8}" font-size="11" style="fill:var(--muted)" text-anchor="middle">${String(h).padStart(2, "0")}:00</text>`;
  }
  for (const v of [Math.round(vMin / 10) * 10, Math.round(((vMin + vMax) / 2) / 10) * 10, Math.round(vMax / 10) * 10]) {
    svg += `<text x="${padL - 6}" y="${y(v) + 4}" font-size="11" style="fill:var(--muted)" text-anchor="end">${v}</text>`;
  }

  svg += `<path d="${areaPath}" style="fill:var(--sea)"/>`;
  svg += `<path d="${linePath}" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`;

  // Flo/fjære-markører innenfor dagen
  for (const ex of extremes) {
    const t = new Date(ex.time).getTime();
    if (t < t0 || t > t1) continue;
    const ey = y(ex.value), exx = x(t);
    const isHigh = ex.flag === "high";
    svg += `<circle cx="${exx}" cy="${ey}" r="4.5" style="fill:var(${isHigh ? "--high" : "--low"})"/>`;
    const ty = isHigh ? ey - 10 : ey + 18;
    svg += `<text x="${exx}" y="${ty}" font-size="12" font-weight="600" style="fill:var(--ink)" text-anchor="middle">${clockOf(ex.time)}</text>`;
  }

  // Nå-markør (bare når valgt dag er i dag)
  const now = Date.now();
  if (now >= t0 && now <= t1) {
    const nx = x(now);
    svg += `<line x1="${nx}" y1="${padT}" x2="${nx}" y2="${H - padB}" style="stroke:var(--ink)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.6"/>`;
    svg += `<text x="${nx}" y="${padT - 8}" font-size="11" style="fill:var(--ink)" text-anchor="middle">nå</text>`;
  }

  svg += "</svg>";
  el.chart.innerHTML = svg;
}

function selectDay(day) {
  if (!tideData || !tideData.days.includes(day)) return;
  selectedDay = day;
  renderChart();
}

el.dayPrev.addEventListener("click", () => {
  if (tideData) selectDay(tideData.days[tideData.days.indexOf(selectedDay) - 1]);
});

el.dayNext.addEventListener("click", () => {
  if (tideData) selectDay(tideData.days[tideData.days.indexOf(selectedDay) + 1]);
});

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
    const headBtn = document.createElement("button");
    headBtn.type = "button";
    headBtn.className = "day-heading";
    headBtn.textContent = dayLabel(day);
    headBtn.title = "Vis i grafen";
    headBtn.addEventListener("click", () => {
      selectDay(day);
      document.querySelector(".chart-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    h4.appendChild(headBtn);
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

/* ---------- Geolokasjon ---------- */

el.geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Nettleseren din støtter ikke posisjonstjenester.", true);
    return;
  }
  setStatus("Finner posisjonen din …");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    let name = "Min posisjon", meta = "";
    try {
      const url = `https://api.kartverket.no/stedsnavn/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258&radius=2000&treffPerSide=20`;
      const data = await (await fetch(url)).json();
      const skipTypes = new Set(["Adressenavn", "Veg", "Gate", "Vegkryss", "Vegbom", "Bru"]);
      const nearest = (data.navn || [])
        .filter((n) => n.stedsnavn?.[0]?.skrivemåte && !skipTypes.has(n.navneobjekttype))
        .sort((a, b) => a.meterFraPunkt - b.meterFraPunkt)[0];
      if (nearest) {
        name = nearest.stedsnavn[0].skrivemåte;
        meta = `${nearest.navneobjekttype} nær posisjonen din`;
      }
    } catch { /* behold fallback-navnet */ }
    choosePlace({ name, meta, lat, lon });
  }, () => {
    setStatus("Fikk ikke tilgang til posisjonen din. Sjekk at posisjonstilgang er tillatt for denne siden.", true);
  }, { timeout: 15000 });
});

/* ---------- Deling ---------- */

let shareFeedbackTimer = null;

el.shareBtn.addEventListener("click", async () => {
  const url = location.href;
  const title = `Flo og fjære – ${currentPlace ? currentPlace.name : ""}`;
  if (navigator.share) {
    try { await navigator.share({ title, url }); } catch { /* avbrutt av bruker */ }
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    // Fallback for eldre nettlesere / manglende clipboard-tilgang
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { copied = document.execCommand("copy"); } catch { /* gir opp */ }
    ta.remove();
  }
  if (copied) {
    el.shareFeedback.hidden = false;
    clearTimeout(shareFeedbackTimer);
    shareFeedbackTimer = setTimeout(() => { el.shareFeedback.hidden = true; }, 2000);
  } else {
    setStatus("Kunne ikke kopiere lenken.", true);
  }
});

/* ---------- Auto-oppdatering ---------- */

function refreshIfStale() {
  if (!currentPlace || !tideData) return;
  const dayRolledOver = osloToday() !== tideData.fromDay;
  const stale = Date.now() - tideData.fetchedAt > 60 * 60e3;
  if (dayRolledOver || stale) loadTides(currentPlace);
}

setInterval(() => {
  if (!tideData) return;
  if (osloToday() !== tideData.fromDay) { refreshIfStale(); return; }
  renderNow();
  if (selectedDay === osloToday()) renderChart(); // flytt nå-linjen
}, 60e3);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshIfStale();
});

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
