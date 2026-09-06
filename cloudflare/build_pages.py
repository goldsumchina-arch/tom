# -*- coding: utf-8 -*-
"""
生成 Cloudflare Pages 部署目录（cloudflare/pages/dist）

做的事情很简单：
1. 复制根目录的 index.html 到 dist/
2. 复制前端依赖文件（js / manifest / 图标）
3. 把 manifest.json 里的图标路径改成相对路径（适配 Pages 子路径）

用法：
    python cloudflare/build_pages.py
"""
import os
import sys
import shutil
import json
import subprocess

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def run(cmd, cwd=None, env=None):
    """执行命令，返回 (returncode, 合并后的输出文本)。"""
    try:
        # Windows 下 .cmd / .bat 不能直接 spawn，需要 cmd /c 包裹
        if os.name == "nt" and cmd and str(cmd[0]).lower().endswith((".cmd", ".bat")):
            cmd = ["cmd", "/c"] + list(cmd)
        p = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        out, _ = p.communicate()
        return p.returncode, out or ""
    except Exception as e:
        return -1, "执行异常: %s" % e

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DIST = os.path.join(HERE, "pages", "dist")

# 需要一起部署的前端资源
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
        print("  [WARN] 版本同步失败（继续部署，网页版本可能落后）: %s" % e)

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
    vendor_src = os.path.join(HERE, "pages", "vendor")
    if os.path.isdir(vendor_src):
        shutil.copytree(vendor_src, os.path.join(DIST, "vendor"), dirs_exist_ok=True)
        vn = len(os.listdir(os.path.join(DIST, "vendor")))
        print("  vendor/ 已复制 %d 个预览库文件" % vn)

    # manifest.json 图标改为相对路径，避免 Pages 部署后图标 404
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

    # _headers：HTML 文档一律 no-cache，确保 PWA / 浏览器每次都拉取最新版本，
    # 不会被旧缓存卡住（之前 PWA 无法同步 09.03.03 的根因）。
    # 注意：Cloudflare _headers 多条规则命中时「后者覆盖前者」，所以绝不能留 /* 兜底，
    # 否则会盖掉上面的 no-cache。这里只针对具体静态资源类型给长缓存。
    headers_txt = (
        "/index.html\n"
        "  Cache-Control: no-cache\n"
        "/vault.html\n"
        "  Cache-Control: no-cache\n"
        "/vault-manifest.webmanifest\n"
        "  Cache-Control: no-cache\n"
        "/manifest.json\n"
        "  Cache-Control: no-cache\n"
        "/*.js\n"
        "  Cache-Control: public, max-age=86400\n"
        "/*.css\n"
        "  Cache-Control: public, max-age=86400\n"
        "/*.svg\n"
        "  Cache-Control: public, max-age=86400\n"
        "/*.png\n"
        "  Cache-Control: public, max-age=86400\n"
        "/*.webmanifest\n"
        "  Cache-Control: public, max-age=86400\n"
    )
    with open(os.path.join(DIST, "_headers"), "w", encoding="utf-8") as f:
        f.write(headers_txt)
    print("  _headers 已生成（HTML/manifest 强制 no-cache，js/css/图片缓存 1 天）")

    print("=" * 50)
    print("  Pages 部署目录已生成")
    print("=" * 50)
    print("  目录: %s" % DIST)
    print("\n  已复制 %d 个文件:" % len(copied))
    for n in copied:
        size = os.path.getsize(os.path.join(DIST, n))
        print("    %-26s %8.1f KB" % (n, size / 1024))
    if missing:
        print("\n  缺失（已跳过）: %s" % ", ".join(missing))

    # ---------- 自动双端部署（Pages + Worker）----------
    deploy_both(DIST)

    print("=" * 50)


def _load_cf_token():
    """从 cloudflare/.env 读取 CLOUDFLARE_API_TOKEN。"""
    env_path = os.path.join(ROOT, ".env")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token and os.path.isfile(env_path):
        try:
            for line in open(env_path, "r", encoding="utf-8"):
                line = line.strip()
                if line.startswith("CLOUDFLARE_API_TOKEN="):
                    token = line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return token


