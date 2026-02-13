let map;

let CENTER = { lat: 49.848, lon: 3.287 }; // défaut Saint-Quentin
let RADIUS_KM = 60;
let SELECTED_WEEKEND = null;

// Ordre métier des compétitions (toujours dans cet ordre)
const COMP_ORDER = ["N2", "N3", "R1", "R2", "R3", "CDF", "COUPE_LFHF"];
let ACTIVE_COMPETITIONS = new Set();

async function loadMatches() {
  // 1) on lit le timestamp de mise à jour généré par l’action
  let stamp = "0";
  try {
    const u = await fetch("data/last_update.json", { cache: "no-store" });
    const uj = await u.json();
    stamp = encodeURIComponent(uj.last_update || "0");
  } catch (e) {
    // si jamais last_update n’existe pas, on continue quand même
    stamp = String(Date.now());
  }

  // 2) on charge matches.json en ajoutant un paramètre -> plus de cache
  const res = await fetch(`data/matches.json?v=${stamp}`, { cache: "no-store" });
  const json = await res.json();
  return json.matches || [];
}


async function loadGeocodes() {
  const res = await fetch("data/geocodes-hdf.json");
  return await res.json();
}

// ---------- Week-end (samedi du week-end du match) ----------
function weekendIdFromKickoff(iso) {
  // iso exemple: "2026-02-14T18:00:00+01:00"
  const d = new Date(iso);

  // getDay(): 0=dim,1=lun,...,6=sam
  const dow = d.getDay();

  // On veut le samedi du week-end "samedi+dimanche"
  // - si c'est dimanche (0) -> samedi veille
  // - sinon -> prochain samedi de la semaine
  const diffToSaturday = (dow === 0) ? -1 : (6 - dow);

  const sat = new Date(d);
  sat.setDate(d.getDate() + diffToSaturday);
  sat.setHours(0, 0, 0, 0);

  // IMPORTANT: format local (pas toISOString)
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
    maxZoom: 19,
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
  if (!map) return;

  clearMarkers();

  const list = document.getElementById("list");
  list.innerHTML = "";

  // 1) filtre week-end
  let filtered = SELECTED_WEEKEND
    ? matches.filter(m => weekendIdFromKickoff(m.kickoff) === SELECTED_WEEKEND)
    : matches;

  // 2) filtre compétitions
  filtered = filtered.filter(m =>
    ACTIVE_COMPETITIONS.size === 0 || ACTIVE_COMPETITIONS.has(m.competition)
  );

  // 3) calc distance + filtre rayon + tri
  const processed = filtered
    .map(m => {
      const d = haversineKm(CENTER.lat, CENTER.lon, m.venue.lat, m.venue.lon);
      return { m, d };
    })
    .filter(o => o.d <= RADIUS_KM)
    .sort((a, b) => a.d - b.d);

  const bounds = [];

  processed.forEach(({ m, d }) => {
    // marqueur
    L.marker([m.venue.lat, m.venue.lon])
      .addTo(map)
      .bindPopup(
        `<b>${m.home} vs ${m.away}</b><br>${m.competition}<br>${m.venue.city}<br>${d.toFixed(1)} km`
      );

    bounds.push([m.venue.lat, m.venue.lon]);

    // liste
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <b>${m.home}</b> vs <b>${m.away}</b><br>
      ${m.competition} — ${m.venue.city}<br>
      Distance : <b>${d.toFixed(1)} km</b>
    `;
    list.appendChild(div);
  });

  // auto-zoom sur les résultats
  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40] });
  } else {
    map.setView([CENTER.lat, CENTER.lon], 10);
  }
}

// ---------- UI ----------
function bindSearch(geocodes, matches) {
  const input = document.getElementById("q");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const found = geocodes.find(g =>
      (g.q || "").toLowerCase() === q || (g.label || "").toLowerCase().includes(q)
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
  if (!select) return;

  const ids = Array.from(new Set(matches.map(m => weekendIdFromKickoff(m.kickoff))))
    .sort((a, b) => a.localeCompare(b));

  select.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = labelWeekend(id);
    select.appendChild(opt);
  });

  SELECTED_WEEKEND = ids[0] || null;
  if (SELECTED_WEEKEND) select.value = SELECTED_WEEKEND;
}

function bindWeekend(matches) {
  const select = document.getElementById("weekend");
  if (!select) return;

  select.addEventListener("change", () => {
    SELECTED_WEEKEND = select.value;
    showMatches(matches);
  });
}

function buildCompetitionChips(matches) {
  const wrap = document.getElementById("competitions");
  if (!wrap) return;

  wrap.innerHTML = "";
  const present = new Set(matches.map(m => m.competition));

  COMP_ORDER.forEach(code => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = code;

    if (!present.has(code)) {
      b.classList.add("disabled");
      b.disabled = true;
      wrap.appendChild(b);
      return;
    }

    b.onclick = () => {
      if (ACTIVE_COMPETITIONS.has(code)) {
        ACTIVE_COMPETITIONS.delete(code);
        b.classList.remove("on");
      } else {
        ACTIVE_COMPETITIONS.add(code);
        b.classList.add("on");
      }
      showMatches(matches);
    };

    wrap.appendChild(b);
  });
}

// ---------- Start ----------
async function start() {
  initMap();

  const matches = await loadMatches();
  const geocodes = await loadGeocodes();

  buildWeekendSelect(matches);
  buildCompetitionChips(matches);

  showMatches(matches);

  bindSearch(geocodes, matches);
  bindRadius(matches);
  bindWeekend(matches);
}

document.addEventListener("DOMContentLoaded", start);
