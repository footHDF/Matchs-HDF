let map;

const CENTER = {
  lat: 49.848,
  lon: 3.287
};

async function loadMatches() {
  const res = await fetch("data/matches.json");
  const json = await res.json();
  return json.matches;
}

function initMap() {
  map = L.map("map").setView([CENTER.lat, CENTER.lon], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function showMatches(matches) {
  const list = document.getElementById("list");
  list.innerHTML = "";

  matches.forEach(match => {

  const distance = haversineKm(
    CENTER.lat,
    CENTER.lon,
    match.venue.lat,
    match.venue.lon
  );

  if (distance > 60) return;



    L.marker([match.venue.lat, match.venue.lon])
      .addTo(map)
      .bindPopup(
        match.home + " vs " + match.away +
        "<br>" +
        distance.toFixed(1) + " km"
      );

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

async function start() {
  initMap();
  const matches = await loadMatches();
  showMatches(matches);
}

document.addEventListener("DOMContentLoaded", start);
