# -*- coding: utf-8 -*-
"""
生成腾讯云同源部署目录（node-backend/dist）

从仓库根目录复制前端资源到 node-backend/dist，供 node-backend/server.mjs 同源托管。
与 Cloudflare 版（cloudflare/build_pages.py）的区别：
  - 不部署 Cloudflare Pages / Worker
  - 根目录 index.html/vault.html 已是「同源配置」（CLOUD_API/API_BASE 为空），
    因此无需再改写常量
  - 不生成 Cloudflare 专属的 _headers（缓存由 nginx/Express 控制）

用法：
    python node-backend/build_dist.py
"""
import os
import sys
import shutil
import json

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DIST = os.path.join(HERE, "dist")

# 需要一起部署的前端资源（与 cloudflare/build_pages.py 的 ASSETS 一致）
ASSETS = [
    "index.html",
    "vault.html",
    "crm_table.js",
    "lost_table.js",
    "manifest.json",
    "vault-manifest.webmanifest",
    "favicon.svg",
    "icon-192.png",
    "icon-512.png",
    "icon-512-maskable.png",
    "apple-touch-icon.png",   # iOS 主屏幕（index.html 引用，漏了会 404）
]


def main():
    # ---- 版本号自动同步：网页版本标记跟着 build.gradle.kts 走，不再手改 ----
    sys.path.insert(0, os.path.abspath(ROOT))
    try:
        from version_sync import sync_index_version
        sync_index_version(os.path.abspath(ROOT))
    except Exception as e:
        print("  [WARN] 版本同步失败（继续构建，网页版本可能落后）: %s" % e)

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST, exist_ok=True)

    copied, missing = [], []
    for name in ASSETS:
        src = os.path.join(ROOT, name)
        dst = os.path.join(DIST, name)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            copied.append(name)
        else:
            missing.append(name)

    # 本地预览库（PDF.js / mammoth / SheetJS）随站点一起部署，摆脱外部 CDN
    vendor_src = os.path.join(ROOT, "cloudflare", "pages", "vendor")
    if os.path.isdir(vendor_src):
        shutil.copytree(vendor_src, os.path.join(DIST, "vendor"), dirs_exist_ok=True)
        vn = len(os.listdir(os.path.join(DIST, "vendor")))
        print("  vendor/ 已复制 %d 个预览库文件" % vn)
    else:
        print("  [WARN] 未找到预览库目录 cloudflare/pages/vendor，PDF/文档预览可能依赖 CDN")

    # manifest.json 图标改为相对路径，避免子路径部署后图标 404
    mpath = os.path.join(DIST, "manifest.json")
    if os.path.isfile(mpath):
        try:
            with open(mpath, "r", encoding="utf-8") as f:
                m = json.load(f)
            for ic in m.get("icons", []):
                if isinstance(ic.get("src"), str) and ic["src"].startswith("/"):
                    ic["src"] = ic["src"][1:]
            if isinstance(m.get("start_url"), str) and m["start_url"] == "/":
                m["start_url"] = "./"
            if isinstance(m.get("scope"), str) and m["scope"] == "/":
                m["scope"] = "./"
            with open(mpath, "w", encoding="utf-8") as f:
                json.dump(m, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print("  manifest.json 处理失败: %s" % e)

    print("=" * 50)
    print("  腾讯云同源部署目录已生成")
    print("=" * 50)
    print("  目录: %s" % DIST)
    print("\n  已复制 %d 个文件:" % len(copied))
    for n in copied:
        size = os.path.getsize(os.path.join(DIST, n))
        print("    %-26s %8.1f KB" % (n, size / 1024))
    if missing:
        print("\n  缺失（已跳过）: %s" % ", ".join(missing))


if __name__ == "__main__":
    main()
