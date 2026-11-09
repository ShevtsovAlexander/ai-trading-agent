#!/usr/bin/env python3
"""Эталон OI 1Г и «Всё» по Coinalyze (TASK-0017).

Режимы:
  snapshot — снять фикстуру параметрами плана: Coinalyze open-interest-history,
             daily, convert_to_usd=true, 3 символа на монету с 2022-09-30; дневные
             свечи спота Binance за то же окно. Посчитать эталон и записать всё в
             src/derivatives/fixtures/oi-long-<дата>.json (takenAt, responses, expected).
  expected — пересчитать эталон по сырым ответам уже снятой фикстуры (без сети).
  live     — свежий ряд Coinalyze против ряда 30 дней бэкенда (биржи напрямую) на
             общих моментах: медиана и максимум расхождения по биржам.
  backend  — ответ бэкенда ?period=1y|all против свежего эталона: каждая точка
             (момент, сумма, биржи, цена) точно; печатает число сверенных точек.

Эталон в фикстуре: expected[монета] = { all, 1y, without: {биржа: all}, gap: {exchange, t, all} }.
  without — биржа выпала из ответа: её нет ни в одной точке, сумма по двум;
  gap     — у одной биржи удалён один бар: этого момента нет в ряду, остальное как all.
Точка — [момент, сумма, binance, okx, bybit, цена]; выпавшая биржа — null.
Сумма — строго в порядке binance → okx → bybit (контракт плана: от порядка
зависит последний бит float).

Правила ряда (план TASK-0017, «Контракты»):
  - момент точки = метка Coinalyze + сутки: бар D 00:00 — значение на конец дня D;
  - момент позже времени снимка (живой текущий день) отбрасывается;
  - точка — только если все учтённые биржи дали значение в этот момент;
  - цена — close дневной свечи Binance, открытой в момент − сутки; нет свечи — null;
  - 1y — последние 365 точек, all — все.

Считается отдельно от TypeScript проекта: это оракул для oi-long.spec.ts.
Запуск из папки backend: python3 -I scripts/oi-long-oracle.py snapshot | expected | live | backend
Ключ берётся из backend/.env и не печатается.
"""
import json
import pathlib
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
FIXTURES = ROOT / "src" / "derivatives" / "fixtures"
COINALYZE = "https://api.coinalyze.net/v1/open-interest-history"
KLINES = "https://api.binance.com/api/v3/klines"
BACKEND = "http://localhost:3000"
DAY = 86_400_000
FROM = int(datetime(2022, 9, 30, tzinfo=timezone.utc).timestamp() * 1000)
YEAR_POINTS = 365
EXCHANGES = ("binance", "okx", "bybit")
# Символы Coinalyze — как LIQUIDATION_SYMBOLS (src/liquidations/liquidations.types.ts)
COINS = {
    "bitcoin": ("BTCUSDT", {"binance": "BTCUSDT_PERP.A", "okx": "BTCUSDT_PERP.3", "bybit": "BTCUSDT.6"}),
    "ethereum": ("ETHUSDT", {"binance": "ETHUSDT_PERP.A", "okx": "ETHUSDT_PERP.3", "bybit": "ETHUSDT.6"}),
    "solana": ("SOLUSDT", {"binance": "SOLUSDT_PERP.A", "okx": "SOLUSDT_PERP.3", "bybit": "SOLUSDT.6"}),
}

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def read_key():
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("COINALYZE_API_KEY="):
            value = line.split("=", 1)[1].strip().strip("\"'")
            if value:
                return value
    raise SystemExit("COINALYZE_API_KEY не задан в backend/.env")


def fetch(url, params, headers=None):
    req = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "dashboard-check", **(headers or {})},
    )
    with OPENER.open(req, timeout=30) as response:
        return json.load(response)


def coinalyze(key, symbols, now):
    return fetch(
        COINALYZE,
        {
            "symbols": ",".join(symbols),
            "interval": "daily",
            "from": FROM // 1000,
            "to": now // 1000,
            "convert_to_usd": "true",
        },
        {"api_key": key},
    )


def klines(symbol, now):
    out, start = [], FROM
    while True:
        page = fetch(KLINES, {"symbol": symbol, "interval": "1d", "startTime": start, "endTime": now, "limit": 1000})
        out.extend(page)
        if len(page) < 1000:
            return out
        start = page[-1][0] + 1


def series(raw, symbols, candles, now, exchanges=EXCHANGES):
    """Ряд «Всё» по правилам модуля: [момент, сумма, binance, okx, bybit, цена].
    exchanges — учтённые биржи; остальные в точке — None."""
    by_symbol = {row["symbol"]: row["history"] for row in raw}
    values = {}
    for ex in exchanges:
        hist = by_symbol.get(symbols[ex])
        if not hist:
            raise SystemExit(f"нет ряда {symbols[ex]} в ответе")
        values[ex] = {}
        for p in hist:
            moment = p["t"] * 1000 + DAY
            if moment <= now:
                values[ex][moment] = float(p["c"])
    # Свеча закрыта, если её конец не позже снимка — как fetchClosedCandles
    closes = {k[0]: float(k[4]) for k in candles if k[6] <= now}
    points = []
    for moment in sorted(values[exchanges[0]]):
        if not all(moment in values[ex] for ex in exchanges):
            continue
        total = 0.0
        for ex in EXCHANGES:  # порядок сложения — контракт
            if ex in exchanges:
                total += values[ex][moment]
        parts = [values[ex][moment] if ex in exchanges else None for ex in EXCHANGES]
        points.append([moment, total, *parts, closes.get(moment - DAY)])
    return points


# Какой биржи у какой монеты удалить бар для эталона дыры и какой бар (по номеру)
GAP = {"bitcoin": ("binance", 500), "ethereum": ("okx", 900), "solana": ("bybit", 1200)}


