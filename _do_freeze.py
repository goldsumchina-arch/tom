#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""执行 DEMO 固化：unlock vault → freeze → 验证 R2 快照"""
import sys, io, json, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = "https://agi-gs.tomalso911.workers.dev"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

# 1) vault unlock
req = urllib.request.Request(HOST + "/api/vault/unlock",
    data=json.dumps({"pin": "1116", "username": "tom"}).encode(),
    headers={"Content-Type": "application/json", "User-Agent": UA, "Accept": "application/json"})
with urllib.request.urlopen(req, timeout=30) as r:
    d = json.loads(r.read().decode())
print("[unlock] ok =", d.get("ok"), d.get("error", ""))
if not d.get("ok"):
    sys.exit(1)
vt = d.get("token") or ""
print("[unlock] token_len =", len(vt))

# 2) freeze
req = urllib.request.Request(HOST + "/api/demo/freeze", data=b"{}",
    headers={"Content-Type": "application/json", "User-Agent": UA,
             "Accept": "application/json", "X-Vault-Token": vt})
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.loads(r.read().decode())
    print("[freeze]", json.dumps(res, ensure_ascii=False))
except urllib.error.HTTPError as e:
    print("[freeze HTTP %d]" % e.code, e.read().decode()[:500])
    sys.exit(1)

# 3) 验证：用 CF API 直接读 R2 快照头部
cf_token = ""
for line in open(r"c:/Users/tomal/OneDrive/Desktop/gs-project/.env", encoding="utf-8", errors="replace"):
    line = line.strip()
    if line.startswith("CLOUDFLARE_API_TOKEN="):
        cf_token = line.split("=", 1)[1].strip().strip('"').strip("'")
ACC = "3dd7bef80dfcb458db4f28ed47710b12"
url = "https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets/agi-pm-files/objects/demo_snapshot.json" % ACC
req = urllib.request.Request(url, headers={"Authorization": "Bearer " + cf_token})
with urllib.request.urlopen(req, timeout=30) as r:
    snap = json.loads(r.read().decode())
meta = snap.get("_meta") or {}
print("[verify] frozen_at =", meta.get("frozen_at"))
print("[verify] exported_at =", meta.get("exported_at"))
tabs = snap.get("tables") or {}
for t in ["crm_projects", "lost_projects", "won_projects", "approval_requests"]:
    rows = tabs.get(t) or []
    print("[verify] %-20s %d rows" % (t, len(rows)))
crm = tabs.get("crm_projects") or []
if crm:
    from collections import Counter
    provs = Counter((row.get("province") or "") for row in crm)
    bus = Counter((row.get("bu") or "") for row in crm)
    has_remark_zh = [k for k in crm[0].keys() if "remark" in k]
    print("[verify] crm provinces:", dict(provs))
    print("[verify] crm bu:", dict(bus))
    print("[verify] crm remark keys:", has_remark_zh)
lost = tabs.get("lost_projects") or []
if lost:
    from collections import Counter
    provs = Counter((row.get("province") or "") for row in lost)
    bus = Counter((row.get("bu") or "") for row in lost)
    print("[verify] lost provinces:", dict(provs))
    print("[verify] lost bu:", dict(bus))
