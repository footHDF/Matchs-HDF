import json
import re
import unicodedata
from datetime import datetime, date, timedelta
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

# Supporte "sam 07 fév 2026 - 18h00" ET "dimanche 24 août 2025 - 15H00"
DATE_RE = re.compile(
    r"(lun(?:di)?|mar(?:di)?|mer(?:credi)?|jeu(?:di)?|ven(?:dredi)?|sam(?:edi)?|dim(?:anche)?)\s+"
    r"(\d{1,2})\s+([a-zéèêëîïôöûüàç]+)\s+(\d{4})\s*[-–]\s*"
    r"(\d{1,2})\s*[hH]\s*(\d{2})",
    re.IGNORECASE
)

MONTHS = {
    "jan": 1, "janv": 1, "janvier": 1,
    "fev": 2, "fév": 2, "fevr": 2, "févr": 2, "fevrier": 2, "février": 2,
    "mar": 3, "mars": 3,
    "avr": 4, "avril": 4,
    "mai": 5,
    "jui": 6, "juin": 6,
    "juil": 7, "juillet": 7,
    "aou": 8, "aoû": 8, "aout": 8, "août": 8,
    "sep": 9, "sept": 9, "septembre": 9,
    "oct": 10, "octobre": 10,
    "nov": 11, "novembre": 11,
    "dec": 12, "déc": 12, "decembre": 12, "décembre": 12
}

def norm(s: str) -> str:
    s = (s or "").upper().strip()
    s = s.replace("Œ", "OE").replace("Æ", "AE")
    s = "".join(c for c in unicodedata.normalize("NFD", s)
                if unicodedata.category(c) != "Mn")
    s = re.sub(r"[’'\.\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.replace(" ", "")

def fr_to_iso(line: str) -> str | None:
    line = (line or "").replace("–", "-")
    m = DATE_RE.search(line)
    if not m:
        return None

    _, d, mon, y, h, mn = m.groups()
    mon = mon.lower().strip()

    # normalise accents pour lookup mois
    mon_n = "".join(c for c in unicodedata.normalize("NFD", mon)
                    if unicodedata.category(c) != "Mn")

    key4 = mon_n[:4]
    key3 = mon_n[:3]
    month = MONTHS.get(mon_n) or MONTHS.get(key4) or MONTHS.get(key3)
    if not month:
        return None

    dt = datetime(int(y), month, int(d), int(h), int(mn))
    # On fixe +01:00 pour rester cohérent avec ton site (et éviter les soucis DST côté UI)
    return dt.strftime("%Y-%m-%dT%H:%M:00+01:00")

def fetch_lines(url: str) -> list[str]:
    r = requests.get(url, timeout=45, headers={"User-Agent": "Matchs-HDF (GitHub Actions)"})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    txt = soup.get_text("\n")
    return [x.strip() for x in txt.split("\n") if x.strip()]

def parse(lines: list[str], comp: str, url: str) -> list[dict]:
    matches = []
    i = 0
    while i < len(lines):
        iso = fr_to_iso(lines[i])
        if not iso:
            i += 1
            continue

        clubs = []
        for j in range(i + 1, min(i + 16, len(lines))):
            t = lines[j]
            if fr_to_iso(t):
                break
            # ignore score/forfait bruit
            if re.match(r"^\d+\s+\d+$", t):
                continue
            if "FORFAIT" in t.upper() and len(t) > 25:
                # exemple "LENS RC 2 Forfait général" => garde le club sans "forfait"
                t = re.sub(r"\bFORFAIT.*$", "", t, flags=re.IGNORECASE).strip()
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

def season_bounds(today: date) -> tuple[date, date]:
    # Saison FR : août -> juin
    if today.month >= 7:
        start = date(today.year, 8, 1)
        end = date(today.year + 1, 6, 30)
    else:
        start = date(today.year - 1, 8, 1)
        end = date(today.year, 6, 30)
    return start, end

def week_ranges(start: date, end: date) -> list[tuple[date, date]]:
    # semaine lun->dim (beginWeek/endweek)
    d = start
    # aligne au lundi
    d = d - timedelta(days=(d.weekday()))
    ranges = []
    while d <= end:
        begin = d
        finish = d + timedelta(days=6)
        ranges.append((begin, finish))
        d += timedelta(days=7)
    return ranges

def fmt_fr(d: date) -> str:
    return d.strftime("%d/%m/%Y")

def expand_weekly_urls(url_template: str, start: date, end: date) -> list[str]:
    if "{BEGIN}" not in url_template and "{END}" not in url_template:
        return [url_template]

    urls = []
    for b, e in week_ranges(start, end):
        urls.append(
            url_template.replace("{BEGIN}", fmt_fr(b)).replace("{END}", fmt_fr(e))
        )
    return urls

def main():
    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    clubs = json.loads(CLUBS_PATH.read_text(encoding="utf-8"))
    clubs_norm = {norm(k): v for k, v in clubs.items()}

    start, end = season_bounds(date.today())

    raw = []
    for comp, url_list in sources.items():
        for u in (url_list or []):
            for url in expand_weekly_urls(u, start, end):
                lines = fetch_lines(url)
                raw.extend(parse(lines, comp, url))

    # debug: 30 clubs domicile uniques
    debug = []
    seen = set()
    for m in raw:
        k = norm(m["home"])
        if k not in seen:
            debug.append({"raw": m["home"], "norm": k})
            seen.add(k)
        if len(debug) >= 30:
            break
    OUT_DEBUG.write_text(json.dumps(debug, ensure_ascii=False, indent=2), encoding="utf-8")

    missing = set()
    enriched = []

    for m in raw:
        key = norm(m["home"])
        if key not in clubs_norm:
            missing.add(m["home"])
            continue

        loc = clubs_norm[key]
        m["venue"] = {"city": loc["city"], "lat": loc["lat"], "lon": loc["lon"]}
        enriched.append(m)

    OUT_MATCHES.write_text(json.dumps({"season": "auto", "matches": enriched}, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_MISSING.write_text(json.dumps(sorted(missing), ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_LAST.write_text(json.dumps({"last_update": datetime.now().isoformat()}, ensure_ascii=False, indent=2), encoding="utf-8")

    print("DEBUG raw matches =", len(raw))
    print("DEBUG enriched matches =", len(enriched))
    print("DEBUG missing clubs =", len(missing))

if __name__ == "__main__":
    main()
