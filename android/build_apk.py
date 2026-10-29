# -*- coding: utf-8 -*-
"""
AGI-PM 安卓 APK 一键打包脚本

解决的问题：
  批处理(.bat)对中文注释、嵌套循环解析不稳定，容易报
  "'xxx' is not recognized" 之类的错误。
  这里用 Python 完成全部逻辑，build_apk.bat 只负责调用本脚本。

功能：
  1. 自动查找本地已缓存的 Gradle（优先，无需联网）
  2. 先尝试离线编译，失败自动重试联网编译
  3. 编译成功后复制 APK 到 apk/ 目录

用法：
    双击 build_apk.bat
    或命令行： python build_apk.py
"""
import os
import sys
import glob
import shutil
import subprocess
import re

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
DISTS = os.path.join(os.path.expanduser("~"), ".gradle", "wrapper", "dists")
APK_SRC = os.path.join(HERE, "app", "build", "outputs", "apk", "release", "app-release.apk")
APK_DST_DIR = os.path.join(HERE, "apk")

# ★SITE-SNAPSHOT-SYNC-20261027：APK 内置的网页快照目录。
#   事故背景（2026-10-27）：assets/site/index.html 一直是 10-27 16:16 的旧版（.03），
#   而 MainActivity.handleSite() 在「清缓存后 + 首帧」时【优先返回内置快照】，
#   于是「装了新 APK 打开还是旧页面」反复出现 —— 网页明明已经部署到 .06。
#   根治：每次打包前把 node-backend/dist（=线上那份）同步进 assets/site。
ROOT_DIR = os.path.abspath(os.path.join(HERE, ".."))
DIST_DIR = os.path.join(ROOT_DIR, "node-backend", "dist")
SITE_ASSETS = os.path.join(HERE, "app", "src", "main", "assets", "site")


def read_version():
    """从 app/build.gradle.kts 读 versionName —— 版本号唯一真源。

    以前这里把文件名写死成 AGI-PM-V2026.09.04.38-release.apk，
    升级版本号后文件名仍停留在旧版本，导致"版本不同步"。
    现在与 Windows 的 build_desktop.py 读同一处，两边永远一致。
    """
    p = os.path.join(HERE, "app", "build.gradle.kts")
    try:
        txt = open(p, encoding="utf-8").read()
        m = re.search(r'versionName\s*=\s*"([^"]+)"', txt)
        if m:
            return m.group(1).strip()
    except Exception as e:
        print("    [WARN] 读取版本失败: %s" % e)
    return "V0.0.0.0"


APK_VER = read_version()
APK_DST = os.path.join(APK_DST_DIR, "AGI-PM-%s-release.apk" % APK_VER)

JAVA_HOME = r"C:\Program Files\Android\Android Studio\jbr"
ANDROID_HOME = os.path.join(os.path.expanduser("~"),
                            "AppData", "Local", "Android", "Sdk")


# Android Gradle Plugin 8.7.3 兼容 Gradle 8.x，不兼容 9.x
GRADLE_VER_MIN = (8, 0, 0)
GRADLE_VER_MAX = (8, 99, 99)


