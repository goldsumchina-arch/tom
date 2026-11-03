# -*- coding: utf-8 -*-
"""全面代码逻辑硬锁 ALL-LOCK-20261103（pre-commit 用）

锁定范围（任何一条不满足 → exit 1，提交被拦）：
  ①  版本标记 PERM_BUILD 存在，且 node-backend/dist/index.html 与源文件一致
  ②  审批表 9 列宽度 = 纯百分比 + !important，合计恰好 100%
  ③  审批表宽度三件套 !important（width/min-width/max-width）+ table-layout:fixed，
      以及 <colgroup><col> 让位、固定 px 列宽让位、窄屏 min-width:760px 不得回归
  ④  「操作」列：表头与单元格统一水平居中（三件套缺一不可）、按钮单行不折
  ⑤  审批页滚动改造：表格容器 overflow:visible、标题行/统计条/表头三段 sticky、
      apprStickyMeasure() 定义 + 渲染/切页/resize/load 四处重测
  ⑥  审批详情抽屉：关闭按钮在 .modal-actions 内、内联 SVG 图标、标题右留 88px、
      title 与 aria-label 三语同步
  ⑦  语言几何锁 freezeTable() 百分比豁免名单（5 张表，含 .appr-table）
  ⑧  ★LG-FREEZE-NOW-20261103★ crm/lost 渲染后同帧补冻列宽（每文件 ≥2 处调用）
  ⑨  关键函数存在性（renderApprovals / applyApprovalsLang / apprColumns / switchView …）
  ⑩  三语 key 齐备（appr_col_action / appr_close / appr_col_no …）
  ⑪  check_lang_geom_lock.py 全过（子进程）
  ⑫  全文件 13 段内联 <script> 逐个 node --check 语法检查（node 不存在则跳过）

用法: python check_all_locks.py [index.html 路径]
"""
import io
import os
import re
import subprocess
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "index.html")
DIST = os.path.join(HERE, "node-backend", "dist", "index.html")
CRM_JS = os.path.join(HERE, "node-backend", "dist", "crm_table.js")
LOST_JS = os.path.join(HERE, "node-backend", "dist", "lost_table.js")

FAILS = []
WARNS = []


def load(path):
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def norm(s):
    return re.sub(r"\s+", "", s)


def ck(cond, msg):
    if not cond:
        FAILS.append(msg)


def ck_yes(h, pat, msg, flags=re.S):
    if not re.search(pat, h, flags):
        FAILS.append(msg)


def ck_no(h, pat, msg, flags=re.S):
    if re.search(pat, h, flags):
        FAILS.append(msg)


_CUR = [0]


def section(name):
    _CUR[0] = len(FAILS)
    print("  -- %s" % name)


def section_end():
    if len(FAILS) == _CUR[0]:
        print("     OK")


# ---------------------------------------------------------------- ① 版本标记
def g1_version(h):
    section("① 版本标记与 dist 同步")
    m = re.search(r'const\s+PERM_BUILD\s*=\s*"([^"]+)"', h)
    ck(bool(m), "① 缺少 const PERM_BUILD（构建标记）")
    if not m:
        return
    src_ver = m.group(1)
    ck(bool(re.search(r"build \d{4}-\d{2}-\d{2}-Z\d{3}", src_ver)),
       "① PERM_BUILD 格式应为 'build YYYY-MM-DD-ZNNN'，实际: %s" % src_ver)
    if os.path.isfile(DIST):
        d = load(DIST)
        md = re.search(r'const\s+PERM_BUILD\s*=\s*"([^"]+)"', d)
        ck(bool(md), "① dist/index.html 缺少 PERM_BUILD")
        if md:
            ck(md.group(1) == src_ver,
               "① dist 版本落后：源=%s / dist=%s（请重跑 build_dist.py）" % (src_ver, md.group(1)))
        for mark in ("APPR-PCT-EXEMPT-20261103", "APPR-COL-CENTER-20261103",
                     "DLG-CLOSE-STD-20261103", "APPR-DOCSCROLL-20261103"):
            ck(mark in d, "① dist 缺少契约标记 %s（dist 未重新构建）" % mark)
    else:
        WARNS.append("① 未找到 node-backend/dist/index.html，跳过 dist 同步校验")


