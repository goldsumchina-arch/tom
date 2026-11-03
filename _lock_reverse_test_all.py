# -*- coding: utf-8 -*-
"""ALL-LOCK-20261103 反向测试：故意篡改副本，确认 check_all_locks.py 能拦住。

用法: python _lock_reverse_test_all.py
预期输出: 10/10 全部被拦截
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "index.html")
LOCK = os.path.join(HERE, "check_all_locks.py")

# (名称, 原串, 改成)
CASES = [
    ("① 列宽百分比合计不再是 100%",
     "table.appr-table thead th:nth-child(9) { width:16% !important; }",
     "table.appr-table thead th:nth-child(9) { width:15% !important; }"),
    ("② 列宽丢 !important（压不住几何锁内联 px）",
     "table.appr-table thead th:nth-child(4) { width:19% !important; }",
     "table.appr-table thead th:nth-child(4) { width:19%; }"),
    ("③ 操作列表头不再居中",
     "table.appr-table thead th.appr-col-action .th-label { justify-content:center; }",
     "table.appr-table thead th.appr-col-action .th-label { justify-content:flex-start; }"),
    ("④ 表格宽度丢 !important",
     "table.appr-table { width:100% !important; min-width:0 !important; max-width:none !important;",
     "table.appr-table { width:100%; min-width:0 !important; max-width:none !important;"),
    ("⑤ 审批表从语言几何锁豁免名单移除（类名写错即视为移除）",
     "        || tbl.classList.contains('appr-table'))) {",
     "        || tbl.classList.contains('appr-table-x'))) {"),
    ("⑥ 关闭按钮 aria-label 同步被删",
     "if (dc){ dc.title = t.appr_close; dc.setAttribute('aria-label', t.appr_close); }",
     "if (dc){ dc.title = t.appr_close; }"),
    ("⑦ 抽屉标题行不再留 88px",
     "#apprDrawer .appr-drawer-head { padding-right:88px; }",
     "#apprDrawer .appr-drawer-head { padding-right:0; }"),
    ("⑧ 表格容器 overflow 改回 auto",
     "  #view-approvals .appr-table-wrap {\n    overflow:visible;",
     "  #view-approvals .appr-table-wrap {\n    overflow:auto;"),
    ("⑨ 内联脚本被人为截断（语法损坏）",
     "function apprStickyMeasure(){",
     "function apprStickyMeasure({{{"),
    ("⑩ 版本标记与 dist 不一致",
     'const PERM_BUILD = "build 2026-11-03-Z282"',
     'const PERM_BUILD = "build 2026-11-03-Z999"'),
]


def main():
    with io.open(SRC, "r", encoding="utf-8", errors="replace") as f:
        # 统一成 LF 再比对：源文件是 CRLF，而用例里的换行写作 \n
        html = f.read().replace("\r\n", "\n")
    tmpdir = tempfile.mkdtemp(prefix="lock_rev_")
    caught = 0
    for i, (name, old, new) in enumerate(CASES, 1):
        if old not in html:
            print("  [!!] %d %s —— 原串未找到，用例失效（代码可能已改）" % (i, name))
            continue
        path = os.path.join(tmpdir, "mut%02d.html" % i)
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(html.replace(old, new, 1))
        r = subprocess.run([sys.executable, LOCK, path], capture_output=True)
        out = (r.stdout or b"").decode("utf-8", "replace")
        hit = r.returncode == 1
        caught += 1 if hit else 0
        print("  [%s] %d %s" % ("OK" if hit else "MISS", i, name))
        if not hit:
            print(out[-500:])
    total = len(CASES)
    print("[reverse] %d/%d 被拦截" % (caught, total))
    shutil.rmtree(tmpdir, ignore_errors=True)
    return 0 if caught == total else 1


if __name__ == "__main__":
    sys.exit(main())
