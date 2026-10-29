# -*- coding: utf-8 -*-
"""把 android/app/build.gradle.kts 的 versionName 自动同步进网页（index.html）。

为什么要这个：
  网页顶栏/登录页/标题里的版本号以前是【手改】的，每次发版容易忘，
  这次就忘了 —— 网页一直显示 V2026.09.04.38。现在由构建脚本自动同步，
  版本号只认 build.gradle.kts 一处，三端（网页/手机/电脑）永不走散。

被同步的标记（index.html 内）：
  1. 注释            <!-- 版本号：V2026.09.05.01 - 确认新代码已加载 -->
  2. <title>         签约项目 · AGI-CRM v2026.09.05.01
  3. 登录页 loginVer <span id="loginVer">V2026.09.05.01</span>
  4. 页面缓存破坏    window._DASH_VER = '20260905.01'

幂等：可重复调用，内容一致时不改文件。
"""
import io
import os
import re
import sys


def read_version(root):
    """从 android/app/build.gradle.kts 读取 versionName。"""
    p = os.path.join(root, "android", "app", "build.gradle.kts")
    try:
        with io.open(p, encoding="utf-8") as f:
            m = re.search(r'versionName\s*=\s*"([^"]+)"', f.read())
        if m:
            return m.group(1).strip()
    except Exception:
        pass
    return None


def sync_index_version(root=None, log=print):
    """同步 index.html 的版本标记。返回版本号（失败返回 None）。"""
    root = root or os.path.dirname(os.path.abspath(__file__))
    ver = read_version(root)
    if not ver:
        log("[version] 未能从 build.gradle.kts 读取版本号，跳过同步")
        return None

    seq = ver.split(".")[-1]                       # "01"
    parts = ver.split(".")                         # ["V2026", "09", "05", "01"]
    date_part = parts[0].lstrip("Vv") + parts[1] + parts[2]   # "20260905"
    dash_ver = "%s.%s" % (date_part, seq)          # "20260905.01"

    p = os.path.join(root, "index.html")
    with io.open(p, encoding="utf-8") as f:
        html = f.read()
    orig = html

    # 1) 大写 V 的版本标记（注释 + 登录页 loginVer）
    html = re.sub(r"V\d{4}\.\d{2}\.\d{2}\.\d{2}", ver, html)
    # 2) 小写 v（<title>签约项目 · AGI-CRM v2026.09.05.01）
    html = re.sub(r"v\d{4}\.\d{2}\.\d{2}\.\d{2}", ver.lower(), html)
    # 3) 页面级缓存破坏版本（只动 window._DASH_VER，别的不碰）
    html = re.sub(r"(window\._DASH_VER\s*=\s*')\d{6,8}\.\d{2}(')",
                  lambda m: m.group(1) + dash_ver + m.group(2), html)

    if html != orig:
        with io.open(p, "w", encoding="utf-8") as f:
            f.write(html)
        log("[version] index.html 版本标记已同步为 %s" % ver)
    else:
        log("[version] index.html 版本标记已是 %s，无需修改" % ver)

    # ---- vault.html：私密空间版本号跟随主版本 ----
    # 同步三处：PIN 弹窗底部 vaultVer / 头部 ⓘ vaultHeadVer（含 title）/
    #          JS 自检常量 VAULT_VER（用于"有新版"检测，必须与主版本一致，
    #          否则每次打开都误报"有新版，点此更新"）。
    vp = os.path.join(root, "vault.html")
    if os.path.exists(vp):
        with io.open(vp, encoding="utf-8") as f:
            vhtml = f.read()
        vorig = vhtml
        vhtml = re.sub(r"V\d{4}\.\d{2}\.\d{2}\.\d{2}", ver, vhtml)
        if vhtml != vorig:
            with io.open(vp, "w", encoding="utf-8") as f:
                f.write(vhtml)
            log("[version] vault.html 版本标记已同步为 %s" % ver)
        else:
            log("[version] vault.html 版本标记已是 %s，无需修改" % ver)

    return ver


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sync_index_version()
