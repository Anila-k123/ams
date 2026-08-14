#!/usr/bin/env python3
"""
Madras High Court display board scraper.

The board is server-rendered as Bootstrap cards (one per court), so plain
requests + BeautifulSoup is enough — no Selenium needed.

Extracts per court card:
    court_number   "01", "45", "II"        (Roman for Master's courts)
    item_number    "61", "12/L2", ""       ("" when the list is over)
    judge          full coram string
    judges         coram split into a list
    case_string    "CONT P.872/2026"       ("" when the list is over)
    status         "listed" | "list_over"

Usage
-----
    python madras.py --once                          # print current board
    python madras.py --once --json                   # machine-readable
    python madras.py --bench madurai --once
    python madras.py --interval 60 --csv board_log.csv --snapshot latest.json
    python madras.py --self-test                     # parse a built-in fixture

Install
-------
    pip install requests beautifulsoup4
    pip install truststore     # recommended on Windows, fixes gov SSL chains
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import re
import signal
import sys
import time
from dataclasses import dataclass, asdict, field
from datetime import datetime
from typing import Iterable, Sequence

import requests
from bs4 import BeautifulSoup

# Windows: use the OS trust store, which does AIA chasing for the missing
# intermediate certs that Indian government hosts often fail to serve.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

BENCHES = {
    "chennai": "https://hcmadras.tn.gov.in/display_board_mhc.php",
    "madurai": "https://hcmadras.tn.gov.in/display_board_mdu.php",
}

# NIC-hosted government sites often serve different markup (or a block page)
# to non-browser user agents, so present as a normal browser by default.
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36")

HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

HOME_URL = "https://hcmadras.tn.gov.in/index.php"

REQUEST_TIMEOUT = 30
MIN_INTERVAL = 20  # hard floor; don't hammer the court's server

log = logging.getLogger("mhc")


# html.parser first, deliberately. The board's markup contains invalid
# attributes (each judge <img> carries a stray '"=""'), and some libxml2
# versions abandon the tree instead of recovering, yielding zero elements.
# html.parser is slower but far more forgiving, and at one page per minute
# the speed difference is irrelevant.
PARSER_CANDIDATES = ["html.parser", "lxml"]


def available_parsers() -> list[str]:
    out = []
    for name in PARSER_CANDIDATES:
        try:
            BeautifulSoup("<b></b>", name)
            out.append(name)
        except Exception:
            continue
    return out or ["html.parser"]


# --------------------------------------------------------------------------
# Patterns
# --------------------------------------------------------------------------
# Court numbers are arabic ("01", "45") or roman ("II", "III").
COURT_RE = re.compile(r"court\s*no\.?\s*:?\s*([0-9]{1,3}[A-Za-z]?|[IVXLCDM]{1,6})\b", re.I)

# Item may be "61", "12/L2", "35/L1", or the literal "List over".
ITEM_RE = re.compile(r"item\s*no\.?\s*:?\s*(.+?)\s*$", re.I)

BOARD_DATE_RE = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")

LIST_OVER_RE = re.compile(r"list\s*over", re.I)

# Coram strings join judges with " and ".
CORAM_SPLIT_RE = re.compile(r"\s+and\s+", re.I)


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


# --------------------------------------------------------------------------
# Row model
# --------------------------------------------------------------------------
@dataclass
class BoardRow:
    court_number: str = ""
    item_number: str = ""
    judge: str = ""
    case_string: str = ""
    status: str = "listed"
    judges: list[str] = field(default_factory=list)
    board_date: str = ""
    bench: str = ""
    scraped_at: str = field(
        default_factory=lambda: datetime.now().isoformat(timespec="seconds")
    )

    def key(self) -> tuple:
        """Identity of a listing, ignoring timestamp — used for change detection."""
        return (self.bench, self.court_number, self.item_number,
                self.case_string, self.status)

    @property
    def court_sort(self) -> tuple:
        """Numeric courts first in order, then roman/other alphabetically."""
        raw = self.court_number
        if raw.isdigit():
            return (0, int(raw), "")
        return (1, 0, raw)


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def _split_coram(coram: str) -> list[str]:
    """'Hon'ble X and Hon'ble Mr.Justice Y' -> ['Hon'ble X', 'Hon'ble Mr.Justice Y']"""
    parts = [normalise(p) for p in CORAM_SPLIT_RE.split(coram)]
    return [p for p in parts if p]


def _find_cards(soup) -> list:
    """One card per court. find_all(class_=...) is pure bs4 — no soupsieve
    dependency — and matches a single class inside 'mainflip flip-0'."""
    return (soup.find_all("div", class_="mainflip")
            or soup.find_all("div", class_="frontside"))


def _soup_with_cards(html: str) -> tuple:
    """
    Try each available tree builder and keep the first that actually finds
    cards. A parser that returns an empty tree on malformed markup would
    otherwise look identical to 'the board is empty today'.
    """
    attempts: list[tuple[str, int]] = []
    best = None
    for name in available_parsers():
        try:
            soup = BeautifulSoup(html, name)
        except Exception as exc:  # noqa: BLE001
            log.debug("parser %s unavailable: %s", name, exc)
            continue
        cards = _find_cards(soup)
        attempts.append((name, len(cards)))
        if cards:
            if name != attempts[0][0]:
                log.warning("parser %r found no cards; using %r instead",
                            attempts[0][0], name)
            return soup, cards, name
        if best is None:
            best = (soup, cards, name)
    if attempts and all(n == 0 for _, n in attempts):
        log.error("no court cards found with any parser %s — the page layout "
                  "may have changed, or the fetch returned something else",
                  attempts)
    return best or (BeautifulSoup(html, "html.parser"), [], "html.parser")


def parse_board(html: str, bench: str = "") -> list[BoardRow]:
    soup, cards, _parser = _soup_with_cards(html)

    board_date = ""
    heading = soup.find("h5", class_="section-title")
    if heading:
        m = BOARD_DATE_RE.search(normalise(heading.get_text(" ")))
        if m:
            board_date = m.group(1)

    rows: list[BoardRow] = []

    for card in cards:
        row = BoardRow(bench=bench, board_date=board_date)

        # h4 tags hold the coram and the item number. Note: the duplicate
        # "Item No" h4 lives inside an HTML comment, which bs4 does not
        # return from find_all(), so there is no double-match here.
        for h4 in card.find_all("h4"):
            text = normalise(h4.get_text(" "))
            if not text:
                continue
            m = ITEM_RE.search(text)
            if m:
                if not row.item_number:
                    row.item_number = m.group(1)
            elif not row.judge:
                row.judge = text

        for p in card.find_all("p"):
            m = COURT_RE.search(normalise(p.get_text(" ")))
            if m:
                row.court_number = m.group(1)
                break

        # Case number sits in the red button. Absent when the list is over.
        link = card.find("a", class_="btn-primary")
        if link:
            row.case_string = normalise(link.get_text(" "))

        if LIST_OVER_RE.search(row.item_number):
            row.status = "list_over"
            row.item_number = ""

        row.judges = _split_coram(row.judge)

        # A card with neither a court number nor a coram is theme scaffolding.
        if row.court_number or row.judge:
            rows.append(row)

    rows.sort(key=lambda r: r.court_sort)
    return rows


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------
class Fetcher:
    def __init__(self, verify: bool = True, warmup: bool = True,
                 user_agent: str | None = None):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        if user_agent:
            self.session.headers["User-Agent"] = user_agent
        self.session.verify = verify
        self._warmup_pending = warmup
        if not verify:
            import urllib3

            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    def _warmup(self) -> None:
        """Visit the homepage once so any session cookie gets established."""
        self._warmup_pending = False
        try:
            self.session.get(HOME_URL, timeout=REQUEST_TIMEOUT)
            log.debug("warmup ok, cookies: %s", list(self.session.cookies.keys()))
        except Exception as exc:  # noqa: BLE001
            log.debug("warmup failed (continuing anyway): %s", exc)

    def get(self, url: str, retries: int = 2) -> str:
        if self._warmup_pending:
            self._warmup()
            self.session.headers["Referer"] = HOME_URL
        last: Exception | None = None
        for attempt in range(retries + 1):
            try:
                r = self.session.get(url, timeout=REQUEST_TIMEOUT)
                r.raise_for_status()
                # Only guess when requests fell back to its ISO-8859-1
                # default for a missing charset header.
                if not r.encoding or r.encoding.lower() == "iso-8859-1":
                    r.encoding = r.apparent_encoding or "utf-8"
                return r.text
            except Exception as exc:  # noqa: BLE001
                last = exc
                if attempt < retries:
                    time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"failed to fetch {url}: {last}")


# --------------------------------------------------------------------------
# Diagnostics
# --------------------------------------------------------------------------
def diagnose(html: str) -> None:
    """Explain why a fetch produced no cards."""
    print("\n--- diagnostics ---")
    print(f"response length : {len(html)} chars")
    for needle in ("mainflip", "Court No", "Item No", "section-title",
                   "btn-primary", "display_board"):
        print(f"contains {needle!r:18}: {needle in html}")

    soup = BeautifulSoup(html, PARSER)
    title = soup.find("title")
    print(f"page <title>    : {normalise(title.get_text()) if title else '(none)'}")
    body = soup.find("body")
    if body:
        text = normalise(body.get_text(" "))
        print(f"body text (400) : {text[:400]}")
    print("--- end diagnostics ---")
    print("\nIf the page looks like a block/error page, or is much shorter than")
    print("~60KB, the server is treating the request differently from your")
    print("browser. Try --ua to change the User-Agent, or --html with a copy")
    print("saved from the browser to confirm the parser itself is fine.\n")


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
CSV_FIELDS = ["scraped_at", "board_date", "bench", "court_number",
              "item_number", "status", "judge", "case_string"]


def append_csv(path: str, rows: Iterable[BoardRow]) -> None:
    fresh = not os.path.exists(path) or os.path.getsize(path) == 0
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS, extrasaction="ignore")
        if fresh:
            w.writeheader()
        for r in rows:
            w.writerow(asdict(r))


def write_snapshot(path: str, rows: Sequence[BoardRow]) -> None:
    payload = {
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "board_date": rows[0].board_date if rows else "",
        "count": len(rows),
        "rows": [asdict(r) for r in rows],
    }
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def print_rows(rows: Sequence[BoardRow]) -> None:
    if not rows:
        print("(no cards parsed — the page layout may have changed)")
        return
    print(f"\nBoard date: {rows[0].board_date or '?'}   courts: {len(rows)}")
    print(f"{'Court':<7}{'Item':<10}{'Case':<22}Judge(s)")
    print("-" * 108)
    for r in rows:
        item = r.item_number or ("LIST OVER" if r.status == "list_over" else "-")
        print(f"{r.court_number:<7}{item:<10}{(r.case_string or '-'):<22}{r.judge[:56]}")
    over = sum(1 for r in rows if r.status == "list_over")
    print(f"\n{len(rows)} courts, {over} with list over")


# --------------------------------------------------------------------------
# Self test against a fixture covering the tricky cases
# --------------------------------------------------------------------------
FIXTURE = """
<h5 class="section-title h1">10/08/2026 High Court of Madras Display board
  <span id="ct6">3:4:48: PM</span></h5>
