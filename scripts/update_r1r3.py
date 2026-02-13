import json
import re
import unicodedata
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
OUT_DEBUG = ROOT / "data" / "debug_home_clubs.json"


DATE_RE = re.compile(
    r"(lun|mar|mer|jeu|ven|sam|dim)\s+(\d{1,2})\s+([a-zéèêëîïôöûüàç]+)\s+(\d{4})\s*[-–]\s*(\d{1,2})h(\d{2})",
    re.IGNORECASE
)

MONTHS = {
    "jan":1,"janv":1,
    "fev":2,"fév":2,
    "mar":3,"mars":3,
    "avr":4,
    "mai":5,
    "jui":6,"juin":6,
    "juil":7,
    "aou":8,"aoû":8,"aout":8,
    "sep":9,
    "oct":10,
    "nov":11,
    "dec":12,"déc":12
}


def norm(s):
    s = (s or "").upper().strip()
    s = s.replace("Œ", "OE").replace("Æ", "AE")
    s = "".join(c for c in unicodedata.normalize("NFD", s)
                if unicodedata.category(c) != "Mn")
    s = re.sub(r"[’'\.\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().replace(" ", "")


def fr_to_iso(line):
    line = line.replace("–", "-")
    m = DATE_RE.search(line)
    if not m:
        return None

    _, d, mon, y, h, mn = m.groups()
    mon = mon.lower()

    month = MONTHS.get(mon[:4]) or MONTHS.get(mon[:3])
    if not month:
        return None

    dt = datetime(int(y), month, int(d), int(h), int(mn))
    return dt.strftime("%Y-%m-%dT%H:%M:00+01:00")


def fetch_lines(url):
    r = requests.get(url, timeout=40)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    txt = soup.get_text("\n")
    return [x.strip() for x in txt.split("\n") if x.strip()]


def parse(lines, comp, url):
    matches = []
    i = 0

    while i < len(lines):
        iso = fr_to_iso(lines[i])
        if not iso:
            i += 1
            continue

        clubs = []

        for j in range(i+1, min(i+12, len(lines))):
            t = lines[j]

            if fr_to_iso(t):
                break

            if re.match(r"^\d+\s+\d+$", t):
                continue

            if len(t) < 3:
                continue

            clubs.append(t)
            if len(clubs) == 2:
                break

        if len(clubs) == 2:
            matches.append({
                "competition": comp,
                "competition_label": comp,
                "kickoff": iso,
                "home": clubs[0],
                "away": clubs[1],
                "source_url": url
            })

        i += 1

    return matches


def main():

    sources = json.loads(SOURCES_PATH.read_text())
    clubs = json.loads(CLUBS_PATH.read_text())

    clubs_norm = {norm(k): v for k, v in clubs.items()}

    raw = []

    for comp, urls in sources.items():
        for url in urls:
            if not url:
                continue
            lines = fetch_lines(url)
            raw.extend(parse(lines, comp, url))

    print("DEBUG raw matches =", len(raw))
    print("DEBUG clubs loaded =", len(clubs))

    # DEBUG SAMPLE CLUBS
    debug = []
    seen = set()
    for m in raw:
        k = norm(m["home"])
        if k not in seen:
            debug.append({"raw": m["home"], "norm": k})
            seen.add(k)
        if len(debug) >= 30:
            break

    OUT_DEBUG.write_text(json.dumps(debug, indent=2, ensure_ascii=False))

    missing = set()
    enriched = []

    for m in raw:
        key = norm(m["home"])

        if key not in clubs_norm:
            missing.add(m["home"])
            continue

        loc = clubs_norm[key]

        m["venue"] = {
            "city": loc["city"],
            "lat": loc["lat"],
            "lon": loc["lon"]
        }

        enriched.append(m)

    OUT_MATCHES.write_text(json.dumps({"season":"auto","matches":enriched},indent=2,ensure_ascii=False))
    OUT_MISSING.write_text(json.dumps(sorted(missing),indent=2,ensure_ascii=False))
    OUT_LAST.write_text(json.dumps({"last_update":datetime.now().isoformat()},indent=2))


if __name__ == "__main__":
    main()
