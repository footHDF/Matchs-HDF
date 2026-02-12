const RADIUS_KM = 60;

const COMPETITIONS = [
  { code: "N2", label: "N2" },
  { code: "N3", label: "N3" },
  { code: "R1", label: "R1" },
  { code: "R2", label: "R2" },
  { code: "R3", label: "R3" },
  { code: "CDF", label: "Coupe de France" },
  { code: "COUPE_LFHF", label: "Coupes LFHF" }
];

let allMatches = [];
let geocodes = [];
let activeCompetitions = new Set(COMPETITIONS.map(c => c.code));

let map, markerLayer;
let currentMarkers = [];

const el = (id) => document.getElementById(id);
const setStatus = (msg) => (el("status").textContent = msg);

function buildChips() {
  const wrap = el("chips");
  wrap.innerHTML = "";
  COMPETITIONS.forEach(c => {
    const b = document.createElement("button");
    b.className = activeCompetitions.has(c.code) ? "chip on" : "chip";
    b.textContent = c.label;
    b.onclick = () => {
      if (activeCompetitions.has(c.code)) activeCompetitions.delete(c.code);
      else activeCompetitions.add(c.code);
      buildChips();
      runSearch();
    };
    wrap.appendChild(b);
  });
}

function initMap() {
  map = L.map("map").setView([50.2, 2.9], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function clearMarkers() {
  markerLayer.clearLayers();
  currentMarkers = [];
}

function addMarker(match, idx) {
  const m = L.marker([match.venue.lat, match.venue.lon]).addTo(markerLayer);
  m.bindPopup(`
    <b>${match.competition_label || match.competition}</b><br/>
    ${formatKickoff(match.kickoff)}<br/>
    ${escapeHtml(match.home)} - ${escapeHtml(match.away)}<br/>
    ${escapeHtml(match.venue.city)} (${match.distance_km.toFixed(1)} km)
  `);
  m.on("click", () => focusListItem(idx));
  currentMarkers.push(m);
}

function focusListItem(idx) {
  const node = document.querySelector(`[data-idx="${idx}"]`);
  if (!node) return;
  document.querySelectorAll(".item").forEach(x => x.classList.remove("active"));
  node.classList.add("active");
  node.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolveQuery(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return null;

  // match exact CP
  const byCp = geocodes.find(g => (g.q || "").toLowerCase() === q);
  if (byCp) return byCp;

  // match label contains (ville)
  const byCity = geocodes.find(g => (g.label || "").toLowerCase().includes(q));
  if (byCity) return byCity;

  return null;
}

function weekendFromKickoffIso(iso) {
  const d = new Date(iso);
  const day = d.getDay(); // 0=dim ... 6=sam

  // On veut le samedi du week-end DU MATCH :
  // - dimanche (0) => samedi veille (-1)
  // - samedi (6) => 0
  // - lundi (1) => +5 etc.
  const diff = (day === 0) ? -1 : (6 - day);

  const sat = new Date(d);
  sat.setDate(d.getDate() + diff);
  sat.setHours(0, 0, 0, 0);

  const y = sat.getFullYear();
  const m = String(sat.getMonth() + 1).padStart(2, "0");
  const da = String(sat.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}


}

function buildWeekendSelect() {
  const select = el("weekendSelect");
  const ids = Array.from(new Set(allMatches.map(m => weekendFromKickoffIso(m.kickoff))))
    .sort((a,b) => a.localeCompare(b));

  select.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = labelWeekend(id);
    select.appendChild(opt);
  });

  const next = weekendIdFromDate(new Date());
  if (ids.includes(next)) select.value = next;
  else if (ids.length) select.value = ids[0];
}

function formatKickoff(iso) {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderList(matches, center) {
  const list = el("list");
  list.innerHTML = "";

  matches.forEach((m, idx) => {
    const kickoff = formatKickoff(m.kickoff);
    const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${m.venue.lat},${m.venue.lon}&origin=${center.lat},${center.lon}`;

    const item = document.createElement("div");
    item.className = "item";
    item.dataset.idx = String(idx);

    item.innerHTML = `
      <div class="line1">
        <span class="badge">${escapeHtml(m.competition)}</span>
        <span class="kickoff">${escapeHtml(kickoff)}</span>
        <span class="dist">${m.distance_km.toFixed(1)} km</span>
      </div>
      <div class="line2"><b>${escapeHtml(m.home)}</b> vs <b>${escapeHtml(m.away)}</b></div>
      <div class="line3">${escapeHtml(m.venue.name || "Stade")} — ${escapeHtml(m.venue.city)} (${escapeHtml(m.venue.postcode || "")})</div>
      <div class="line4">
        <a href="${gmaps}" target="_blank" rel="noreferrer">Itinéraire</a>
        ${m.source_url ? ` · <a href="${m.source_url}" target="_blank" rel="noreferrer">Source</a>` : ""}
      </div>
    `;

    item.onclick = () => {
      currentMarkers[idx]?.openPopup();
      map.setView([m.venue.lat, m.venue.lon], 12);
      focusListItem(idx);
    };

    list.appendChild(item);
  });
}

function runSearch() {
  const resolved = resolveQuery(el("q").value);
  if (!resolved) {
    setStatus("Saisis une ville/CP des Hauts-de-France (ou utilise 📍).");
    clearMarkers();
    el("list").innerHTML = "";
    return;
  }

  const weekendId = el("weekendSelect").value;
  const sortMode = el("sort").value;
  const center = { lat: resolved.lat, lon: resolved.lon };

  let matches = allMatches
    .filter(m => weekendFromKickoffIso(m.kickoff) === weekendId)
    .filter(m => activeCompetitions.has(m.competition))
    .map(m => ({
      ...m,
      distance_km: haversineKm(center.lat, center.lon, m.venue.lat, m.venue.lon)
    }))
    .filter(m => m.distance_km <= RADIUS_KM);

  matches.sort((a,b) => {
    if (sortMode === "time") return new Date(a.kickoff) - new Date(b.kickoff);
    return a.distance_km - b.distance_km;
  });

  setStatus(`${matches.length} match(s) dans ${RADIUS_KM} km autour de ${resolved.label}`);

  clearMarkers();
  matches.forEach((m, idx) => addMarker(m, idx));
  renderList(matches, center);

  if (matches.length) {
    const bounds = L.latLngBounds(matches.map(m => [m.venue.lat, m.venue.lon]));
    map.fitBounds(bounds.pad(0.2));
  } else {
    map.setView([center.lat, center.lon], 10);
  }
}

async function loadData() {
  const [mRes, gRes, uRes] = await Promise.all([
    fetch("data/matches.json"),
    fetch("data/geocodes-hdf.json"),
    fetch("data/last_update.json").catch(() => null)
  ]);

  const mJson = await mRes.json();
  allMatches = mJson.matches || [];
  geocodes = await gRes.json();

  if (uRes) {
    const uJson = await uRes.json();
    el("lastUpdate").textContent = uJson?.last_update ? `Maj : ${uJson.last_update}` : "";
  }
}

function bindUI() {
  el("q").addEventListener("input", runSearch);
  el("weekendSelect").addEventListener("change", runSearch);
  el("sort").addEventListener("change", runSearch);

  el("geoBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Géolocalisation non supportée.");
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      geocodes = [{ q: "__geo__", label: "Ma position", lat, lon }, ...geocodes];
      el("q").value = "__geo__";
      runSearch();
    }, () => alert("Impossible d’obtenir la position."));
  });
}

(async function main() {
  initMap();
  buildChips();
  await loadData();
  buildWeekendSelect();
  bindUI();
  runSearch();
})();