<div class="row">
  <div class="col-md-3"><div class="mainflip flip-0"><div class="frontside"><div>
    <h4>Hon'ble The CHIEF JUSTICE and Hon'ble  Mr.Justice G.ARUL MURUGAN</h4>
    <p style="font-size: 26px;font-weight: bold;">Court No : 01 </p>
    <p><br></p><p><img src="x"></p>
    <!--<h4 class="card-title1">Item No : 61</h4>-->
    <h4>Item No : 61</h4>
    <a href="#" class="btn btn-primary btn-sm">CONT P.872/2026</a>
  </div></div></div></div>

  <div class="col-md-3"><div class="mainflip flip-0"><div class="frontside"><div>
    <h4>Hon'ble  Mr Justice KRISHNAN RAMASAMY</h4>
    <p style="font-size: 26px;font-weight: bold;">Court No : 10 </p>
    <h4>Item No : 12/L2</h4>
    <a href="#" class="btn btn-primary btn-sm">WMP.52846/2025</a>
  </div></div></div></div>

  <div class="col-md-3"><div class="mainflip flip-0"><div class="frontside"><div>
    <h4>Hon'ble Mr.Justice R.RAJESH VIVEKANANTHAN</h4>
    <p style="font-size: 26px;font-weight: bold;">Court No : 18 </p>
    <!--<h4 class="card-title1">Item No : List over</h4>-->
    <h4>Item No : List over</h4>
  </div></div></div></div>

  <div class="col-md-3"><div class="mainflip flip-0"><div class="frontside"><div>
    <h4>Hon'ble Mr.Justice T. VINOD KUMAR</h4>
    <p style="font-size: 26px;font-weight: bold;">Court No : II </p>
    <h4>Item No : 6</h4>
    <a href="#" class="btn btn-primary btn-sm">WP.9217/2009</a>
  </div></div></div></div>
