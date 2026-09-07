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
    print("\n[1/4] 检查环境")
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

    # ---- 选择 Gradle ----
    print("\n[2/4] 选择 Gradle")
    gradle = find_local_gradle()
    if gradle:
        print("    本地缓存: %s" % gradle)
        gradle_cmd = [gradle]
    else:
        print("    未找到兼容的本地缓存，使用 gradlew.bat（需要联网下载）")
        gradle_cmd = [os.path.join(HERE, "gradlew.bat")]

    # ---- 编译：先离线，失败则联网 ----
    print("\n[3/4] 编译 APK（release 签名版）")
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
    print("\n[4/4] 复制 APK")
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