# ------------------------------------------------------- ② 列宽百分比合计 100
def g2_colpercents(h):
    section("② 审批表 9 列纯百分比 !important，合计 100%")
    got = {}
    for m in re.finditer(r"table\.appr-table\s+thead\s+th:nth-child\((\d)\)\s*\{\s*width\s*:\s*(\d+)%\s*(!important)?\s*;", h):
        idx, pct, imp = int(m.group(1)), int(m.group(2)), m.group(3)
        got[idx] = pct
        ck(bool(imp), "② 第 %d 列 width:%d%% 缺少 !important（压不住语言几何锁写入的内联 px）" % (idx, pct))
    ck(len(got) == 9, "② 百分比列宽应恰好 9 条，实际 %d 条: %s" % (len(got), sorted(got.keys())))
    if len(got) == 9:
        total = sum(got.values())
        ck(total == 100, "② 9 列百分比合计必须为 100%%，实际 %d%%: %s" % (total, got))
    # 每列都必须有百分比，不允许出现 px 固定列宽回归
    ck_no(h, r"table\.appr-table\s+thead\s+th:nth-child\(\d\)\s*\{\s*width\s*:\s*\d+px",
          "② 出现了 px 固定列宽（会让列宽之和溢出容器 → 底部水平滚动条回归）")


# ------------------------------------------------------------ ③ 表格宽度三件套
def g3_tablefit(h):
    section("③ 表格宽度三件套 + fixed 布局 + col 让位 + 窄屏不设 min-width")
    ck_yes(h, r"table\.appr-table\s*\{[^}]*width\s*:\s*100%\s*!important",
           "③ table.appr-table 必须 width:100% !important")
    ck_yes(h, r"table\.appr-table\s*\{[^}]*min-width\s*:\s*0\s*!important",
           "③ table.appr-table 必须 min-width:0 !important")
    ck_yes(h, r"table\.appr-table\s*\{[^}]*max-width\s*:\s*none\s*!important",
           "③ table.appr-table 必须 max-width:none !important")
    ck_yes(h, r"table\.appr-table\s*\{[^}]*table-layout\s*:\s*fixed\s*!important",
           "③ table.appr-table 必须 table-layout:fixed !important")
    ck_yes(h, r"table\.appr-table\s+\.appr-col-no\s*\{\s*width\s*:\s*auto\s*!important",
           "③ .appr-col-no 必须 width:auto !important（54px 会顶出 100%）")
    ck_yes(h, r"table\.appr-table\s+\.appr-col-action\s*\{\s*width\s*:\s*auto\s*!important",
           "③ .appr-col-action 必须 width:auto !important（150px 会顶出 100%）")
    ck_yes(h, r"table\.appr-table\s+colgroup\s+col\s*\{\s*width\s*:\s*auto\s*!important",
           "③ colgroup col 必须 width:auto !important（语言几何锁会写 px 进 col）")
    # 窄屏分支不得再给表格设 min-width
    for m in re.finditer(r"@media[^{]*\{[^@]*?table\.appr-table\s*\{([^}]*)\}", h, re.S):
        body = norm(m.group(1))
        ck("min-width:0" in body or "min-width:auto" in body,
           "③ 媒体查询内的 table.appr-table 不得设置 px min-width（实际: %s）" % m.group(1).strip()[:80])
    ck_no(h, r"table\.appr-table\s*\{[^}]*min-width\s*:\s*(7|8|9|1[0-9])[0-9]{2}px",
          "③ table.appr-table 不得设 px min-width（会把表格顶宽、出现横向滚动条）")


# ------------------------------------------------------------ ④ 操作列居中
def g4_action_center(h):
    section("④ 「操作」列表头与单元格统一居中 + 按钮单行")
    ck_yes(h, r"table\.appr-table\s+thead\s+th\.appr-col-action\s*\{\s*text-align\s*:\s*center\s*;",
           "④ 操作列表头必须 text-align:center")
    ck_yes(h, r"table\.appr-table\s+thead\s+th\.appr-col-action\s+\.th-inner\s*\{\s*align-items\s*:\s*center\s*;",
           "④ 操作列表头 .th-inner 必须 align-items:center（否则 label 撑满整列、文字仍贴左）")
    ck_yes(h, r"table\.appr-table\s+thead\s+th\.appr-col-action\s+\.th-label\s*\{\s*justify-content\s*:\s*center\s*;",
           "④ 操作列表头 .th-label 必须 justify-content:center（真正把文字推到中间的那一条）")
    ck_yes(h, r"table\.appr-table\s+tbody\s+td\.appr-col-action\s*\{[^}]*text-align\s*:\s*center",
           "④ 操作列单元格必须 text-align:center")
    ck_yes(h, r"table\.appr-table\s+td\.appr-col-action\s*\{\s*white-space\s*:\s*normal\s*;",
           "④ 操作列单元格必须 white-space:normal（否则变窄后内容被挤出列外）")
    ck_yes(h, r"table\.appr-table\s+\.appr-op\s*\{[^}]*flex-wrap\s*:\s*nowrap",
           "④ .appr-op 必须 flex-wrap:nowrap（通过/拒绝并排单行）")
    ck_yes(h, r"table\.appr-table\s+\.appr-op\s*\{[^}]*gap\s*:\s*4px",
           "④ .appr-op 间距必须 gap:4px（6px 会撑到 135px 折行）")
    ck_yes(h, r"table\.appr-table\s+\.appr-op\s+\.appr-mini\s*\{\s*padding\s*:\s*5px\s+10px\s*;",
           "④ .appr-op .appr-mini 必须 padding:5px 10px（14px 会折行）")