</div>
"""


def self_test() -> int:
    rows = parse_board(FIXTURE, bench="chennai")
    print_rows(rows)

    failures: list[str] = []

    def check(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)

    check(len(rows) == 4, f"expected 4 cards, got {len(rows)}")
    by_court = {r.court_number: r for r in rows}

    check(rows[0].board_date == "10/08/2026", "board date not parsed")

    c1 = by_court.get("01")
    check(c1 is not None, "court 01 missing")
    if c1:
        check(c1.item_number == "61", f"court 01 item -> {c1.item_number!r}")
        check(c1.case_string == "CONT P.872/2026", f"court 01 case -> {c1.case_string!r}")
        check(len(c1.judges) == 2, f"court 01 coram split -> {c1.judges}")
        check("CHIEF JUSTICE" in c1.judge, "court 01 coram lost")

    c10 = by_court.get("10")
    if c10:
        check(c10.item_number == "12/L2", f"court 10 item -> {c10.item_number!r}")

    c18 = by_court.get("18")
    if c18:
        check(c18.status == "list_over", f"court 18 status -> {c18.status!r}")
        check(c18.item_number == "", f"court 18 item should be blank -> {c18.item_number!r}")
        check(c18.case_string == "", f"court 18 case should be blank -> {c18.case_string!r}")

    cii = by_court.get("II")
    check(cii is not None, "roman-numeral court II not parsed")
    if cii:
        check(cii.case_string == "WP.9217/2009", f"court II case -> {cii.case_string!r}")

    # Roman courts must sort after numeric ones.
    check([r.court_number for r in rows] == ["01", "10", "18", "II"],
          f"sort order -> {[r.court_number for r in rows]}")

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("all checks passed")
    return 0


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
_stop = False


def _handle_sigint(*_a):
    global _stop
    _stop = True
    print("\nstopping after this cycle...")


def main() -> int:
    p = argparse.ArgumentParser(description="Madras HC display board scraper")
    p.add_argument("--bench", choices=sorted(BENCHES), default="chennai")
    p.add_argument("--url", help="override the bench URL")
    p.add_argument("--once", action="store_true", help="single scrape then exit")
    p.add_argument("--interval", type=int, default=60, help="seconds between polls")
    p.add_argument("--csv", help="append changed listings to this CSV")
    p.add_argument("--snapshot", help="write current board to this JSON each poll")
    p.add_argument("--json", action="store_true", help="print JSON instead of a table")
    p.add_argument("--insecure", action="store_true",
                   help="skip TLS verification (broken gov cert chains)")
    p.add_argument("--html", help="parse a saved HTML file instead of fetching")
    p.add_argument("--dump", help="save the fetched HTML to this file for inspection")
    p.add_argument("--ua", help="override the User-Agent string")
    p.add_argument("--no-warmup", action="store_true",
                   help="skip the homepage cookie warm-up request")
    p.add_argument("--self-test", action="store_true", help="run the built-in fixture test")
    p.add_argument("--quiet", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.self_test:
        return self_test()

    if args.html:
        with open(args.html, encoding="utf-8", errors="replace") as fh:
            rows = parse_board(fh.read(), bench=args.bench)
        if args.json:
            print(json.dumps([asdict(r) for r in rows], ensure_ascii=False, indent=2))
        else:
            print_rows(rows)
        return 0

    url = args.url or BENCHES[args.bench]
    interval = max(args.interval, MIN_INTERVAL)
    if interval != args.interval:
        log.warning("interval raised to %ss to avoid overloading the court server", interval)

    fetcher = Fetcher(verify=not args.insecure, warmup=not args.no_warmup,
                      user_agent=args.ua)
    signal.signal(signal.SIGINT, _handle_sigint)

    seen: set[tuple] = set()
    prev_keys: set[tuple] = set()
    first_cycle = True

    while not _stop:
        try:
            html = fetcher.get(url)
            rows = parse_board(html, bench=args.bench)
        except Exception as exc:  # noqa: BLE001
            log.error("scrape failed: %s", exc)
            if args.once:
                return 1
            time.sleep(interval)
            continue

        if args.dump:
            with open(args.dump, "w", encoding="utf-8") as fh:
                fh.write(html)
            log.info("raw HTML written to %s", args.dump)

        if not rows:
            log.warning("fetched %d chars but parsed 0 court cards", len(html))
            if first_cycle:
                diagnose(html)

        keys = {r.key() for r in rows}
        changed = [r for r in rows if r.key() not in seen]
        seen |= keys

        if keys != prev_keys or first_cycle:
            moved = sum(1 for r in rows if r.key() not in prev_keys) if prev_keys else 0
            log.info("%d courts on board, %d moved since last poll", len(rows), moved)
            if args.csv and changed:
                append_csv(args.csv, changed)
            if not args.quiet:
                if args.json:
                    print(json.dumps([asdict(r) for r in rows],
                                     ensure_ascii=False, indent=2))
                else:
                    print_rows(rows)
            prev_keys = keys
        else:
            log.info("no change (%d courts)", len(rows))
        first_cycle = False

        if args.snapshot:
            write_snapshot(args.snapshot, rows)

        if args.once:
            break
        for _ in range(interval):
            if _stop:
                break
            time.sleep(1)

    return 0


if __name__ == "__main__":
    sys.exit(main())