def oracle(coin, raw, candles, now):
    symbols = COINS[coin][1]
    all_points = series(raw, symbols, candles, now)
    without = {
        ex: series(raw, symbols, candles, now, tuple(e for e in EXCHANGES if e != ex)) for ex in EXCHANGES
    }
    ex, index = GAP[coin]
    holed = [dict(row) for row in raw]
    for row in holed:
        if row["symbol"] == symbols[ex]:
            removed = row["history"][index]["t"] * 1000
            row["history"] = row["history"][:index] + row["history"][index + 1 :]
    gap = {"exchange": ex, "t": removed, "all": series(holed, symbols, candles, now)}
    return {"all": all_points, "1y": all_points[-YEAR_POINTS:], "without": without, "gap": gap}


def describe(points):
    moments = [p[0] for p in points]
    gaps = sum(1 for a, b in zip(moments, moments[1:]) if b - a != DAY)
    no_price = sum(1 for p in points if p[5] is None)
    day = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")
    return f"{len(points)} точек {day(moments[0])} … {day(moments[-1])}, дыр {gaps}, без цены {no_price}"


def snapshot():
    key = read_key()
    now = int(time.time() * 1000)
    responses, expected = {}, {}
    for coin, (spot, symbols) in COINS.items():
        raw = coinalyze(key, [symbols[ex] for ex in EXCHANGES], now)
        candles = klines(spot, now)
        responses[coin] = {"coinalyze": raw, "klines": candles}
        expected[coin] = oracle(coin, raw, candles, now)
        report(coin, expected[coin])
    out = FIXTURES / f"oi-long-{datetime.fromtimestamp(now / 1000, timezone.utc):%Y-%m-%d}.json"
    out.write_text(json.dumps({"takenAt": now, "responses": responses, "expected": expected}, separators=(",", ":")))
    print(f"записано {out.relative_to(ROOT)}, {out.stat().st_size / 1e6:.1f} МБ")


def report(coin, e):
    print(f"{coin}: all — {describe(e['all'])}; 1y — {len(e['1y'])} точек")
    for ex, pts in e["without"].items():
        print(f"  без {ex}: {describe(pts)}")
    g = e["gap"]
    day = datetime.fromtimestamp(g["t"] / 1000, timezone.utc).strftime("%Y-%m-%d")
    print(f"  дыра {g['exchange']} в баре {day}: {describe(g['all'])}")


def recompute():
    path = max(FIXTURES.glob("oi-long-*.json"))
    data = json.loads(path.read_text())
    now = data["takenAt"]
    for coin, r in data["responses"].items():
        e = oracle(coin, r["coinalyze"], r["klines"], now)
        if data["expected"][coin]["all"] != e["all"]:
            raise SystemExit(f"{coin}: пересчёт all разошёлся с прежним эталоном")
        data["expected"][coin] = e
        report(coin, e)
    path.write_text(json.dumps(data, separators=(",", ":")))
    print(f"перезаписано {path.relative_to(ROOT)}, {path.stat().st_size / 1e6:.1f} МБ")


def live():
    key = read_key()
    now = int(time.time() * 1000)
    for coin, (spot, symbols) in COINS.items():
        raw = coinalyze(key, [symbols[ex] for ex in EXCHANGES], now)
        mine = {p[0]: dict(zip(EXCHANGES, p[2:5])) for p in series(raw, symbols, [], now)}
        ours = fetch(f"{BACKEND}/derivatives/{coin}/open-interest", {"step": "1d"})
        diffs = {ex: [] for ex in EXCHANGES}
        for p in ours["points"]:
            m = mine.get(p["t"])
            if not m:
                continue
            for ex in EXCHANGES:
                if ex in p["byExchange"]:
                    diffs[ex].append(abs(m[ex] / p["byExchange"][ex] - 1) * 100)
        line = ", ".join(
            f"{ex} медиана {statistics.median(v):.3f} % макс {max(v):.2f} % (n={len(v)})" for ex, v in diffs.items() if v
        )
        print(f"{coin}: {line}")


def backend():
    key = read_key()
    bad_total = 0
    for coin, (spot, symbols) in COINS.items():
        answers = {period: fetch(f"{BACKEND}/derivatives/{coin}/open-interest", {"period": period}) for period in ("all", "1y")}
        now = int(time.time() * 1000)
        raw = coinalyze(key, [symbols[ex] for ex in EXCHANGES], now)
        mine = series(raw, symbols, klines(spot, now), now)
        for period, ans in answers.items():
            want = mine if period == "all" else mine[-YEAR_POINTS:]
            # Ответ бэкенда снят чуть раньше эталона: сравниваем его моменты
            got = {p["t"]: p for p in ans["points"]}
            want_by = {p[0]: p for p in want}
            bad = 0
            for t, p in got.items():
                w = want_by.get(t)
                row = [p["t"], p["totalUsd"], *(p["byExchange"].get(ex) for ex in EXCHANGES), p["price"]]
                if w != row:
                    bad += 1
            extra = len(set(want_by) - set(got))
            bad_total += bad + extra
            print(
                f"{coin} {period}: точек {len(got)}, эталон {len(want)}, расхождений {bad}, нет в ответе {extra}; "
                f"source={ans['source']} step={ans['step']} ошибки={[e for e in ans['exchanges'] if 'error' in e]} priceError={ans['priceError']}"
            )
    if bad_total:
        raise SystemExit(2)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "snapshot":
        snapshot()
    elif mode == "expected":
        recompute()
    elif mode == "live":
        live()
    elif mode == "backend":
        backend()
    else:
        raise SystemExit("режим: snapshot | expected | live | backend")
