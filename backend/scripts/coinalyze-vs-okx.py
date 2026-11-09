#!/usr/bin/env python3
"""Сверка Coinalyze с прямым ответом OKX (TASK-0015).

OKX отдаёт последние 100 ликвидаций монеты. Скрипт сравнивает их с минутными
данными Coinalyze в монетах и печатает долю, которую Coinalyze показал. Старую
крайнюю минуту обрезает лимит выдачи OKX, новая может быть ещё не дописана: обе
отброшены и в итог не входят.

OKX тоже может отдавать не все события, поэтому это проверка, а не точный эталон.
Стоп-условие: Coinalyze больше OKX в сумме по окну (PRD TASK-0015, критерий 5);
превышение по одной стороне — заметка на решение человека, без стопа.

Запуск из папки backend: python3 -I scripts/coinalyze-vs-okx.py
Ключ берётся из backend/.env и не печатается. Код выхода 2 — сработал стоп.
"""
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

ENV = pathlib.Path(__file__).resolve().parent.parent / ".env"
COINALYZE = "https://api.coinalyze.net/v1/liquidation-history"
OKX = "https://www.okx.com/api/v5/public/liquidation-orders"
# Размер контракта OKX в монетах: совпадение минут с Coinalyze подтвердило его
COINS = (
    ("BTC-USDT", "BTCUSDT_PERP.3", 0.01),
    ("ETH-USDT", "ETHUSDT_PERP.3", 0.1),
    ("SOL-USDT", "SOLUSDT_PERP.3", 1),
)
EPS = 1e-6


def read_key():
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("COINALYZE_API_KEY="):
            value = line.split("=", 1)[1].strip().strip("\"'")
            if value:
                return value
    raise SystemExit("COINALYZE_API_KEY не задан в backend/.env")


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def fetch(url, params, headers=None):
    req = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "dashboard-check", **(headers or {})},
    )
    with OPENER.open(req, timeout=30) as response:
        return json.load(response)