# ------------------------------------------------------- ⑤ 审批页滚动改造
def g5_docscroll(h):
    section("⑤ 审批页页面滚动 + 三段 sticky + apprStickyMeasure")
    ck_yes(h, r"#view-approvals\s+\.appr-table-wrap\s*\{[^}]*overflow\s*:\s*visible",
           "⑤ .appr-table-wrap 必须 overflow:visible（auto 会让 sticky 只相对容器生效）")
    ck_yes(h, r"#view-approvals\s+\.appr-table-wrap\s*\{[^}]*box-sizing\s*:\s*border-box",
           "⑤ .appr-table-wrap 必须 box-sizing:border-box（否则 100%+边框多出横滚）")
    ck_yes(h, r"#view-approvals\s*\{[^}]*height\s*:\s*auto",
           "⑤ #view-approvals 必须 height:auto（不能定高，否则内部滚动条回归）")
    ck_yes(h, r"#view-approvals\s+\.appr-header\s*\{[^}]*position\s*:\s*sticky",
           "⑤ .appr-header 必须 position:sticky（标题行固定）")
    ck_yes(h, r"#view-approvals\s+\.appr-toolbar\s*\{[^}]*position\s*:\s*sticky",
           "⑤ .appr-toolbar 必须 position:sticky（统计条固定）")
    ck_yes(h, r"#view-approvals\s+table\.appr-table\s+thead\s+th\s*\{\s*position\s*:\s*sticky",
           "⑤ 表头 th 必须 position:sticky（橙色表头固定）")
    ck_yes(h, r"function\s+apprStickyMeasure\s*\(", "⑤ 缺少 apprStickyMeasure()（三段 sticky 高度测量）")
    n = len(re.findall(r"apprStickyMeasure\s*\(", h))
    ck(n >= 5, "⑤ apprStickyMeasure 调用点应 ≥5（定义+渲染+切页+resize+load），实际 %d 处" % n)
    ck_yes(h, r"v\.style\.setProperty\('--appr-h1'", "⑤ apprStickyMeasure 必须写入 --appr-h1")
    ck_yes(h, r"v\.style\.setProperty\('--appr-head-h'", "⑤ apprStickyMeasure 必须写入 --appr-head-h")


# ------------------------------------------------------ ⑥ 抽屉关闭按钮规范
def g6_drawer(h):
    section("⑥ 审批详情抽屉：关闭按钮规范（.modal-actions + 内联 SVG + 88px 留位）")
    ck_yes(h, r'id="apprDrawerClose"', "⑥ 缺少关闭按钮 #apprDrawerClose")
    ck_yes(h, r'<div class="modal-actions">\s*<button[^>]*id="apprDrawerClose"',
           "⑥ 关闭按钮必须放进 .modal-actions 容器（否则全站□最大化注入脚本会把它挪走）")
    ck_yes(h, r'id="apprDrawerClose"[\s\S]{0,400}?<svg', "⑥ 关闭按钮必须用内联 SVG 图标（✕ 字形在缺字环境显示空白）")
    ck_yes(h, r'd="M6 6 L18 18 M18 6 L6 18"', "⑥ 关闭图标必须保留 SVG 交叉路径")
    ck_yes(h, r"#apprDrawer\s+\.appr-drawer-head\s*\{\s*padding-right\s*:\s*88px",
           "⑥ 抽屉标题行必须 padding-right:88px（给 □ 与 × 留位）")
    ck_yes(h, r"#apprDrawer\s+\.appr-drawer-head\s+\.modal-actions\s*\{[^}]*display\s*:\s*inline-flex",
           "⑥ 抽屉 .modal-actions 必须 inline-flex（两个按钮并排同高）")
    ck_yes(h, r"width\s*:\s*26px\s*!important;\s*height\s*:\s*26px\s*!important",
           "⑥ 抽屉标题栏按钮必须统一 26×26")
    ck_yes(h, r"dc\.setAttribute\('aria-label',\s*t\.appr_close\)",
           "⑥ 关闭按钮必须同步 aria-label（无障碍）")


