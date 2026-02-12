let map;

// Centre par défaut : Saint-Quentin
let CENTER = { lat: 49.848, lon: 3.287 };

// Rayon dynamique
let RADIUS_KM = 60;

// Week-end sélectionné (id = "YYYY-MM-DD" du samedi)
let SELECTED_WEEKEND = null;

// ---------- Chargement données ----------
async function loadMatches() {
  const res = await fetch("data/matches.json");
  const json = await res.json();
  return json.matches;
}

async function loadGeocodes() {
  const res = await fetch("data/geocodes-hdf.json");
  return await res.json();
}

// ---------- Dates / week-ends ----------
function weekendIdFromKickoff(iso) {
  const d = new Date(iso);
  const day = d.getDay(); // 0=dim ... 6=sam

  // On ramène au samedi du week-end du match
  const diff = (day === 0) ? -1 : (6 - day);
  const sat = new Date(d);
  sat.setDate(d.getDate() + diff);
  sat.setHours(0, 0, 0, 0);

  const y = sat.getFullYear();
  const m = String(sat.getMonth() + 1).padStart(2, "0");
  const da = String(sat.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function labelWeekend(id) {
  const [y, m, d] = id.split("-").map(Number);
  const sat = new Date(y, m - 1, d);
  const sun = new Date(y, m - 1, d + 1);

  const fmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
  return `${fmt.format(sat)}–${fmt.format(sun)} ${y}`;
}

// ---------- Carte ----------
function initMap() {
  map = L.map("map").setView([CENTER.lat, CENTER.lon], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function clearMarkers() {
  map.eachLayer(layer => {
    if (layer instanceof L.Marker) map.removeLayer(layer);
  });
}

// ---------- Affichage ----------
function showMatches(matches) {
  clearMarkers();

  const list = document.getElementById("list");
  list.innerHTML = "";

  // 1) filtre week-end si sélectionné
  const filteredByWeekend = SELECTED_WEEKEND
    ? matches.filter(m => weekendIdFromKickoff(m.kickoff) === SELECTED_WEEKEND)
    : matches;

  // 2) calcul distance + filtre rayon + tri
  const processed = filteredByWeekend
    .map(match => {
      const distance = haversineKm(
        CENTER.lat, CENTER.lon,
        match.venue.lat, match.venue.lon
      );
      return { match, distance };
    })
    .filter(obj => obj.distance <= RADIUS_KM)
    .sort((a, b) => a.distance - b.distance);

  // 3) affichage
  processed.forEach(obj => {
    const m = obj.match;
    const d = obj.distance;

    L.marker([m.venue.lat, m.venue.lon])
      .addTo(map)
      .bindPopup(
        `<b>${m.home} vs ${m.away}</b><br>
         ${m.venue.city}<br>
         ${d.toFixed(1)} km`
      );

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <b>${m.home}</b> vs <b>${m.away}</b><br>
      ${m.venue.city}<br>
      Distance : <b>${d.toFixed(1)} km</b>
    `;
    list.appendChild(div);
  });
}

// ---------- UI bindings ----------
function bindSearch(geocodes, matches) {
  const input = document.getElementById("q");

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();

    const found = geocodes.find(g =>
      g.q.toLowerCase() === q ||
      g.label.toLowerCase().includes(q)
    );

    if (!found) return;

    CENTER = { lat: found.lat, lon: found.lon };
    map.setView([CENTER.lat, CENTER.lon], 10);

    showMatches(matches);
  });
}

function bindRadius(matches) {
  const slider = document.getElementById("radius");
  const label = document.getElementById("radiusValue");

  RADIUS_KM = Number(slider.value);
  label.textContent = slider.value;

  slider.addEventListener("input", () => {
    RADIUS_KM = Number(slider.value);
    label.textContent = slider.value;
    showMatches(matches);
  });
}

function buildWeekendSelect(matches) {
  const select = document.getElementById("weekend");

  const ids = Array.from(new Set(matches.map(m => weekendIdFromKickoff(m.kickoff))))
    .sort((a, b) => a.localeCompare(b));

  select.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = labelWeekend(id);
    select.appendChild(opt);
  });

  // par défaut : le premier week-end disponible
  SELECTED_WEEKEND = ids[0] || null;
  if (SELECTED_WEEKEND) select.value = SELECTED_WEEKEND;
}

function bindWeekend(matches) {
  const select = document.getElementById("weekend");
  select.addEventListener("change", () => {
    SELECTED_WEEKEND = select.value;
    showMatches(matches);
  });
}

// ---------- Start ----------
async function start() {
  initMap();

  const matches = await loadMatches();
  const geocodes = await loadGeocodes();

  buildWeekendSelect(matches);

  showMatches(matches);
  bindSearch(geocodes, matches);
  bindRadius(matches);
  bindWeekend(matches);
}

document.addEventListener("DOMContentLoaded", start);
