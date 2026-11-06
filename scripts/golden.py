"""Independent oracle: expected daily summaries computed straight from the spec.

Written in Python with Decimal so it shares no code, language or float behavior
with the TypeScript implementation. Run with:

    python -I scripts/golden.py

Needs Python 3.9+. On Windows, first run `pip install tzdata`, because zoneinfo
has no system timezone database there.

Rules applied, in order (spec sections 3 and 4.3, DECISIONS D-50):
  1. Request window: the API asks Yahoo for period1 = clock - 35 days and
     period2 = clock, so only bars with period1 <= t < period2 are visible.
  2. Validation: timestamps are safe integers of Unix seconds within the
     JavaScript Date range, and every quote array has the same length.
  3. Session filter: keep only bars whose start lies inside one of
     meta.tradingPeriods' regular periods (start <= t < end). This drops Yahoo's
     closing-price stub bar at the session end.
  4. Deduplicate timestamps (keep the last) and sort.
  5. Day key: calendar date in meta.exchangeTimezoneName.
  6. Window: exchange-local dates from today minus one calendar month (clamped
     to month end) to today, inclusive.
  7. Usable bar: low and high finite, above 0, low <= high; volume null counts
     as 0, otherwise a safe non-negative integer.
  8. Per day: decimal mean of lows and of highs, rounded once to 4 places half
     up; integer sum of volume. Days with no usable bars are omitted.
"""

from __future__ import annotations

import calendar
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "backend" / "test" / "fixtures" / "yahoo" / "TSLA.json"
OUT_DIR = ROOT / "backend" / "test" / "fixtures" / "golden"

# The two e2e clocks (spec section 8). Both fall on 2026-11-05, the captured session.
SCENARIOS = {
    "after-close": "2026-11-05T21:30:00Z",
    "in-session": "2026-11-05T18:00:00Z",
}

MAX_SAFE_INTEGER = 2**53 - 1
MAX_UNIX_SECONDS = 8_640_000_000_000  # JavaScript Date limit
LOOKBACK = timedelta(days=35)
FOUR_PLACES = Decimal("0.0001")


def parse_clock(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def is_safe_int(v: object) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return abs(v) <= MAX_SAFE_INTEGER
    if isinstance(v, float):
        return math.isfinite(v) and v.is_integer() and abs(v) <= MAX_SAFE_INTEGER
    return False


def is_price(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0


def minus_one_month(d: date) -> date:
    year, month = (d.year, d.month - 1) if d.month > 1 else (d.year - 1, 12)
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def decimal_mean(values: list[float]) -> float:
    total = sum((Decimal(repr(v)) for v in values), Decimal(0))
    rounded = (total / len(values)).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
    return float(rounded) + 0.0  # + 0.0 turns -0.0 into 0.0


def compute(fixture: dict, clock: datetime) -> tuple[list[dict], dict, dict]:
    result = fixture["response"]["body"]["chart"]["result"][0]
    meta = result["meta"]
    stamps = result.get("timestamp", [])
    quote = result["indicators"]["quote"][0]
    counts: dict[str, int] = {"fixtureBars": len(stamps)}

    # 2. validation
    for field in ("low", "high", "volume"):
        if len(quote[field]) != len(stamps):
            raise ValueError(f"{field} length {len(quote[field])} != timestamp length {len(stamps)}")
    for t in stamps:
        if not (is_safe_int(t) and 0 <= t <= MAX_UNIX_SECONDS):
            raise ValueError(f"invalid timestamp {t!r}")

    # 1. request window seen by the API
    period2 = int(clock.timestamp())
    period1 = int((clock - LOOKBACK).timestamp())
    rows = [
        (int(t), quote["low"][i], quote["high"][i], quote["volume"][i])
        for i, t in enumerate(stamps)
        if period1 <= t < period2
    ]
    counts["inRequestWindow"] = len(rows)

    # 3. session filter
    periods = [p for day in meta["tradingPeriods"] for p in day]
    rows = [r for r in rows if any(p["start"] <= r[0] < p["end"] for p in periods)]
    counts["inRegularSession"] = len(rows)

    # 4. dedupe (keep last) and sort
    by_time = {}
    for r in rows:
        by_time[r[0]] = r
    rows = [by_time[t] for t in sorted(by_time)]

    # 5 and 6. day keys and window
    zone = ZoneInfo(meta["exchangeTimezoneName"])
    today = clock.astimezone(zone).date()
    start = minus_one_month(today)

    days: dict[str, dict[str, list]] = {}
    unusable = 0
    for t, low, high, volume in rows:
        day = datetime.fromtimestamp(t, timezone.utc).astimezone(zone).date()
        if not (start <= day <= today):
            continue
        # 7. usable bar
        prices_ok = is_price(low) and is_price(high) and low <= high
        volume_ok = volume is None or (is_safe_int(volume) and volume >= 0)
        if not (prices_ok and volume_ok):
            unusable += 1
            continue
        bucket = days.setdefault(day.isoformat(), {"low": [], "high": [], "volume": []})
        bucket["low"].append(low)
        bucket["high"].append(high)
        bucket["volume"].append(0 if volume is None else int(volume))
    counts["unusable"] = unusable

    # 8. aggregate
    expected = []
    for day in sorted(days):
        b = days[day]
        volume_total = sum(b["volume"])
        if volume_total > MAX_SAFE_INTEGER:
            raise ValueError(f"volume overflow on {day}")
        expected.append(
            {
                "day": day,
                "lowAverage": decimal_mean(b["low"]),
                "highAverage": decimal_mean(b["high"]),
                "volume": volume_total,
            }
        )
    counts["days"] = len(expected)

    regular = meta.get("currentTradingPeriod", {}).get("regular")
    partial = None
    if regular and regular["start"] <= period2 < regular["end"]:
        partial = today.isoformat()
    headers = {
        "X-Exchange-Timezone": meta["exchangeTimezoneName"],
        "X-Currency": meta.get("currency"),
        "X-Partial-Day": partial,
    }
    window = {"from": start.isoformat(), "to": today.isoformat()}
    return expected, {**counts, "window": window}, headers


def main() -> int:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, iso in SCENARIOS.items():
        expected, counts, headers = compute(fixture, parse_clock(iso))
        doc = {
            "scenario": name,
            "clock": iso,
            "fixture": "backend/test/fixtures/yahoo/TSLA.json",
            "generatedBy": "scripts/golden.py",
            "counts": counts,
            "expectedHeaders": headers,
            "expected": expected,
        }
        out = OUT_DIR / f"golden.{name}.json"
        out.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        print(f"{out.relative_to(ROOT)}: {counts}  X-Partial-Day={headers['X-Partial-Day']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
