# -*- coding: utf-8 -*-
"""验证 APK 文件完整性"""
import os
import sys
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import glob

HERE = os.path.dirname(os.path.abspath(__file__))

# 自动查找 apk/ 目录下最新的 APK，避免文件名写死
cands = sorted(glob.glob(os.path.join(HERE, "apk", "*.apk")),
               key=os.path.getmtime, reverse=True)
if not cands:
    print("No APK found in apk/")
    sys.exit(1)
APK = cands[0]

if not os.path.isfile(APK):
    print("APK not found: %s" % APK)
    sys.exit(1)

z = zipfile.ZipFile(APK)
names = z.namelist()

icons = [x for x in names if "ic_launcher" in x and x.endswith(".png")]
dexes = [x for x in names if x.endswith(".dex")]

print("=" * 56)
print("  APK Verification")
print("=" * 56)
print("  File      : %s" % APK)
print("  Size      : %.2f MB" % (os.path.getsize(APK) / 1024 / 1024))
print("  Entries   : %d" % len(names))
print()
print("  AndroidManifest.xml : %s" % ("YES" if "AndroidManifest.xml" in names else "NO"))
print("  resources.arsc      : %s" % ("YES" if "resources.arsc" in names else "NO"))
print("  Launcher icons      : %d" % len(icons))
for i in sorted(set(os.path.dirname(x) for x in icons)):
    print("      %s" % i)
print("  DEX files           : %s" % ", ".join(dexes))
print("=" * 56)

ok = ("AndroidManifest.xml" in names and dexes and len(icons) >= 5)
print("  Result: %s" % ("APK OK - ready to install" if ok else "APK INCOMPLETE"))
print("=" * 56)
sys.exit(0 if ok else 1)
