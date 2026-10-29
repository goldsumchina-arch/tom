#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每月自动刷新菲律宾(PH)畜禽终端零售价 → 倒推出场价 USD/kg。
数据源：DA Bantay Presyo 官网 (NCR 大马尼拉都会区监测价)。
用法：python refresh_ph_monthly.py
   或由 Windows 任务计划程序每月 1 日调用 refresh_ph_monthly.bat。
"""
import os, sys, datetime, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import collect_livestock as c

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "ph_refresh_log.jsonl")

ITEMS = [("pig", "kg"), ("egg", "pc"), ("chicken", "kg")]


def run():
    now = datetime.datetime.now()
    ym = now.strftime("%Y-%m")
    rec = {"run_at": now.isoformat(timespec="seconds"), "ym": ym, "items": {}}

    # 触发 Bantay Presyo 抓取（会缓存到 _BP_CACHE）
    rows, bp_date = c._bp_latest()
    rec["bp_latest_date"] = bp_date

    rate = c._php_rate(ym)
    rec["php_per_usd"] = rate

    ok = True
    for item, unit in ITEMS:
        fetcher = {"pig": c.ph_pig, "egg": c.ph_egg, "chicken": c.ph_chicken}[item]
        retail = fetcher(ym)
        if retail is None:
            rec["items"][item] = {"retail": None, "status": "FETCH_FAIL"}
            ok = False
            continue
        coef = c.ph_inverse_coef(item, ym)
        fg = retail * coef
        if item == "egg":
            fg = fg / c.PH_EGG_PIECE_KG   # 枚 → kg
        usd = fg / rate if rate else None
        rec["items"][item] = {
            "retail_php_%s" % unit: round(retail, 4),
            "coef": round(coef, 4),
            "farmgate_php": round(fg, 4),
            "farmgate_usd_per_kg": round(usd, 4) if usd else None,
            "status": "OK",
        }
    rec["overall"] = "OK" if ok else "PARTIAL_FAIL"

    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # 同时跑增量 build，把 PH 延伸到当前月（保留历史）
    try:
        c.END_YM = ym
        c.ONLINE_FETCH = True
        conn, labels = c.build(incremental=True)
        c.derive_farmgate(conn, labels)
        conn.close()
        rec["build"] = "incremental OK"
    except Exception as e:
        rec["build"] = "build error: %s" % repr(e)[:200]

    print(json.dumps(rec, ensure_ascii=False, indent=2))
    return rec


if __name__ == "__main__":
    run()
