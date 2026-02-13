// Rend les matchs accessibles dans la console
window.allMatches = [];

let map;
let CENTER = { lat: 49.848, lon: 3.287 }; // Saint-Quentin par défaut
let RADIUS_KM = 60;
let SELECTED_WEEKEND = null;

const COMP_ORDER = ["N2", "N3", "R1", "R2", "R3", "CDF", "COUPE_LFHF"];
let ACTIVE_COMPETITIONS = new Set();

const $ = (id) => document.getElementById(id);

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

// ✅ Calcul du samedi du week-end du match (sam+dim), en local (pas UTC)
function weekendIdFromKickoff(iso) {
  const d = new Date(iso);
  const dow = d.getDay(); // 0 dim ... 6 sam
  const diffToSaturday = (dow === 0) ? -1 : (6 - dow);
  const sat = new Date(d);
  sat.setDate(d.getDate() + diffToSaturday);
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

// Anti-cache basé sur last_update.json
async function loadMatches() {
  let stamp = String(Date.now());
  try {
    const u = await fetch("data/last_update.json", { cache: "no-store" });
    const uj = await u.json();
    stamp = encodeURIComponent(uj.last_update || stamp);
  } catch (e) {
    // ok
  }

  const res = await fetch(`data/matches.json?v=${stamp}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch matches.json failed: ${res.status}`);
  const json = await res.json();
  return json.matches || [];
}

async function loadGeocodes() {
  try {
    const res = await fetch("data/geocodes-hdf.json", { cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function buildWeekendSelect(matches) {
  const select = $("weekend");
  if (!select) return;

  const ids = Array.from(new Set(matches.map(m => weekendIdFromKickoff(m.kickoff)))).sort();
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

function buildCompetitionChips(matches) {
  const wrap = $("competitions");
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
      showMatches(window.allMatches);
    };

    wrap.appendChild(b);
  });
}

function showMatches(matches) {
  if (!map) return;

  clearMarkers();
  const list = $("list");
  if (list) list.innerHTML = "";

  const filtered = matches
    .filter(m => !SELECTED_WEEKEND || weekendIdFromKickoff(m.kickoff) === SELECTED_WEEKEND)
    .filter(m => ACTIVE_COMPETITIONS.size === 0 || ACTIVE_COMPETITIONS.has(m.competition))
    .map(m => ({
      m,
      d: haversineKm(CENTER.lat, CENTER.lon, m.venue.lat, m.venue.lon)
    }))
    .filter(o => o.d <= RADIUS_KM)
    .sort((a, b) => a.d - b.d);

  const bounds = [];

  filtered.forEach(({ m, d }) => {
    L.marker([m.venue.lat, m.venue.lon])
      .addTo(map)
      .bindPopup(`<b>${m.home} vs ${m.away}</b><br>${m.competition} — ${m.venue.city}<br>${d.toFixed(1)} km`);

    bounds.push([m.venue.lat, m.venue.lon]);

    if (list) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <b>${m.home}</b> vs <b>${m.away}</b><br>
        ${m.competition} — ${m.venue.city}<br>
        Distance : <b>${d.toFixed(1)} km</b>
      `;
      list.appendChild(div);
    }
  });

  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
  else map.setView([CENTER.lat, CENTER.lon], 10);
}

function bindUI(geocodes) {
  const q = $("q");
  if (q) {
    q.addEventListener("input", () => {
      const v = q.value.trim().toLowerCase();
      const found = geocodes.find(g =>
        (g.q || "").toLowerCase() === v || (g.label || "").toLowerCase().includes(v)
      );
      if (!found) return;
      CENTER = { lat: found.lat, lon: found.lon };
      map.setView([CENTER.lat, CENTER.lon], 10);
      showMatches(window.allMatches);
    });
  }

  const radius = $("radius");
  const radiusValue = $("radiusValue");
  if (radius && radiusValue) {
    RADIUS_KM = Number(radius.value);
    radiusValue.textContent = radius.value;
    radius.addEventListener("input", () => {
      RADIUS_KM = Number(radius.value);
      radiusValue.textContent = radius.value;
      showMatches(window.allMatches);
    });
  }

  const weekend = $("weekend");
  if (weekend) {
    weekend.addEventListener("change", () => {
      SELECTED_WEEKEND = weekend.value;
      showMatches(window.allMatches);
    });
  }
}

async function start() {
  initMap();

  try {
    const matches = await loadMatches();
    window.allMatches = matches;
    console.log("Loaded matches:", matches.length);

    const geocodes = await loadGeocodes();

    buildWeekendSelect(matches);
    buildCompetitionChips(matches);
    bindUI(geocodes);

    showMatches(matches);
  } catch (e) {
    console.error(e);
    alert("Erreur de chargement des matchs. Ouvre la console (F12) pour voir le détail.");
  }
}

document.addEventListener("DOMContentLoaded", start);

