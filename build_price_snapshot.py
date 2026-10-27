# -*- coding: utf-8 -*-
"""生成 Node 后端看板使用的价格快照 price_snapshot.json。

背景（2026-10-27 定位）：
  看板的金属 / 饲料 / 畜禽 / 汇率图全部读这份预生成的快照；
  旧快照由 Flask app.py 用 test_client 生成，但**生成脚本从未进仓库**，
  于是 2026-09-06 之后再没人重建 → 看板从 2026-10 起就没有新月份。
  本脚本把这条链路补回来：复用 app.py 里现成的 6 个价格接口，
  不重复实现抓取/聚合逻辑，只负责「刷新 → 打包 → 落盘」。

用法：
  python build_price_snapshot.py                 # 刷新行情(金属/饲料/汇率) + 生成快照
  python build_price_snapshot.py --no-refresh    # 只用 SQLite 里现有缓存生成
  python build_price_snapshot.py --out x.json    # 指定输出路径
  python build_price_snapshot.py --wait 180      # 刷新后等多少秒再打包

输出结构（与线上现存快照一致）：
  {"_meta": {"generated_at": "...", "source": "...", "count": 14, "as_of": {...}},
   "data": {"metal_USD.json": {...}, ..., "fx.json": {...}, "retail_raw.json": {...}}}
"""
import argparse
import io
import json
import os
import sys
import time
import traceback

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)                      # app.py 里的 DB 路径是相对路径
sys.path.insert(0, HERE)

DEFAULT_OUT = os.path.join(HERE, "_snapshot_out", "price_snapshot.json")

# Node 端 ROUTE_MAP 期望的 key 名（不要改，改了两边对不上）
CURRENCIES = ("USD", "RMB", "VND")
ROUTES = [
    ("metal_%s.json", "/api/metal-prices?cur=%s"),
    ("feed_%s.json", "/api/feed-prices?cur=%s"),
    ("livestock_%s.json", "/api/livestock-prices?cur=%s"),
    ("farmgate_%s.json", "/api/livestock-farmgate?cur=%s"),
]
PLAIN = [
    ("fx.json", "/api/fx-rates"),
    ("retail_raw.json", "/api/livestock-retail-raw"),
]


def log(msg):
    print(msg, flush=True)


def refresh_market(A):
    """同步刷新金属/饲料/汇率（app.py 里这三块有现成的 build 函数）。
    畜禽(livestock) 走 collect_livestock.py 的月更抓取，本脚本默认不动它。"""
    log(">> 刷新行情缓存 (fx / feed / metal) ...")
    conn = A.get_db()
    try:
        for fn_name in ("_fx_build_data", "_feed_build_data", "_metal_build_data"):
            fn = getattr(A, fn_name, None)
            if not fn:
                log("   ! app.py 缺少 %s，跳过" % fn_name)
                continue
            t0 = time.time()
            try:
                fn(conn)
                log("   - %s ok (%.1fs)" % (fn_name, time.time() - t0))
            except Exception as e:
                log("   - %s 失败: %s" % (fn_name, e))
    finally:
        conn.close()
    # 让接口重新计算，别被 60s 内存缓存挡住
    try:
        A._API_CACHE.clear()
    except Exception:
        pass


def last_label(payload):
    if not isinstance(payload, dict):
        return ""
    labels = payload.get("labels") or payload.get("dates") or []
    return labels[-1] if labels else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--no-refresh", action="store_true", help="不刷新行情，直接用现有 SQLite 缓存")
    ap.add_argument("--wait", type=int, default=0, help="刷新后等待秒数（给后台线程留时间）")
    args = ap.parse_args()

    log("=" * 64)
    log("build_price_snapshot.py   %s" % time.strftime("%Y-%m-%d %H:%M:%S"))
    log("=" * 64)

    log(">> import app.py ...")
    import app as A

    if not args.no_refresh:
        refresh_market(A)
        if args.wait > 0:
            log(">> 等待 %ds ..." % args.wait)
            time.sleep(args.wait)

    client = A.app.test_client()
    data = {}
    as_of = {}
    errors = []

    def pull(key, path):
        t0 = time.time()
        try:
            r = client.get(path)
        except Exception as e:
            errors.append("%s -> 异常 %s" % (path, e))
            return
        if r.status_code != 200:
            errors.append("%s -> HTTP %d" % (path, r.status_code))
            return
        try:
            payload = r.get_json()
        except Exception as e:
            errors.append("%s -> JSON 解析失败 %s" % (path, e))
            return
        data[key] = payload
        as_of[key] = last_label(payload)
        log("   - %-22s as_of=%-8s (%.1fs)" % (key, as_of[key] or "-", time.time() - t0))

    log(">> 抓取 %d 个接口 ..." % (len(ROUTES) * len(CURRENCIES) + len(PLAIN)))
    for tpl, route in ROUTES:
        for cur in CURRENCIES:
            pull(tpl % cur, route % cur)
    for key, route in PLAIN:
        pull(key, route)

    if not data:
        log("!! 一个接口都没拿到，终止")
        for e in errors:
            log("   " + e)
        return 2

    now_ym = time.strftime("%Y-%m")
    months = sorted(set(v for v in as_of.values() if v))
    newest = months[-1] if months else ""

    snap = {
        "_meta": {
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": "build_price_snapshot.py (Flask test_client)",
            "count": len(data),
            "newest_month": newest,
            "expected_month": now_ym,
            "as_of": as_of,
            "errors": errors,
        },
        "data": data,
    }

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(out)
    log("-" * 64)
    log(">> 写出 %s  (%.1f KB, %d 个接口)" % (out, size / 1024.0, len(data)))
    log(">> 最新月份: %s   期望月份: %s" % (newest or "-", now_ym))
    if newest and newest < now_ym:
        log("!! 警告：最新月份 %s 落后于当月 %s（行情源可能没抓到，或该月还没数据）" % (newest, now_ym))
    if errors:
        log("!! 有 %d 个接口失败：" % len(errors))
        for e in errors:
            log("   " + e)
        return 1
    log(">> OK")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(3)