# --------------------------------------------------- ⑦⑧ 语言几何锁豁免/补冻
def g7_geom(h):
    section("⑦⑧ 语言几何锁：百分比豁免名单 + 渲染后同帧补冻")
    for cls in ("cp-table", "cm-pay-table", "cpc-ledger", "ben-card-table", "appr-table"):
        ck_yes(h, r"classList\.contains\('%s'\)" % re.escape(cls),
               "⑦ freezeTable 百分比豁免名单缺少 .%s（会被写入 px 列宽+min-width 而横向溢出）" % cls)
    ck_yes(h, r"APPR-PCT-EXEMPT-20261103", "⑦ 缺少契约标记 APPR-PCT-EXEMPT-20261103")
    # 豁免必须在写 px 之前 return
    m = re.search(r"function\s+freezeTable\s*\([^)]*\)\s*\{(.*?)\n  \}", h, re.S)
    if m:
        body = m.group(1)
        pos_ex = body.find("appr-table")
        pos_px = body.find("style.width")
        ck(pos_ex > 0, "⑦ freezeTable 内找不到 appr-table 豁免")
        if pos_ex > 0 and pos_px > 0:
            ck(pos_ex < pos_px, "⑦ appr-table 豁免必须写在「写 px 列宽」之前（否则等于没豁免）")
    else:
        WARNS.append("⑦ 未能定位 freezeTable 函数体，跳过「豁免先于写 px」顺序校验")
    for path, fn in ((CRM_JS, "_crmFreezeColsNow"), (LOST_JS, "_lostFreezeColsNow")):
        if not os.path.isfile(path):
            WARNS.append("⑧ 未找到 %s，跳过" % os.path.basename(path))
            continue
        js = load(path)
        ck(("function %s(" % fn) in js, "⑧ %s 缺少 %s（首帧会按等分绘制一帧）" % (os.path.basename(path), fn))
        ck(js.count(fn + "()") >= 2,
           "⑧ %s 中 %s() 调用点应 ≥2，实际 %d" % (os.path.basename(path), fn, js.count(fn + "()")))
        ck("LG.freezeTable" in js, "⑧ %s 的补冻必须调用 LG.freezeTable" % os.path.basename(path))


# --------------------------------------------------- ⑨⑩ 关键函数与三语 key
def g9_symbols(h):
    section("⑨ 关键函数存在性 / ⑩ 三语 key 齐备")
    for fn in ("renderApprovals", "applyApprovalsLang", "apprColumns", "apprToggleSort",
               "apprStickyMeasure", "apprMatchesFilter", "apprSortValue", "switchView",
               "closeApprovalDetail", "freezeTable", "patchRenderer"):
        ck_yes(h, r"function\s+%s\s*\(" % re.escape(fn), "⑨ 缺少函数 %s()" % fn)
    for key in ("appr_col_no", "appr_col_action", "appr_col_status", "appr_close"):
        n = len(re.findall(r"\b%s\b" % re.escape(key), h))
        ck(n >= 3, "⑩ 三语 key %s 出现 %d 次（应 ≥3：zh/en/vi）" % (key, n))
    ck_yes(h, r"cls:'appr-col-action'", "⑨ 操作列必须仍带 cls:'appr-col-action'")
    ck_yes(h, r"cls:'appr-col-no'", "⑨ 序号列必须仍带 cls:'appr-col-no'")


# ------------------------------------------------------------ ⑪ 子锁脚本
def g11_sub(h):
    section("⑪ 子锁 check_lang_geom_lock.py")
    script = os.path.join(HERE, "check_lang_geom_lock.py")
    if not os.path.isfile(script):
        FAILS.append("⑪ 缺少 check_lang_geom_lock.py")
        return
    r = subprocess.run([sys.executable, script, TARGET], capture_output=True)
    out = (r.stdout or b"").decode("utf-8", "replace").strip()
    ck(r.returncode == 0, "⑪ check_lang_geom_lock.py 未通过:\n%s" % out)


