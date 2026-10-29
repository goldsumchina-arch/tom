# -*- coding: utf-8 -*-
"""
CRM 逻辑锁 (crm_lock.py)

用途：把已经验收通过的 CRM 行为固化成基线，防止后续任何改动（包括我自己的改动）造成回归。

用法：
    python crm_lock.py                      检查是否被改动（退出码 0=锁定完好 / 1=硬错误 / 2=有漂移待批准）
    python crm_lock.py --approve "原因"      确认当前状态为新的基线（必须写明原因）

检查分三层：
  【硬性】翻译缺漏：三语字典 key 必须一一对应（zh/en/vi）
  【硬性】语言跟随总控与两个 CRM 弹窗的登记不能丢
  【漂移】CRM 相关词条（crm_ / fr_ / ec / pdf / lost_ / won_fail / btn）的值、
          以及 crm_table.js、lost_table.js 的文件内容，任何变动都必须先用 --approve 批准
"""
import re
import os
import sys
import json
import hashlib
import datetime

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(ROOT, 'index.html')
BASELINE = os.path.join(ROOT, 'crm_lock_baseline.json')

def _discover_js():
    """项目根目录下所有 JS 模块（看板/CRM/WON/LOST/个人佣金 的前端逻辑）"""
    import glob
    names = [os.path.basename(p) for p in glob.glob(os.path.join(ROOT, '*.js'))
             if not os.path.basename(p).startswith('_')]
    return sorted(set(['crm_table.js', 'lost_table.js'] + names))

LOCKED_FILES = _discover_js()
# True = 全部三语词条都受锁（看板/CRM/WON/LOST/个人佣金 全部文案）
LOCK_ALL_KEYS = True
LOCKED_PREFIXES = ('crm_', 'fr_', 'ec', 'pdf', 'lost_', 'won_fail', 'btn')

# 硬性不变量：这些字符串一旦消失，说明语言跟随机制被破坏
INVARIANTS = [
    ('语言跟随总控 applyLangRefreshers', 'window.applyLangRefreshers = function'),
    ('导出确认弹窗已登记跟随', 't.ecTitle || ec.innerText'),
    ('导出类型记录 __exportType', 'window.__exportType'),
    ('失败原因弹窗已登记跟随（含下拉占位符）', 't.crm_fail_reason_placeholder'),
    ('失败原因下拉选项跟随', 'sel.options[fi].text = t[fk[fi - 1]]'),
    # ↓ 2026-09-05 验收通过的行为，禁止回退
    ('弹窗可见性判断（fixed 弹窗不能用 offsetParent）', 'getBoundingClientRect().height > 0'),
    ('复制项目弹窗取实时语言', '_Lcp = (window.CUR_LANG'),
    ('报告弹窗取实时语言', '_Lrpt = (window.CUR_LANG'),
    ('WON 报告弹窗登记跟随', 'window.__rptOpener'),
    ('客户付款报告登记跟随', 'window.__cprOpener'),
    ('WON 箭头常驻且边界灰锁', 'gray(b, i === 0)'),
    ('PDF 预览带登录凭证取文件', "Authorization': 'Bearer '"),
    ('翻译 429 冷却（防刷屏）', 'window.__mmCool'),
    ('付款方式弹窗取实时语言', 'window.CUR_LANG || CUR_LANG'),
    ('付款方式弹窗登记跟随', 'window.__pmvRefresh'),
    # ↓ WON 签约项目专项（2026-09-05 验收通过）
    ('WON 箭头状态校正函数', 'window.refreshMoveBtnState'),
    ('WON 表格渲染即锁定（监听整个 body）', 'mo.observe(document.body'),
    ('WON 两个箭头始终渲染（无条件）', 'var moveUpBtn ='),
    ('WON 首行↑灰锁', 'gray(b, i === 0)'),
    ('WON 末行↓灰锁', 'gray(b, i === downs.length - 1)'),
]

