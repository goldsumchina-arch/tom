# -*- coding: utf-8 -*-
"""LANG-GEOMETRY-LOCK-20261026 硬锁
校验 index.html 中的「切语言几何冻结」实现没有被改回自适应的老写法。
任何一条不满足即 exit 1（供 pre-commit 拦截）。

用法: python check_lang_geom_lock.py [index.html 路径]
"""
import io
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "index.html")

FAILS = []


def load(path):
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def ck(cond, msg):
    if not cond:
        FAILS.append(msg)


def ck_no(html, pat, msg):
    if re.search(pat, html):
        FAILS.append(msg)


def ck_yes(html, pat, msg):
    if not re.search(pat, html):
        FAILS.append(msg)


def main():
    if not os.path.isfile(TARGET):
        print("[lang-geom-lock] 找不到文件: %s" % TARGET)
        return 1
    h = load(TARGET)

    # ① 契约标记必须存在
    ck_yes(h, r"LANG-GEOMETRY-LOCK-20261026", "① 缺少契约标记 LANG-GEOMETRY-LOCK-20261026")

    # ② 旧「二分缩小字号」算法必须彻底消失
    ck_no(h, r"var\s+baseFont\s*=", "② 旧算法残留：baseFont（二分缩字号）")
    ck_no(h, r"var\s+minFont\s*=", "② 旧算法残留：minFont（二分缩字号）")
    ck_no(h, r"menu\.scrollWidth\s*>\s*menu\.clientWidth",
          "② 旧算法残留：menu.scrollWidth > menu.clientWidth（溢出即缩字号）")

    # ③ 必须调用冻结入口
    ck_yes(h, r"LG\.freezeTopbar\(", "③ fitTopbarFontsNow 未调用 LG.freezeTopbar()")
    ck_yes(h, r"LG\.scheduleVerify\(", "③ applyTopbarLang 未调用 LG.scheduleVerify() 自检")

    # ④ 顶栏按钮必须是固定盒模型（文件里有多条 .tb-item 规则，取主样式那条）
    bodies = [m.group(1) for m in re.finditer(r"\.tb-item\s*\{(.*?)\}", h, re.S)]
    main = [b for b in bodies if "font-size:15px" in b.replace(" ", "")]
    ck(bool(main), "④ 找不到 .tb-item 主样式（必须含 font-size:15px）")
    if main:
        body = main[0]
        packed = body.replace(" ", "").replace("\n", "")
        ck("height:40px" in packed, "④ .tb-item 必须以 height:40px 固定高度")
        ck("inline-flex" in body, "④ .tb-item 必须 inline-flex 居中（禁止回到纯 inline 撑高）")
        # ★TOPBAR-ONE-LINE-UNIW-20261026★ 用户要求顶栏恒为一行、所有标签等宽取最长文案
        ck("white-space:nowrap" in body, "④ .tb-item 必须 white-space:nowrap（顶栏只许一行，禁止换行）")
        ck("white-space:normal" not in body, "④ .tb-item 不得又允许两行换行（white-space:normal）")
        ck("flex:0 0 auto" in body, "④ .tb-item 必须 flex:0 0 auto（宽度由 JS 定死）")

    # ④-b ★TOPBAR-NOJUMP-20261026★ 逐项定宽：每项宽度 = 该标签三语最长文案宽度；
    #     整排一行、切语言盒子不动（不闪跳）、不许按比例压缩到两行/裁字
    ck_yes(h, r"TOPBAR-NOJUMP-20261026", "④-b 缺少契约标记 TOPBAR-NOJUMP-20261026")
    ck_yes(h, r"menu\.style\.flexWrap\s*=\s*'nowrap'", "④-b freezeTopbar 必须把菜单锁成 flexWrap:nowrap")
    ck_yes(h, r"maxNavW\([^\n]*\bcompact\b", "④-b 定宽必须走 maxNavW(..., compact, font)（三语最长文案）")
    ck_no(h, r"nat\[i\]\s*\*\s*Math\.min\(k", "④-b 禁止回到「按各项自然宽比例压缩」的旧算法（会把长标签压成两行）")
    # ④-c 中文在紧凑模式下必须用全称（短称会让"签约项目"缩成"签约"），英/越才用短称
    ck_yes(h, r"_langNow\s*!==\s*'zh'", "④-c 紧凑模式必须让中文用全称（_langNow !== 'zh' 才取短称）")
    ck_yes(h, r"shortMode\s*&&\s*LANGS\[i\]\s*!==\s*'zh'",
           "④-c maxNavW 必须始终按中文全称量宽（shortMode && LANGS[i] !== 'zh'）")

    # ⑤ 大表必须是 fixed 布局（禁止 auto / max-content）
    m = re.search(r"\.won-scroll-container\s+table\s*\{(.*?)\}", h, re.S)
    ck(bool(m), "⑤ 找不到 .won-scroll-container table 规则")
    if m:
        body = m.group(1).replace(" ", "")
        ck("table-layout:fixed" in body, "⑤ .won-scroll-container table 必须 table-layout:fixed")
        ck("table-layout:auto" not in body, "⑤ .won-scroll-container table 不得回到 table-layout:auto")
        ck("width:max-content" not in body, "⑤ .won-scroll-container table 不得用 width:max-content")

    # ⑥ 表头高度必须锁死（★HEADER-WRAP-20261026★ 由单行 46px 改为可容纳 3 行的 54px：
    #    表头改为「换行完整显示、不省略」，高度仍必须是固定值，否则 zh/en/vi 行数不同会撑高表头）
    ck_yes(h, r"\.won-scroll-container\s+th\s*\{[^}]*height:54px",
           "⑥ .won-scroll-container th 必须固定 height:54px（表头高度不随语言变）")
    # ⑥-b 表头不得回到「单行 + 省略号」的截断写法（用户明确要求表头分行显示）
    ck_no(h, r"\.won-scroll-container\s+th\s*\{[^}]*white-space\s*:\s*nowrap",
          "⑥-b .won-scroll-container th 不得回到 white-space:nowrap（表头必须分行显示）")
    ck_no(h, r"\.won-scroll-container\s+th\s*\{[^}]*text-overflow\s*:\s*ellipsis",
          "⑥-b .won-scroll-container th 不得使用 text-overflow:ellipsis（表头不许省略号）")

    # ⑦ 表格列宽冻结模块必须在
    ck_yes(h, r"function\s+freezeTable\s*\(", "⑦ 缺少 freezeTable()（列宽冻结）")
    ck_yes(h, r"LG\.freezeAllTables", "⑦ 未导出 LG.freezeAllTables")
    ck_yes(h, r"lg_colw_v7_20261029", "⑦ 缺少列宽缓存 key（列宽必须来自中文基准缓存）")
    # 唯一允许存在的运行时测宽函数是历史遗留的 autoFitCommissionTable，
    # 它必须被 patchRenderer 包住（运行后用中文基准宽度覆盖回去）。
    ck_yes(h, r"patchRenderer\('autoFitCommissionTable'\)",
           "⑦ autoFitCommissionTable 未被 patchRenderer 包住（会在渲染后按当前语言重排列宽）")
    for m2 in re.finditer(r"function\s+(autoFit\w*Table)\s*\(", h):
        ck(m2.group(1) == "autoFitCommissionTable",
           "⑦ 出现了新的运行时自适应列宽函数: %s" % m2.group(1))

    # ⑧ 渲染器必须"渲染后同帧补冻"
    ck_yes(h, r"function\s+patchRenderer\s*\(", "⑧ 缺少 patchRenderer（渲染后同帧补冻）")
    ck_yes(h, r"patchRenderer\('renderWonThead'\)", "⑧ 未包 renderWonThead")
    ck_yes(h, r"patchRenderer\('renderCrmThead'\)", "⑧ 未包 renderCrmThead")
    ck_yes(h, r"patchRenderer\('renderLostThead'\)", "⑧ 未包 renderLostThead")

    # ⑨ 表单标签冻结必须在
    ck_yes(h, r"function\s+freezeLabels\s*\(", "⑨ 缺少 freezeLabels()（表单 label 定宽）")
    ck_yes(h, r"LG\.freezeLabels\s*=", "⑨ 未导出 LG.freezeLabels")

    # ⑩ 备注类长文本列必须单行省略（否则长备注撑高行高）
    ck_yes(h, r"NOTE_RE", "⑩ 缺少备注列识别 NOTE_RE")
    ck_yes(h, r"text-overflow:ellipsis", "⑩ 备注列缺少 ellipsis 省略")

    # ⑪ ★DASH-CHART-PERF-20261026★ 图表未就绪时不得清空父容器：
    #    旧写法 c.parentNode.innerHTML='…加载中…' 会把 canvas 一起删掉，
    #    之后 getElementById 拿不到画布 → 该图永久卡在"加载中"（省份图首当其冲）。
    ck_no(h, r"c\.parentNode\.innerHTML\s*=", "⑪ _ovMakeChart 不得用 c.parentNode.innerHTML 覆盖（会删掉 canvas）")
    ck_no(h, r"parent\.innerHTML\s*=\s*'<div style=\"text-align:center",
          "⑪ _ovMakeChart 异常分支不得整块覆盖父容器（用提示层）")
    ck_yes(h, r"function\s+_ovChartHint\s*\(", "⑪ 缺少 _ovChartHint（图表提示层）")
    ck_yes(h, r"function\s+_dashChartLibReady\s*\(", "⑪ 缺少 _dashChartLibReady（图表库就绪后重试渲染）")
    ck_yes(h, r"_renderCrmAggChart\s*\(", "⑪ 缺少 _renderCrmAggChart（聚合图必须复用 globalCrmData，不得重复拉整表）")

    print("[lang-geom-lock] %s" % ("FAIL" if FAILS else "OK"))
    for f in FAILS:
        print("   [x] " + f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