def find_local_gradle():
    """在本地缓存中找 Gradle，返回 gradle.bat 路径（取兼容范围内的最新版）"""
    if not os.path.isdir(DISTS):
        return None
    best = None
    best_ver = (0, 0, 0)
    pattern = os.path.join(DISTS, "*", "*", "gradle-*", "bin", "gradle.bat")
    for path in glob.glob(pattern):
        # 路径形如 ...\gradle-8.14.5\bin\gradle.bat
        name = os.path.basename(os.path.dirname(os.path.dirname(path)))
        m = re.match(r"gradle-(\d+)\.(\d+)(?:\.(\d+))?", name)
        if not m:
            continue
        ver = (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
        # 只看兼容范围；AGP 8.7.3 不支持 Gradle 9.x
        if ver < GRADLE_VER_MIN or ver > GRADLE_VER_MAX:
            continue
        if ver > best_ver:
            best_ver = ver
            best = path
    return best


def sync_site_assets():
    """把线上那份网页（node-backend/dist）同步进 APK 内置快照 assets/site。

    ★为什么必须先跑 build_dist：dist 是由 build_dist.py 从根目录 index.html
      复制并【版本同步】生成的。只改 index.html 不重建 dist，这里同步到的
      仍是旧文件；所以这里直接调用 build_dist 的 main()，保证三端同源。
    返回 True/False。
    """
    try:
        sys.path.insert(0, os.path.join(ROOT_DIR, "node-backend"))
        import build_dist  # noqa: E402  同仓库脚本，路径已加入
        build_dist.main()
    except Exception as e:
        print("    [WARN] build_dist 执行失败（继续用现有 dist）: %s" % e)

    src_index = os.path.join(DIST_DIR, "index.html")
    if not os.path.isfile(src_index):
        print("    [WARN] 未找到 %s，跳过内置快照同步（APP 可能显示旧页面！）" % src_index)
        return False

    os.makedirs(SITE_ASSETS, exist_ok=True)
    copied = 0
    for name in os.listdir(DIST_DIR):
        src = os.path.join(DIST_DIR, name)
        dst = os.path.join(SITE_ASSETS, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
            copied += 1
        else:
            shutil.copy2(src, dst)
            copied += 1

    # 打印内置快照的版本，便于确认「打包进去的到底是哪一版」
    try:
        with open(os.path.join(SITE_ASSETS, "index.html"), "r", encoding="utf-8", errors="replace") as f:
            head = f.read(20000)
        m = re.search(r"<title>([^<]*)</title>", head)
        print("    内置快照: %s 个条目  |  %s" % (copied, m.group(1) if m else "?"))
    except Exception:
        print("    内置快照: %s 个条目" % copied)
    return True


def run(cmd, cwd, env=None, timeout=1800):
    """cmd 为字符串列表，避免 shell=True 导致的引号/空格问题"""
    print("    > %s" % " ".join(cmd))
    r = subprocess.run(
        cmd, cwd=cwd, env=env,
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        timeout=timeout, shell=False,
    )
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out


def main():
    print("=" * 62)
    print("  AGI-PM APK Builder")
    print("=" * 62)
    print("  版本: %s   (来自 app/build.gradle.kts)" % APK_VER)
    print("  产物: %s" % os.path.basename(APK_DST))

    # ---- 环境检查 ----
    print("\n[1/5] 检查环境")
    java = os.path.join(JAVA_HOME, "bin", "java.exe")
    if not os.path.isfile(java):
        print("    [ERROR] 未找到 JDK: %s" % java)
        print("            请确认 Android Studio 已安装")
        return 1
    print("    JDK    : %s" % JAVA_HOME)

    if not os.path.isdir(ANDROID_HOME):
        print("    [ERROR] 未找到 Android SDK: %s" % ANDROID_HOME)
        return 1
    print("    SDK    : %s" % ANDROID_HOME)

    env = os.environ.copy()
    env["JAVA_HOME"] = JAVA_HOME
    env["ANDROID_HOME"] = ANDROID_HOME
    env["PATH"] = os.path.join(JAVA_HOME, "bin") + os.pathsep + env.get("PATH", "")

    # ---- 内置页面快照同步（★防止"装了新 APK 还是旧页面"）----
    print("\n[2/5] 同步内置页面快照（assets/site ← node-backend/dist）")
    sync_site_assets()

    # ---- 选择 Gradle ----
    print("\n[3/5] 选择 Gradle")
    gradle = find_local_gradle()
    if gradle:
        print("    本地缓存: %s" % gradle)
        gradle_cmd = [gradle]
    else:
        print("    未找到兼容的本地缓存，使用 gradlew.bat（需要联网下载）")
        gradle_cmd = [os.path.join(HERE, "gradlew.bat")]

    # ---- 编译：先离线，失败则联网 ----
    print("\n[4/5] 编译 APK（release 签名版）")
    print("    先尝试离线模式（不联网，用已缓存依赖）...")
    code, out = run(gradle_cmd + ["assembleRelease", "--offline", "--console=plain"],
                    cwd=HERE, env=env)

    if code != 0:
        print("    离线失败，改用联网模式重试...")
        # 打印关键错误，便于定位
        for line in out.splitlines():
            ls = line.strip()
            if ("error" in ls.lower() or "failed" in ls.lower()
                    or "what went wrong" in ls.lower()):
                print("      %s" % ls[:150])
        code, out = run(gradle_cmd + ["assembleRelease", "--console=plain"],
                        cwd=HERE, env=env)

    if code != 0:
        print("\n" + "=" * 62)
        print("  编译失败")
        print("=" * 62)
        print(out[-4000:])
        return 1

    # ---- 复制 APK ----
    print("\n[5/5] 复制 APK")
    if not os.path.isfile(APK_SRC):
        print("    [ERROR] 未找到编译产物: %s" % APK_SRC)
        return 1

    os.makedirs(APK_DST_DIR, exist_ok=True)
    shutil.copy2(APK_SRC, APK_DST)

    size_mb = os.path.getsize(APK_DST) / 1024 / 1024
    print("    -> %s" % APK_DST)
    print("    %.2f MB" % size_mb)

    print("\n" + "=" * 62)
    print("  打包成功")
    print("=" * 62)
    print("  文件: apk\\%s  (%.2f MB)" % (os.path.basename(APK_DST), size_mb))
    print("  把这个文件发到手机安装即可。")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired:
        print("\n[ERROR] 编译超时（30 分钟）。请检查网络后重试。")
        sys.exit(1)
    except Exception as e:
        print("\n[ERROR] %s" % e)
        import traceback
        traceback.print_exc()
        sys.exit(1)
