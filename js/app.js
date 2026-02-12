let map;

// Centre par défaut : Saint-Quentin
let CENTER = {
  lat: 49.848,
  lon: 3.287
};

let RADIUS_KM = 60;

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

  // ⭐ calcul + tri distance
  const processed = matches
    .map(match => {

      const distance = haversineKm(
        CENTER.lat,
        CENTER.lon,
        match.venue.lat,
        match.venue.lon
      );

      return { match, distance };

    })
    .filter(obj => obj.distance <= RADIUS_KM)
    .sort((a, b) => a.distance - b.distance);

  // ⭐ affichage
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
  bindRadius(matches);
  function bindRadius(matches) {

  const slider = document.getElementById("radius");
  const label = document.getElementById("radiusValue");

  label.textContent = slider.value;

  slider.addEventListener("input", () => {
    RADIUS_KM = Number(slider.value);
    label.textContent = slider.value;

    showMatches(matches);
  });
}

}

document.addEventListener("DOMContentLoaded", start);