# 禁止出现的写法（回归保护）：一旦出现即判定为硬性错误
FORBIDDEN = [
    ('WON 箭头不得按行号条件渲染（必须始终显示两个箭头）', '(idx > 0) ?'),
    ('WON 边界箭头不得被删除（必须灰色锁死，而不是移除）', 'if (i === 0) { b.remove(); }'),
    ('弹窗不得再用不更新的旧语言变量', "var cur = CUR_LANG || 'en';"),
]
CRM_JS_INVARIANTS = {
    'crm_table.js': [
        ('失败原因弹窗文案三语设置', 't.crm_fail_reason_title'),
    ],
}


def read(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return f.read()


def brace_block(src, start):
    """从 '{' 位置开始做括号配对，返回整块文本（跳过字符串内的括号）"""
    depth, i, n, quote = 0, start, len(src), None
    while i < n:
        ch = src[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
        else:
            if ch in '"\'':
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return src[start:i + 1]
        i += 1
    return src[start:]


PAIR = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(["\'])(.*?)\2\s*[,}]', re.S)


def parse_dict(block):
    out = {}
    for m in PAIR.finditer(block):
        out[m.group(1)] = m.group(3)
    return out


def extract_groups(src):
    """提取 index.html 中所有 zh/en/vi 三语字典（按出现顺序分组）"""
    groups, cur = [], {}
    for m in re.finditer(r'(?m)^[ \t]{2}(zh|en|vi):[ \t]*\{', src):
        lang, idx = m.group(1), m.end() - 1
        if lang == 'zh' and cur:
            groups.append(cur)
            cur = {}
        line = src[:m.start()].count('\n') + 1
        cur.setdefault('__line__', line)
        cur[lang] = parse_dict(brace_block(src, idx))
    if cur:
        groups.append(cur)
    return groups


def current_version(src):
    m = re.search(r'V\d{4}\.\d{2}\.\d{2}\.\d{2}', src)
    return m.group(0) if m else 'unknown'


def snapshot():
    src = read(INDEX)
    groups = extract_groups(src)
    i18n = {}
    for g in groups:
        name = 'dict@%d' % g['__line__']
        i18n[name] = {k: g[k] for k in ('zh', 'en', 'vi') if k in g}
    files = {}
    for fn in LOCKED_FILES:
        p = os.path.join(ROOT, fn)
        if os.path.exists(p):
            files[fn] = hashlib.sha256(read(p).encode('utf-8')).hexdigest()[:16]
    return src, i18n, files, current_version(src)


def is_locked_key(k):
    if LOCK_ALL_KEYS:
        return True
    return any(k.startswith(p) for p in LOCKED_PREFIXES)


def main():
    approve = '--approve' in sys.argv
    note = ''
    if approve:
        i = sys.argv.index('--approve')
        note = ' '.join(sys.argv[i + 1:]).strip()
        if not note:
            print('[错误] --approve 必须写明原因，例如：--approve "新增导出字段"')
            return 1

    if not os.path.exists(INDEX):
        print('[错误] 找不到 index.html')
        return 1

    src, i18n, files, ver = snapshot()

    hard, drift = [], []

    # ──【硬性 1】三语 key 必须一一对应 ─────────────────────────────
    total_keys = 0
    for name, langs in i18n.items():
        sets = {k: set(v.keys()) for k, v in langs.items()}
        if 'zh' not in sets:
            hard.append('%s：缺少中文 zh 字典' % name)
            continue
        total_keys += len(sets['zh'])
        for lang in ('en', 'vi'):
            if lang not in sets:
                hard.append('%s：缺少 %s 字典' % (name, lang))
                continue
            miss = sorted(sets['zh'] - sets[lang])
            for k in miss[:5]:
                hard.append('%s：%s 缺少词条 "%s"' % (name, lang, k))
            if len(miss) > 5:
                hard.append('%s：%s 另缺 %d 条' % (name, lang, len(miss) - 5))

    # ──【硬性 2】语言跟随机制不变量 ───────────────────────────────
    for label, marker in INVARIANTS:
        if marker not in src:
            hard.append('机制被破坏：%s（找不到 %s）' % (label, marker))
    for label, marker in FORBIDDEN:
        if marker in src:
            hard.append('回归写法重现：%s（不允许出现 %s）' % (label, marker))
    for fn in LOCKED_FILES:
        p = os.path.join(ROOT, fn)
        if not os.path.exists(p):
            hard.append('CRM 脚本丢失：%s' % fn)
            continue
        body = read(p)
        for label, marker in CRM_JS_INVARIANTS.get(fn, []):
            if marker not in body:
                hard.append('%s：%s' % (fn, label))

    # ──【漂移】与基线比对 ────────────────────────────────────────
    locked_count = 0
    if not os.path.exists(BASELINE):
        drift.append('(尚无基线，本次将创建)')
    else:
        try:
            with open(BASELINE, encoding='utf-8') as f:
                base = json.load(f)
        except Exception as e:
            hard.append('基线文件损坏：%s' % e)
            base = None
        if base:
            bi18n = base.get('i18n', {})
            for name, langs in i18n.items():
                bl = bi18n.get(name)
                if not bl:
                    drift.append('新增字典块 %s' % name)
                    continue
                for lang, kvs in langs.items():
                    bkvs = bl.get(lang, {})
                    for k, v in kvs.items():
                        if not is_locked_key(k):
                            continue
                        locked_count += 1
                        if k not in bkvs:
                            drift.append('新增词条 %s.%s = "%s"' % (lang, k, v))
                        elif bkvs[k] != v:
                            drift.append('改动词条 %s.%s：\n       旧: %s\n       新: %s'
                                         % (lang, k, bkvs[k], v))
                    for k in bkvs:
                        if is_locked_key(k) and k not in kvs:
                            drift.append('删除词条 %s.%s（旧值 "%s"）' % (lang, k, bkvs[k]))
            bfiles = base.get('files', {})
            for fn, h in files.items():
                if fn not in bfiles:
                    drift.append('新增受锁文件 %s' % fn)
                elif bfiles[fn] != h:
                    drift.append('CRM 脚本内容已变：%s' % fn)

    # ── 输出 ────────────────────────────────────────────────────
    print('=' * 62)
    print('CRM 逻辑锁  版本 %s  字典 %d 组 / 词条 %d 条' % (ver, len(i18n), total_keys))
    print('=' * 62)

    if hard:
        print('\n[硬性错误] %d 项 —— 必须修复：' % len(hard))
        for h in hard:
            print('  x ' + h)

    if drift and not (len(drift) == 1 and '尚无基线' in drift[0]):
        print('\n[漂移] %d 项 —— CRM 相关文案/脚本被改动，需确认后批准：' % len(drift))
        for d in drift[:30]:
            print('  ! ' + d)
        if len(drift) > 30:
            print('  ... 另 %d 项' % (len(drift) - 30))

    if approve:
        if hard:
            print('\n[拒绝] 存在硬性错误，不能作为基线。')
            return 1
        data = {
            'generated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'version': ver,
            'note': note,
            'i18n': i18n,
            'files': files,
        }
        with open(BASELINE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        print('\n[已批准] 新基线已写入 crm_lock_baseline.json')
        print('         版本 %s  原因：%s' % (ver, note))
        print('         受锁词条 %d 条，受锁脚本 %d 个' % (locked_count, len(files)))
        return 0

    if hard:
        print('\n结果：✗ 锁定失败（硬性错误）')
        return 1
    if drift and not (len(drift) == 1 and '尚无基线' in drift[0]):
        print('\n结果：⚠ 有漂移。确认无误后用 python crm_lock.py --approve "原因" 批准，')
        print('      若属误改，请先还原再检查。')
        return 2
    if not os.path.exists(BASELINE):
        print('\n结果：尚未建立基线，请执行：')
        print('      python crm_lock.py --approve "首次基线：CRM 三语与弹窗修复完成"')
        return 2

    print('\n结果：✓ CRM 逻辑完好，未发现任何改动')
    print('      受锁词条 %d 条  |  受锁脚本：%s' % (locked_count, '、'.join(LOCKED_FILES)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
