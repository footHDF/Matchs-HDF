import json
import re
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "scripts" / "sources_r1r3.json"
CLUBS_PATH = ROOT / "data" / "club_locations.json"

OUT_MATCHES = ROOT / "data" / "matches.json"
OUT_MISSING = ROOT / "data" / "missing_clubs.json"
OUT_LAST = ROOT / "data" / "last_update.json"

USER_AGENT = "Matchs-HDF bot (GitHub Actions) - contact: actions@users.noreply.github.com"

# Ex: "sam 07 fév 2026 - 18h00" / parfois "sam 07 fev 2026 - 18h00"
DATE_RE = re.compile(
    r"^(lun|mar|mer|jeu|ven|sam|dim)\s+(\d{2})\s+([a-zéèêëîïôöûüàç\.]+)\s+(\d{4})\s*-\s*(\d{2})h(\d{2})$",
    re.IGNORECASE
)

MONTHS = {
    "jan": 1, "janv": 1,
    "fev": 2, "fév": 2, "fevr": 2, "févr": 2,
    "mar": 3, "mars": 3,
    "avr": 4, "avri": 4,
    "mai": 5,
    "jui": 6, "juin": 6,
    "juil": 7, "jui.": 7,
    "aou": 8, "aoû": 8, "aout": 8, "août": 8,
    "sep": 9, "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12, "déc": 12
}

def norm(s: str) -> str:
    """Normalisation tolérante pour matcher les noms de clubs malgré variations."""
    s = (s or "").upper().strip()
    s = s.replace("\u00A0", " ")  # nbsp
    s = re.sub(r"[’']", " ", s)
    s = re.sub(r"[\.\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def fr_date_line_to_iso(line: str) -> str | None:
    m = DATE_RE.match(line.strip())
    if not m:
        return None
    _, dd, mon, yyyy, hh, mm = m.groups()
    mon = mon.lower().replace(".", "")
    key4 = mon[:4]
    key3 = mon[:3]
    month = MONTHS.get(key4) or MONTHS.get(key3)
    if not month:
        return None

    # Note: on force +01:00 (CET) ; pour l’été on pourra améliorer si besoin.
    dt = datetime(int(yyyy), int(month), int(dd), int(hh), int(mm))
    return dt.strftime("%Y-%m-%dT%H:%M:00+01:00")

def fetch_text_lines(url: str) -> list[str]:
    r = requests.get(url, timeout=45, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    # On récupère du texte “plat” (robuste aux changements de structure)
    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.split("\n")]
    return [ln for ln in lines if ln]

def parse_matches(lines: list[str], competition_code: str, source_url: str) -> list[dict]:
    """
    Parsing robuste :
    - repère une ligne date
    - prend home = ligne suivante
    - saute éventuellement score/infos
    - prend away = ligne 3 après (souvent)
    """
    out = []
    i = 0
    while i < len(lines):
        iso = fr_date_line_to_iso(lines[i])
        if not iso:
            i += 1
            continue

        home = lines[i + 1] if i + 1 < len(lines) else ""
        mid  = lines[i + 2] if i + 2 < len(lines) else ""
        away = lines[i + 3] if i + 3 < len(lines) else ""

        # Heuristique : parfois (home, away) sont collés autrement ; on fait un mini fallback
        if not home or not away:
            i += 1
            continue

        # Filtre anti-bruit : éviter de capturer des titres
        if len(home) < 3 or len(away) < 3:
            i += 1
            continue

        out.append({
            "competition": competition_code,
            "competition_label": competition_code,
            "kickoff": iso,
            "home": home,
            "away": away,
            "source": "FFF/EPREUVES",
            "source_url": source_url
        })
        i += 1
    return out

def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def main():
    sources = load_json(SOURCES_PATH, {})
    clubs = load_json(CLUBS_PATH, {})

    # index normalisé -> entrée
    clubs_norm = {norm(name): (name, data) for name, data in clubs.items()}

    raw_matches = []
    for comp, urls in sources.items():
        for url in urls:
            if not url or "COLLE_URL" in url:
                continue
            lines = fetch_text_lines(url)
            raw_matches.extend(parse_matches(lines, comp, url))

    # Dédoublonnage
    uniq = {}
    for m in raw_matches:
        key = (m["competition"], m["kickoff"], norm(m["home"]), norm(m["away"]))
        uniq[key] = m
    raw_matches = list(uniq.values())

    enriched = []
    missing = set()

    for m in raw_matches:
        home_key = norm(m["home"])
        found = clubs_norm.get(home_key)

        if not found:
            # club domicile inconnu => on le note, on n’inclut pas le match dans matches.json (sinon ta carte casse)
            missing.add(m["home"])
            continue

        _, loc = found
        venue = {
            "name": "",
            "city": loc.get("city", ""),
            "postcode": loc.get("postcode", ""),
            "lat": float(loc["lat"]),
            "lon": float(loc["lon"])
        }

        enriched.append({
            "id": f'{m["competition"]}_{m["kickoff"]}_{norm(m["home"])}_{norm(m["away"])}',
            **m,
            "venue": venue
        })

    # Tri par date
    enriched.sort(key=lambda x: x["kickoff"])

    OUT_MATCHES.write_text(
        json.dumps({"season": "auto", "matches": enriched}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    OUT_MISSING.write_text(
        json.dumps(sorted(missing), ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    OUT_LAST.write_text(
        json.dumps({"last_update": datetime.now().strftime("%Y-%m-%d %H:%M")}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"OK: {len(enriched)} matchs écrits dans data/matches.json")
    print(f"INFO: {len(missing)} clubs manquants listés dans data/missing_clubs.json")

if __name__ == "__main__":
    main()
