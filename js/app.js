let map;

// Centre par défaut : Saint-Quentin
let CENTER = {
  lat: 49.848,
  lon: 3.287
};

const RADIUS_KM = 60;

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

// ---------- Carte ----------

function initMap() {
  map = L.map("map").setView([CENTER.lat, CENTER.lon], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

// Supprime tous les marqueurs
function clearMarkers() {
  map.eachLayer(layer => {
    if (layer instanceof L.Marker) {
      map.removeLayer(layer);
    }
  });
}

// ---------- Affichage ----------

function showMatches(matches) {

  clearMarkers();

  const list = document.getElementById("list");
  list.innerHTML = "";

  matches.forEach(match => {

    const distance = haversineKm(
      CENTER.lat,
      CENTER.lon,
      match.venue.lat,
      match.venue.lon
    );

    // ⭐ filtre rayon
    if (distance > RADIUS_KM) return;

    // ⭐ marqueur carte
    L.marker([match.venue.lat, match.venue.lon])
      .addTo(map)
      .bindPopup(
        `<b>${match.home} vs ${match.away}</b><br>
         ${match.venue.city}<br>
         ${distance.toFixed(1)} km`
      );

    // ⭐ liste gauche
    const div = document.createElement("div");
    div.className = "item";

    div.innerHTML = `
      <b>${match.home}</b> vs <b>${match.away}</b><br>
      ${match.venue.city}<br>
      Distance : <b>${distance.toFixed(1)} km</b>
    `;

    list.appendChild(div);
  });
}

// ---------- Recherche utilisateur ----------

function bindSearch(geocodes, matches) {

  const input = document.getElementById("q");

  input.addEventListener("input", () => {

    const q = input.value.toLowerCase();

    const found = geocodes.find(g =>
      g.q.toLowerCase() === q ||
      g.label.toLowerCase().includes(q)
    );

    if (!found) return;

    CENTER.lat = found.lat;
    CENTER.lon = found.lon;

    map.setView([CENTER.lat, CENTER.lon], 10);

    showMatches(matches);
  });
}

// ---------- Start ----------

async function start() {
  initMap();

  const matches = await loadMatches();
  const geocodes = await loadGeocodes();

  showMatches(matches);
  bindSearch(geocodes, matches);
}

document.addEventListener("DOMContentLoaded", start);