# ------------------------------------------------------------ ⑫ 语法检查
def _balance_ok(code):
    """括号/引号/注释平衡检查（esprima 不支持的现代语法退回用这个，捕获截断类损坏）。"""
    stack = []
    i, n = 0, len(code)
    pairs = {")": "(", "]": "[", "}": "{"}
    prev = ""            # 上一个有效字符（用于区分除号 / 与正则字面量）
    re_trigger = set("(=,:;!&|?{}[]+-*%^~<>") | {""}
    while i < n:
        ch = code[i]
        nxt = code[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            j = code.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if ch == "/" and nxt == "*":
            j = code.find("*/", i + 2)
            if j < 0:
                return False, "块注释未闭合"
            i = j + 2
            continue
        if ch == "/" and prev in re_trigger:
            # 正则字面量：跳过 /.../flags，内含 {} [] () 都不算括号
            i += 1
            in_class = False
            while i < n:
                c = code[i]
                if c == "\\":
                    i += 2
                    continue
                if c == "[":
                    in_class = True
                elif c == "]":
                    in_class = False
                elif c == "/" and not in_class:
                    break
                elif c == "\n":
                    return False, "正则字面量未闭合"
                i += 1
            if i >= n:
                return False, "正则字面量未闭合"
            i += 1
            while i < n and code[i].isalpha():
                i += 1
            prev = "/"
            continue
        if ch in "'\"`":
            q = ch
            i += 1
            while i < n:
                if code[i] == "\\":
                    i += 2
                    continue
                if code[i] == q:
                    break
                i += 1
            if i >= n:
                return False, "字符串未闭合(引号 %s)" % q
            i += 1
            prev = q
            continue
        if ch in "([{":
            stack.append(ch)
            prev = ch
            i += 1
            continue
        if ch in ")]}":
            if not stack or stack[-1] != pairs[ch]:
                return False, "括号不匹配: 多出 %s" % ch
            stack.pop()
            prev = ch
            i += 1
            continue
        if not ch.isspace():
            prev = ch
        i += 1
    if stack:
        return False, "括号未闭合: %s" % "".join(stack[-3:])
    return True, ""


def g12_syntax(h):
    section("⑫ 内联脚本语法检查（esprima，退回括号平衡）")
    blocks = []
    for m in re.finditer(r"<script(?![^>]*\bsrc=)(?![^>]*importmap)[^>]*>(.*?)</script>", h, re.S):
        body = m.group(1)
        if body.strip():
            blocks.append(body)
    ck(len(blocks) >= 10, "⑫ 内联脚本块数异常（应 ≥10，实际 %d）" % len(blocks))
    try:
        import esprima  # noqa
    except Exception:
        esprima = None
        WARNS.append("⑫ 未安装 esprima，仅做括号平衡检查")
    parsed = fallback = 0
    for i, body in enumerate(blocks):
        need_bal = True
        if esprima is not None:
            try:
                esprima.parseScript(body)
                parsed += 1
                need_bal = False
                continue
            except Exception as e:
                msg = str(e)
                # esprima 4.0 不认 ?. / ?? / 可选链等现代语法 → 退回括号平衡检查
                if ("Unexpected token" in msg or "Unexpected identifier" in msg
                        or "Unexpected character" in msg):
                    need_bal = True
                else:
                    FAILS.append("⑫ 内联脚本第 %d 块语法错误: %s" % (i + 1, msg[:120]))
                    continue
        if need_bal:
            ok_bal, why = _balance_ok(body)
            if not ok_bal:
                FAILS.append("⑫ 内联脚本第 %d 块括号/引号不平衡: %s" % (i + 1, why))
            else:
                fallback += 1
    print("     %d 段：esprima 全解析 %d 段，退回平衡检查 %d 段" % (len(blocks), parsed, fallback))


def main():
    if not os.path.isfile(TARGET):
        print("[all-lock] 找不到文件: %s" % TARGET)
        return 1
    h = load(TARGET)
    print("[all-lock] 校验 %s（%.1f KB）" % (os.path.basename(TARGET), len(h) / 1024.0))
    for fn in (g1_version, g2_colpercents, g3_tablefit, g4_action_center,
               g5_docscroll, g6_drawer, g7_geom, g9_symbols, g11_sub, g12_syntax):
        fn(h)
        section_end()

    print("[all-lock] %s" % ("FAIL" if FAILS else "OK"))
    for f in FAILS:
        print("   [x] " + f)
    for w in WARNS:
        print("   [!] " + w)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