def _wrangler_bin():
    """定位 wrangler 可执行文件（优先 cloudflare/node_modules/.bin，否则 PATH）。"""
    local = os.path.join(HERE, "node_modules", ".bin", "wrangler.cmd")
    if os.path.isfile(local):
        return local
    return "wrangler"


def _find_node_bin():
    """定位 node 可执行文件所在目录（用于补到 PATH）。"""
    # 1) 优先用当前 PATH 中能找到的
    from shutil import which
    n = which("node")
    if n:
        return os.path.dirname(os.path.abspath(n))
    # 2) 常见安装位置兜底
    candidates = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "node"),
        r"C:\Program Files\nodejs",
        r"C:\Program Files (x86)\nodejs",
    ]
    # 3) workbuddy 管理的多版本 node
    wb = os.path.join(os.environ.get("USERPROFILE", ""), ".workbuddy", "binaries", "node", "versions")
    if os.path.isdir(wb):
        for d in sorted(os.listdir(wb), reverse=True):
            candidates.append(os.path.join(wb, d))
    for c in candidates:
        if os.path.isfile(os.path.join(c, "node.exe")):
            return c
    return ""


def deploy_both(dist_dir):
    """同时部署 Pages 项目与 Worker，避免单边落后（历史事故根因）。"""
    token = _load_cf_token()
    if not token:
        print("\n[部署] 未找到 CLOUDFLARE_API_TOKEN，跳过自动部署。")
        print("  请手动执行: wrangler pages deploy %s --project-name=agi-gs" % dist_dir)
        print("              wrangler deploy")
        return

    env = dict(os.environ)
    env["CLOUDFLARE_API_TOKEN"] = token

    # wrangler.cmd 内部会调用 node；确保 node 在 PATH 上
    # （python 子进程不继承交互式 shell 的 PATH，需显式补上）
    node_bin = _find_node_bin()
    if node_bin:
        env["PATH"] = node_bin + os.pathsep + env.get("PATH", "")
    else:
        print("  ⚠️ 未找到 node 可执行文件，wrangler 可能无法运行。")

    wbin = _wrangler_bin()
    ok = True

    # wrangler.toml 在 cloudflare/ 目录，两个部署都要从这里执行
    deploy_cwd = HERE

    # 1) Pages 项目（PWA 使用的 agi-gs.pages.dev）
    print("\n[部署 1/2] Pages 项目 agi-gs (agi-gs.pages.dev)")
    code, out = run([wbin, "pages", "deploy", dist_dir, "--project-name=agi-gs"],
                    cwd=deploy_cwd, env=env)
    if code != 0:
        ok = False
        print("  ❌ Pages 部署失败，关键输出:")
        for line in out.splitlines():
            ls = line.strip()
            if any(k in ls.lower() for k in ("error", "failed", "what went wrong")):
                print("      %s" % ls[:160])
    else:
        print("  ✅ Pages 部署成功 -> https://agi-gs.pages.dev")

    # 2) Worker（agi-gs.tomalso911.workers.dev，前端+后端同源）
    print("\n[部署 2/2] Worker (agi-gs.tomalso911.workers.dev)")
    code, out = run([wbin, "deploy"], cwd=deploy_cwd, env=env)
    if code != 0:
        ok = False
        print("  ❌ Worker 部署失败，关键输出:")
        for line in out.splitlines():
            ls = line.strip()
            if any(k in ls.lower() for k in ("error", "failed", "what went wrong")):
                print("      %s" % ls[:160])
    else:
        print("  ✅ Worker 部署成功 -> https://agi-gs.tomalso911.workers.dev")

    print("\n[部署] 双端%s" % ("全部完成 ✅" if ok else "存在失败 ❌，请查看上方输出"))


if __name__ == "__main__":
    main()