def okx_minutes(uly, contract):
    data = fetch(OKX, {"instType": "SWAP", "uly": uly, "state": "filled", "limit": 100})
    if data.get("code") != "0":
        raise RuntimeError(f"OKX {uly}: код {data.get('code')}")
    sides = {"long": "l", "short": "s"}
    minutes = defaultdict(lambda: {"l": 0.0, "s": 0.0, "lu": 0.0, "su": 0.0})
    for block in data["data"]:
        if block.get("instId") != f"{uly}-SWAP":
            continue
        for event in block["details"]:
            side = sides[event["posSide"]]
            coins = float(event["sz"]) * contract
            minute = minutes[int(event["ts"]) // 60000 * 60]
            minute[side] += coins
            minute[side + "u"] += coins * float(event["bkPx"])
    return minutes


def share(part, whole):
    return f"{part / whole * 100:.0f} %" if whole > 0 else "—"


def utc(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%d %H:%M")


def compare(uly, symbol, contract, key):
    okx = okx_minutes(uly, contract)
    if len(okx) < 3:
        return {"coin": uly, "skip": "мало минут у OKX"}
    start, end = min(okx), max(okx)
    rows = fetch(
        COINALYZE,
        {"symbols": symbol, "interval": "1min", "from": start, "to": end + 60, "convert_to_usd": "false"},
        {"api_key": key},
    )
    coinalyze = {p["t"]: p for p in rows[0]["history"]} if rows else {}
    if not coinalyze:
        return {"coin": uly, "skip": "Coinalyze не отдал данных за окно"}
    # Доллары — то, что показывает график; монеты у Coinalyze бывают несогласованы
    # с его же долларами (research TASK-0015), поэтому итог считается по долларам
    usd_rows = fetch(
        COINALYZE,
        {"symbols": symbol, "interval": "1min", "from": start, "to": end + 60, "convert_to_usd": "true"},
        {"api_key": key},
    )
    coinalyze_usd = {p["t"]: p for p in usd_rows[0]["history"]} if usd_rows else {}
    usd = {"ol": 0.0, "os": 0.0, "cl": 0.0, "cs": 0.0}
    totals = {"ol": 0.0, "os": 0.0, "cl": 0.0, "cs": 0.0}
    over, extra, opposite, exact, with_events = [], 0, 0, 0, 0
    for t in range(start + 60, end, 60):
        c = coinalyze.get(t, {"l": 0, "s": 0})
        o = okx.get(t, {"l": 0.0, "s": 0.0})
        totals["ol"] += o["l"]
        totals["os"] += o["s"]
        totals["cl"] += c["l"]
        totals["cs"] += c["s"]
        cu = coinalyze_usd.get(t, {"l": 0, "s": 0})
        usd["ol"] += o.get("lu", 0.0)
        usd["os"] += o.get("su", 0.0)
        usd["cl"] += cu["l"]
        usd["cs"] += cu["s"]
        if t in okx:
            with_events += 1
            # PRD 3: сторона есть у Coinalyze, а у OKX в эту минуту её нет
            if (c["l"] > 0 and o["l"] == 0) or (c["s"] > 0 and o["s"] == 0):
                opposite += 1
            if abs(c["l"] - o["l"]) <= EPS and abs(c["s"] - o["s"]) <= EPS:
                exact += 1
        elif c["l"] or c["s"]:
            extra += 1
        if c["l"] > o["l"] + EPS or c["s"] > o["s"] + EPS:
            over.append((utc(t), c["l"], c["s"], round(o["l"], 6), round(o["s"], 6)))
    okx_total = usd["ol"] + usd["os"]
    coinalyze_total = usd["cl"] + usd["cs"]
    return {
        "coin": uly,
        "from": utc(start),
        "to": utc(end),
        "share": share(coinalyze_total, okx_total),
        "long": share(usd["cl"], usd["ol"]),
        "short": share(usd["cs"], usd["os"]),
        "coin_share": share(totals["cl"] + totals["cs"], totals["ol"] + totals["os"]),
        "okx_usd": okx_total,
        "coinalyze_usd": coinalyze_total,
        "over": over,
        "extra": extra,
        "opposite": opposite,
        "exact": exact,
        "with_events": with_events,
        "side_over": (usd["cl"] > usd["ol"] * 1.01) or (usd["cs"] > usd["os"] * 1.01),
        # Доллары Coinalyze по цене свечи, OKX — по цене события: запас 1 %
        "stop": coinalyze_total > okx_total * 1.01,
    }


def main():
    key = read_key()
    print("момент", utc(int(datetime.now(timezone.utc).timestamp())), "UTC")
    stop = False
    incomplete = False
    for uly, symbol, contract in COINS:
        r = compare(uly, symbol, contract, key)
        if "skip" in r:
            print(r["coin"], r["skip"])
            incomplete = True
            continue
        stop = stop or r["stop"]
        print(
            f"{r['coin']} окно {r['from']} – {r['to']}: доля в долларах {r['share']}"
            f" (лонги {r['long']}, шорты {r['short']}; ${r['coinalyze_usd']:,.0f} из ${r['okx_usd']:,.0f});"
            f" в монетах {r['coin_share']};"
            f" минут с событиями OKX {r['with_events']}, совпало точно {r['exact']},"
            f" больше OKX {len(r['over'])}, лишних {r['extra']}, сторона без событий OKX {r['opposite']}"
        )
        if r["side_over"]:
            print("   ЗАМЕТКА: по одной из сторон Coinalyze больше OKX за всё окно")
        for row in r["over"]:
            print("   больше OKX:", row)
    if incomplete:
        print("СВЕРКА НЕПОЛНАЯ: не по всем монетам есть данные")
    if stop:
        print("СТОП: Coinalyze больше OKX в сумме по окну")
        sys.exit(2)


if __name__ == "__main__":
    main()
