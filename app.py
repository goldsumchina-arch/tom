# ⛔ FROZEN (2026-09-06) V2026.09.06.20：本文件逻辑已锁定，未经用户明确同意禁止修改。本地后端逻辑均正确，仅 CRM/LOST/WON/个人佣金 数据可为演示数据。
# -*- coding: utf-8 -*-
"""
AGI-CRM · Won（签约项目）后端
- 仅保留与 index.html（签约项目页）相关的 won_projects 一张表
- 无认证、无用户体系、无 CRM/Lost/报价单/审批/汇率历史/省份等无关内容
- 提供 4 个纯数据 API：GET/POST/PUT/DELETE /api/won-projects
- 附件上传/删除、补充协议摘要保存
- 静态托管 index.html（端口 5050，与前端 fetch 地址一致）
"""

import os
import io
import sys
import json
import hashlib
import sqlite3
import time
import shutil
from datetime import datetime, timedelta
import re
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# Windows 控制台默认 cp1252 无法打印中文，统一改用 UTF-8，避免中文 print 崩溃
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ===================== 配置 =====================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = BASE_DIR
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
VAULT_DIR = os.path.join(UPLOAD_DIR, "vault")  # 私密空间（tom 专属）独立子目录
DB_PATH = os.path.join(DATA_DIR, "agi_pm.db")

# ⛔ 锁死注释之外：桌面版（PyInstaller 打包）专用分支，仅 sys.frozen 时生效，
# 不影响 `python app.py` 本地开发模式。数据落到用户可写目录，前端从解包目录读取。
if getattr(sys, "frozen", False):
    _appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
    _data = os.path.join(_appdata, "AGI-PM")
    os.makedirs(_data, exist_ok=True)
    BASE_DIR = sys._MEIPASS
    DATA_DIR = _data
    UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
    VAULT_DIR = os.path.join(UPLOAD_DIR, "vault")
    DB_PATH = os.path.join(DATA_DIR, "agi_pm.db")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(VAULT_DIR, exist_ok=True)

# ===================== 私密空间（Vault）配置 =====================
# 仅 tom 一人可使用；PIN 为 4 位密码，输对后服务端签发有时效的 token。
VAULT_OWNER = "tom"
VAULT_PIN = "1116"
VAULT_TOKEN_TTL = 30 * 60  # token 有效期（秒）：30 分钟
VAULT_TOKEN_BYTES = 24
# 防爆破：同一窗口连续错误次数限制（错误 5 次锁 60 秒）
VAULT_MAX_FAIL = 5
VAULT_LOCK_SECONDS = 60
# 私密空间：仅拦截真正危险的可执行文件，其余任意类型均可上传
VAULT_BLOCKED_EXT = {".exe", ".bat", ".cmd", ".com", ".scr", ".msi", ".sh", ".js", ".vbs", ".ps1", ".jar", ".dll"}
_vault_fail = {"count": 0, "lock_until": 0.0}
_vault_tokens = {}  # {token: expiry_ts}
# 私密空间上传容量：刻意不做任何限制（不设 MAX_CONTENT_LENGTH），任意大小文件均可上传。
# 如需限制请显式设置 app.config['MAX_CONTENT_LENGTH']，默认保持无限制。

# ============================================================================
# 演示模式开关（★ 培训结束后上线前必须改为 False ★）
# ----------------------------------------------------------------------------
# True  = 开发/培训/演示模式：三张业务表（crm_projects / won_projects /
#         approval_requests）为空时，自动注入示例数据，方便演示与教学。
# False = 生产模式：表为空时不注入任何示例数据。
#
# 【为什么要这个开关】
# init_db() 在表为空时会自动播种，如果不关掉，清空测试记录后只要重启服务，
# 示例数据就会"复活"（CRM 30 条 + 签约项目 + 审批 6 条），导致永远清不干净。
#
# 【当前状态】
#   默认 False：系统启动后 CRM/LOST/WON/审批 均为空，只保留真实用户。
#   需要演示时，在「用户与授权」页点黑色【DEMO】按钮即可一键还原全部示例数据。
#   （DEMO 按钮走 /api/demo/load，不依赖本开关）
#
# 【培训结束上线步骤】
#   1. 备份数据库：copy agi_pm.db agi_pm_backup_日期.db
#   2. 运行清理脚本：python reset_demo_data.py   （清空示例数据 + 移除 DEMO 按钮）
#   3. 重启服务：python app.py
# 详见 reset_demo_data.py 顶部说明。
# ============================================================================
DEMO_SEED = False

# ============================================================================
# 真实用户 vs 示例用户（DEMO 按钮机制的基础）
# ----------------------------------------------------------------------------
# 【需求背景】
#  系统需要两套状态：
#    · 日常/生产态 —— 只有真实用户 + 真实业务数据（学员录入的），示例数据全无
#    · 演示/培训态 —— 一键还原完整的示例数据（含示例用户、示例项目、示例审批）
#  培训结束后，再一键清空所有示例数据，正式投入使用。
#
# 【定义】
#  REAL_USERS      ：团队真实账号。永远保留，DEMO 不影响他们，
#                    清理脚本也绝不删除。
#  DEMO_USERNAMES  ：演示用假账号。由 DEMO 按钮从 demo_snapshot.json 还原，
#                    由「重置/清理」按名单精确删除。
# ============================================================================
REAL_USERS = ["tom", "alice", "admin", "cuong", "james", "travis", "ali", "linh", "khoa"]
DEMO_USERNAMES = [
    "minh", "salesdir1", "salesdir2", "gm1", "gm2", "dgm1", "dgm2",
    "obs1", "obs2", "fin1", "fin2", "asst1", "hr1",
]
# 业务表：DEMO 清空/还原的范围
DEMO_TABLES = ["crm_projects", "lost_projects", "won_projects", "approval_requests"]
# 快照文件：由 export_demo_snapshot.py 生成（对当前演示状态拍照）
DEMO_SNAPSHOT = os.path.join(DATA_DIR, "demo_snapshot.json")

app = Flask(__name__)
CORS(app)

# ===================== 权限变更实时推送（轻量级版本号机制）=====================
# 每个用户的权限/角色/状态发生变更时，bump 其版本号。
# 前端轮询 /api/perm-version?username= 检测版本变化，变化时立即刷新本地会话缓存，
# 实现「审批通过立即回写前端缓存（无需重新登录）」与「被改权限用户页面实时更新」。
PERM_VERSION = {}   # {username: int}
_PERM_VERSION_LOCK = None

def bump_perm_version(username):
    """刷新某用户的权限版本号（线程安全）。"""
    if not username:
        return
    import threading
    global _PERM_VERSION_LOCK
    if _PERM_VERSION_LOCK is None:
        _PERM_VERSION_LOCK = threading.Lock()
    with _PERM_VERSION_LOCK:
        PERM_VERSION[username] = PERM_VERSION.get(username, 0) + 1

def get_perm_version(username):
    return PERM_VERSION.get(username, 0)

def _norm_approver_list(approvers, conn):
    """把审批人列表统一规范为用户名。兼容前端旧 bug 中存的数字 ID。
    返回：去重后的用户名列表（只保留能解析到有效用户的）。"""
    if not isinstance(approvers, list):
        return []
    by_id = {}
    by_name_lower = {}
    for r in conn.execute("SELECT id, username, status FROM users").fetchall():
        by_id[r["id"]] = r["username"]
        by_name_lower[r["username"].lower()] = r["username"]
    seen = set()
    out = []
    for v in approvers:
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        # 纯数字 -> 按 id 解析
        if s.isdigit():
            uname = by_id.get(int(s))
        else:
            uname = by_name_lower.get(s.lower())
        if not uname:
            continue
        if uname not in seen:
            seen.add(uname)
            out.append(uname)
    return out

def _norm_user_perms(perms, conn):
    """规范化 users.perms JSON 中所有区块的 approvers（数字 ID -> 用户名）。"""
    if not isinstance(perms, dict):
        return perms
    for bid, p in list(perms.items()):
        if not isinstance(p, dict):
            continue
        arr = p.get("approvers")
        if isinstance(arr, list):
            p["approvers"] = _norm_approver_list(arr, conn)
    return perms

def _migrate_approver_ids_to_usernames(c):
    """一次性迁移：users.perms 与 approval_requests.approvers 中的数字 ID -> 用户名。"""
    import json as _json
    by_id = {r["id"]: r["username"] for r in c.execute("SELECT id, username FROM users").fetchall()}
    # 修复 users.perms
    for row in c.execute("SELECT id, perms FROM users WHERE perms IS NOT NULL AND perms <> ''").fetchall():
        try:
            perms = _json.loads(row["perms"])
        except Exception:
            continue
        if not isinstance(perms, dict):
            continue
        changed = False
        for bid, p in list(perms.items()):
            if not isinstance(p, dict):
                continue
            arr = p.get("approvers")
            if isinstance(arr, list):
                new_arr = []
                seen = set()
                for v in arr:
                    s = str(v).strip()
                    if s.isdigit():
                        uname = by_id.get(int(s))
                        if uname and uname not in seen:
                            new_arr.append(uname); seen.add(uname)
                    elif s and s not in seen:
                        new_arr.append(s); seen.add(s)
                if new_arr != arr:
                    p["approvers"] = new_arr
                    changed = True
        if changed:
            c.execute("UPDATE users SET perms=? WHERE id=?", (_json.dumps(perms, ensure_ascii=False), row["id"]))
            print(f"[migrate] users.id={row['id']} perms 审批人已规范化为用户名")
    # 修复 approval_requests.approvers
    for row in c.execute("SELECT id, approvers FROM approval_requests WHERE approvers IS NOT NULL AND approvers <> ''").fetchall():
        try:
            arr = _json.loads(row["approvers"])
        except Exception:
            continue
        if not isinstance(arr, list):
            continue
        new_arr = []
        seen = set()
        for v in arr:
            s = str(v).strip()
            if s.isdigit():
                uname = by_id.get(int(s))
                if uname and uname not in seen:
                    new_arr.append(uname); seen.add(uname)
            elif s and s not in seen:
                new_arr.append(s); seen.add(s)
        if new_arr != arr:
            c.execute("UPDATE approval_requests SET approvers=? WHERE id=?", (_json.dumps(new_arr, ensure_ascii=False), row["id"]))
            print(f"[migrate] approval_requests.id={row['id']} 审批人已规范化为用户名")

# ===================== 数据库 =====================
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def row_to_dict(row):
    d = dict(row)
    for k, v in list(d.items()):
        if isinstance(v, str):
            # JSON 字段尝试解析
            if k in ("attachments", "supp_summary", "cust_view_detail", "gs_view_detail"):
                try:
                    d[k] = json.loads(v) if v else []
                except:
                    # 解析失败时回退为空数组，避免把损坏的字符串（如 "[object Object]"）暴露给前端
                    d[k] = []
    return d

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS won_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        contract_no TEXT DEFAULT '',
        customer TEXT DEFAULT '',
        province TEXT DEFAULT '',
        contract_date TEXT DEFAULT '',
        signing_parties TEXT DEFAULT '',
        contract_currency TEXT DEFAULT '',
        rate_rmb_vnd TEXT DEFAULT '',
        rate_usd_vnd TEXT DEFAULT '',
        incoterm TEXT DEFAULT '',
        include_install TEXT DEFAULT '',
        payment_terms TEXT DEFAULT '',
        payment_terms_zh TEXT DEFAULT '',
        payment_terms_en TEXT DEFAULT '',
        payment_terms_vi TEXT DEFAULT '',
        salesperson TEXT DEFAULT '',

        equip_rmb INTEGER DEFAULT 0,
        equip_usd INTEGER DEFAULT 0,
        equip_vnd INTEGER DEFAULT 0,
        superv_rmb INTEGER DEFAULT 0,
        superv_usd INTEGER DEFAULT 0,
        superv_vnd INTEGER DEFAULT 0,
        fb_budget_rmb INTEGER DEFAULT 0,
        fb_budget_usd INTEGER DEFAULT 0,
        fb_budget_vnd INTEGER DEFAULT 0,
        fb_actual_rmb INTEGER DEFAULT 0,
        fb_actual_usd INTEGER DEFAULT 0,
        fb_actual_vnd INTEGER DEFAULT 0,
        cc_budget_rmb INTEGER DEFAULT 0,
        cc_budget_usd INTEGER DEFAULT 0,
        cc_budget_vnd INTEGER DEFAULT 0,
        cc_actual_rmb INTEGER DEFAULT 0,
        cc_actual_usd INTEGER DEFAULT 0,
        cc_actual_vnd INTEGER DEFAULT 0,
        total_equip_rmb INTEGER DEFAULT 0,
        total_equip_usd INTEGER DEFAULT 0,
        total_equip_vnd INTEGER DEFAULT 0,
        inst_budget_rmb INTEGER DEFAULT 0,
        inst_budget_usd INTEGER DEFAULT 0,
        inst_budget_vnd INTEGER DEFAULT 0,
        inst_actual_rmb INTEGER DEFAULT 0,
        inst_actual_usd INTEGER DEFAULT 0,
        inst_actual_vnd INTEGER DEFAULT 0,
        total_ei_rmb INTEGER DEFAULT 0,
        total_ei_usd INTEGER DEFAULT 0,
        total_ei_vnd INTEGER DEFAULT 0,

        -- ★ 新增：增值税&关税&其他费用调节平衡输入
        vat_rmb INTEGER DEFAULT 0,
        vat_usd INTEGER DEFAULT 0,
        vat_vnd INTEGER DEFAULT 0,

        -- ★ 新增：质保金信息
        warranty_rmb INTEGER DEFAULT 0,
        warranty_usd INTEGER DEFAULT 0,
        warranty_vnd INTEGER DEFAULT 0,
        warranty_start TEXT DEFAULT '',
        warranty_end TEXT DEFAULT '',

        cust_pay_count INTEGER DEFAULT 0,
        cust_paid_rmb INTEGER DEFAULT 0,
        cust_paid_usd INTEGER DEFAULT 0,
        cust_paid_vnd INTEGER DEFAULT 0,
        cust_unpaid_rmb INTEGER DEFAULT 0,
        cust_unpaid_usd INTEGER DEFAULT 0,
        cust_unpaid_vnd INTEGER DEFAULT 0,
        cust_view_detail TEXT DEFAULT '[]',
        cust_remark TEXT DEFAULT '',

        gs_comm_pct TEXT DEFAULT '',
        gs_comm_rmb INTEGER DEFAULT 0,
        gs_comm_usd INTEGER DEFAULT 0,
        gs_comm_vnd INTEGER DEFAULT 0,
        gs_pay_count INTEGER DEFAULT 0,
        gs_paid_rmb INTEGER DEFAULT 0,
        gs_paid_usd INTEGER DEFAULT 0,
        gs_paid_vnd INTEGER DEFAULT 0,
        gs_unpaid_rmb INTEGER DEFAULT 0,
        gs_unpaid_usd INTEGER DEFAULT 0,
        gs_unpaid_vnd INTEGER DEFAULT 0,
        gs_view_detail TEXT DEFAULT '[]',
        gs_remark TEXT DEFAULT '',

        agi_payable_rmb INTEGER DEFAULT 0,
        agi_payable_usd INTEGER DEFAULT 0,
        agi_payable_vnd INTEGER DEFAULT 0,

        agi_remark TEXT DEFAULT '',

        doc_equip TEXT DEFAULT '',
        doc_install TEXT DEFAULT '',
        doc_both TEXT DEFAULT '',
        doc_addendum_cnt INTEGER DEFAULT 0,
        doc_view_addendum TEXT DEFAULT '',
        doc_remark TEXT DEFAULT '',

        attachments TEXT DEFAULT '[]',
        supp_summary TEXT DEFAULT '[]'
    );
    """)

    # ★ 迁移：为已有数据库添加新列（如果不存在）
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN agi_remark TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN doc_equip TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN doc_install TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN doc_both TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN doc_addendum_cnt INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN doc_view_addendum TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN doc_remark TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # ★ 三语付款方式列
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN payment_terms_zh TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN payment_terms_en TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN payment_terms_vi TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # ★ 历史数据迁移：旧单语 payment_terms → 默认视为当前语言，回填三列（幂等）
    c.execute(
        "UPDATE won_projects SET payment_terms_zh = payment_terms, payment_terms_en = payment_terms, payment_terms_vi = payment_terms "
        "WHERE (payment_terms_zh IS NULL OR payment_terms_zh = '') AND (payment_terms_en IS NULL OR payment_terms_en = '') AND (payment_terms_vi IS NULL OR payment_terms_vi = '') "
        "AND payment_terms IS NOT NULL AND payment_terms != ''"
    )
    # ★ 三语备注列：cust/gs/agi remark 各拆 zh/en/vi 三列（方案A）
    for _base in ("cust_remark", "gs_remark", "agi_remark"):
        for _suf in ("zh", "en", "vi"):
            try:
                c.execute(f"ALTER TABLE won_projects ADD COLUMN {_base}_{_suf} TEXT DEFAULT ''")
            except sqlite3.OperationalError:
                pass
    try:
        c.execute("ALTER TABLE crm_projects ADD COLUMN remark_zh TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE crm_projects ADD COLUMN remark_en TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE crm_projects ADD COLUMN remark_vi TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # ★ 历史数据迁移：旧单语备注 → 默认视为中文，回填 _zh（仅当 _zh 为空且原列非空，幂等）
    for _base in ("cust_remark", "gs_remark", "agi_remark"):
        c.execute(
            f"UPDATE won_projects SET {_base}_zh = {_base} "
            f"WHERE ({_base}_zh IS NULL OR {_base}_zh = '') AND {_base} IS NOT NULL AND {_base} != ''"
        )
    # ★ 全新库时 crm_projects 还没创建（CREATE TABLE 在本函数稍后），必须跳过；
    #   否则 init_db 抛 "no such table: crm_projects"，导致全新库永远初始化失败
    #   （旧库已存在该表，回填照常执行，行为不变）。
    if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_projects'").fetchone():
        c.execute(
            "UPDATE crm_projects SET remark_zh = remark "
            "WHERE (remark_zh IS NULL OR remark_zh = '') AND remark IS NOT NULL AND remark != ''"
        )
    conn.commit()
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN vat_rmb INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN vat_usd INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN vat_vnd INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN warranty_rmb INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN warranty_usd INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN warranty_vnd INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN warranty_start TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN warranty_end TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    # ★ 迁移：为历史数据库补上缺失的 attachments / supp_summary / created_at / updated_at 列
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN attachments TEXT DEFAULT '[]'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN supp_summary TEXT DEFAULT '[]'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN created_at TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN updated_at TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # ★ 独立记录：为 won_projects 添加 owner_user_id（记录归属账号）
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN owner_user_id TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # ★ V40：won_projects 省份列（本地 SQLite 无 100 列限制，直接加列；云端走映射表）
    try:
        c.execute("ALTER TABLE won_projects ADD COLUMN province TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # ★ V40：WON 省份自动填充（与云端 wonlost.js 的 WON_PROV_FILL 列表一致）：
    #   空省份行按列表循环分配，让案例数据有合理分布
    _won_prov_fill = [
        "Đồng Nai", "Tây Ninh", "Bắc Ninh", "Vĩnh Long", "Thái Nguyên",
        "An Giang", "Cần Thơ", "Quảng Ninh", "Đắk Lắk", "Thanh Hóa",
        "Khánh Hòa", "Gia Lai", "Lâm Đồng", "TP. Hồ Chí Minh", "Hà Nội",
        "Hải Phòng", "Đà Nẵng", "Nghệ An", "Hưng Yên", "Lạng Sơn",
    ]
    _won_rows_no_prov = c.execute(
        "SELECT id FROM won_projects WHERE province IS NULL OR province='' ORDER BY id"
    ).fetchall()
    for _i, _r in enumerate(_won_rows_no_prov):
        c.execute(
            "UPDATE won_projects SET province=? WHERE id=?",
            (_won_prov_fill[_i % len(_won_prov_fill)], _r[0]),
        )

    # ★ CRM（报价/跟进）表 —— 与 Won 同机制，三语支持
    c.executescript("""
    CREATE TABLE IF NOT EXISTS crm_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),

        quote_no TEXT DEFAULT '',
        project_name TEXT DEFAULT '',
        province TEXT DEFAULT '',
        customer TEXT DEFAULT '',
        bu TEXT DEFAULT '',
        construction TEXT DEFAULT '',
        startup_pct TEXT DEFAULT '',
        sign_pct TEXT DEFAULT '',
        manager TEXT DEFAULT '',
        manager_phone TEXT DEFAULT '',
        company_info TEXT DEFAULT '',
        initial_quote_date TEXT DEFAULT '',
        est_purchase_date TEXT DEFAULT '',
        est_ship_date TEXT DEFAULT '',
        quote_version TEXT DEFAULT '',
        last_quote_date TEXT DEFAULT '',
        rate_rmb_vnd TEXT DEFAULT '',
        rate_usd_vnd TEXT DEFAULT '',
        incoterm TEXT DEFAULT '',
        install_quoted TEXT DEFAULT '',
        salesperson TEXT DEFAULT '',
        remark TEXT DEFAULT '',
        pdf_equip TEXT DEFAULT '',
        pdf_install TEXT DEFAULT '',
        pdf_both TEXT DEFAULT '',

        q1_rmb INTEGER DEFAULT 0, q1_usd INTEGER DEFAULT 0, q1_vnd INTEGER DEFAULT 0,
        q2_rmb INTEGER DEFAULT 0, q2_usd INTEGER DEFAULT 0, q2_vnd INTEGER DEFAULT 0,
        q3_rmb INTEGER DEFAULT 0, q3_usd INTEGER DEFAULT 0, q3_vnd INTEGER DEFAULT 0,
        q4_rmb INTEGER DEFAULT 0, q4_usd INTEGER DEFAULT 0, q4_vnd INTEGER DEFAULT 0,
        q5_rmb INTEGER DEFAULT 0, q5_usd INTEGER DEFAULT 0, q5_vnd INTEGER DEFAULT 0,
        q6_rmb INTEGER DEFAULT 0, q6_usd INTEGER DEFAULT 0, q6_vnd INTEGER DEFAULT 0,
        q7_rmb INTEGER DEFAULT 0, q7_usd INTEGER DEFAULT 0, q7_vnd INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active'
    );
    """)
    # 兼容已存在的库：补充 status 列
    try:
        c.execute("ALTER TABLE crm_projects ADD COLUMN status TEXT DEFAULT 'active'")
    except sqlite3.OperationalError:
        pass
    # ★ 独立记录：为 crm_projects 添加 owner_user_id（记录归属账号）
    try:
        c.execute("ALTER TABLE crm_projects ADD COLUMN owner_user_id TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    # ★ 失败项目表（lost_projects）—— 与 CRM 同机制、三语支持，完全独立存储
    c.executescript("""
    CREATE TABLE IF NOT EXISTS lost_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),

        quote_no TEXT DEFAULT '',
        project_name TEXT DEFAULT '',
        province TEXT DEFAULT '',
        customer TEXT DEFAULT '',
        bu TEXT DEFAULT '',
        construction TEXT DEFAULT '',
        startup_pct TEXT DEFAULT '',
        sign_pct TEXT DEFAULT '',
        manager TEXT DEFAULT '',
        manager_phone TEXT DEFAULT '',
        company_info TEXT DEFAULT '',
        initial_quote_date TEXT DEFAULT '',
        est_purchase_date TEXT DEFAULT '',
        est_ship_date TEXT DEFAULT '',
        quote_version TEXT DEFAULT '',
        last_quote_date TEXT DEFAULT '',
        rate_rmb_vnd TEXT DEFAULT '',
        rate_usd_vnd TEXT DEFAULT '',
        incoterm TEXT DEFAULT '',
        install_quoted TEXT DEFAULT '',
        salesperson TEXT DEFAULT '',
        remark TEXT DEFAULT '',
        pdf_equip TEXT DEFAULT '',
        pdf_install TEXT DEFAULT '',
        pdf_both TEXT DEFAULT '',
        fail_reason TEXT DEFAULT '',
        fail_date TEXT DEFAULT '',

        q1_rmb INTEGER DEFAULT 0, q1_usd INTEGER DEFAULT 0, q1_vnd INTEGER DEFAULT 0,
        q2_rmb INTEGER DEFAULT 0, q2_usd INTEGER DEFAULT 0, q2_vnd INTEGER DEFAULT 0,
        q3_rmb INTEGER DEFAULT 0, q3_usd INTEGER DEFAULT 0, q3_vnd INTEGER DEFAULT 0,
        q4_rmb INTEGER DEFAULT 0, q4_usd INTEGER DEFAULT 0, q4_vnd INTEGER DEFAULT 0,
        q5_rmb INTEGER DEFAULT 0, q5_usd INTEGER DEFAULT 0, q5_vnd INTEGER DEFAULT 0,
        q6_rmb INTEGER DEFAULT 0, q6_usd INTEGER DEFAULT 0, q6_vnd INTEGER DEFAULT 0,
        q7_rmb INTEGER DEFAULT 0, q7_usd INTEGER DEFAULT 0, q7_vnd INTEGER DEFAULT 0
    );
    """)
    # ★ 独立记录：为 lost_projects 添加 owner_user_id（记录归属账号，从 crm 转失败时自动继承）
    try:
        c.execute("ALTER TABLE lost_projects ADD COLUMN owner_user_id TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    # ===================== 用户表（登录 / 权限） =====================
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            real_name TEXT DEFAULT '',
            role TEXT DEFAULT 'user',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT ''
        )
    """)
    # ===== 审批请求表（权限“发起审批”类型的真实拦截存储） =====
    c.executescript("""
    CREATE TABLE IF NOT EXISTS approval_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester TEXT NOT NULL,
        requester_name TEXT DEFAULT '',
        block_id TEXT NOT NULL,
        block_name TEXT DEFAULT '',
        action_name TEXT DEFAULT '',
        approvers TEXT DEFAULT '[]',
        status TEXT DEFAULT 'pending',      -- pending / approved / rejected
        created_at TEXT DEFAULT '',
        resolved_at TEXT DEFAULT '',
        resolver TEXT DEFAULT '',
        resolver_name TEXT DEFAULT ''
    );
    """)
    # 审批模块扩展字段：标题 / 审批内容说明 / 审批结果意见
    for col in ["title", "content", "result_note"]:
        try:
            c.execute(f"ALTER TABLE approval_requests ADD COLUMN {col} TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass

    # 单次生效审批字段：persist='single-use' 不写入用户权限，仅单次放行；target_id 区分同一区块不同操作对象
    for col, ddl in [("persist", "TEXT DEFAULT 'persistent'"), ("target_id", "TEXT DEFAULT ''")]:
        try:
            c.execute(f"ALTER TABLE approval_requests ADD COLUMN {col} {ddl}")
        except sqlite3.OperationalError:
            pass
    # 已消耗标记：服务端权限闸门放行单次审批时置 1，防止同一审批被重复用于多次操作
    try:
        c.execute("ALTER TABLE approval_requests ADD COLUMN consumed INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    # 用户与权限管理审批：payload 暂存（USR-D1 权限变更 / USR-D2 新增用户 / USR-D3 删除用户），
    # 审批通过后由服务端按 payload 执行（新增账号通过前不入 users 表=不可登录、不出现在用户列表）
    try:
        c.execute("ALTER TABLE approval_requests ADD COLUMN payload TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    # 种子审批数据：便于测试“审批”模块（生产模式下跳过，避免清空后复活）
    if DEMO_SEED:
        seed_approval_requests(c)
    try:
        c.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'")
    except sqlite3.OperationalError:
        pass
    # 离职代理：离职用户的业务数据/待办自动并给代理人（存被代理人的 username）
    try:
        c.execute("ALTER TABLE users ADD COLUMN delegate_to TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # DEMO 标记（仅信息用途）：1=演示账号、0=真实账号。供 reset_demo_data.py
    # 清理脚本按标记删演示账号。★ DEMO 按钮（load/clear）已与用户表彻底解耦，
    # 不会读写此标记，也不会增删任何用户。
    _is_demo_added = False
    try:
        c.execute("ALTER TABLE users ADD COLUMN is_demo INTEGER DEFAULT 0")
        _is_demo_added = True
    except sqlite3.OperationalError:
        pass
    if _is_demo_added:
        # 仅在首次加列时做一次存量标注：演示账号标 1，真实账号标 0。
        # 之后 is_demo 完全由数据流维护（DEMO 还原=1、正常建号=0），
        # 不在每次启动时重标 —— 否则用户用演示名建的真实号会在重启后被误标。
        try:
            for _u in DEMO_USERNAMES:
                c.execute("UPDATE users SET is_demo=1 WHERE lower(username)=lower(?)", (_u,))
            for _u in REAL_USERS:
                c.execute("UPDATE users SET is_demo=0 WHERE lower(username)=lower(?)", (_u,))
        except Exception:
            pass

    # ★ 业务表 DEMO 标记（is_demo）：1=演示数据、0=真实数据。
    #   用于「清空 DEMO」时精确删除（DELETE WHERE is_demo=1），绝不误删真实录入的数据。
    #   每次还原/加载 DEMO 时由 load_demo_data 打 1；学员在演示期间录入的真实业务数据保持 0。
    #   注：DEMO 按钮（load/clear）仍与 users 表彻底解耦，这里只标记业务数据行。
    for _bt in DEMO_TABLES:
        try:
            c.execute("ALTER TABLE %s ADD COLUMN is_demo INTEGER DEFAULT 0" % _bt)
        except sqlite3.OperationalError:
            pass

    # 个人佣金 · 佣金记录主表（案例数据打 is_demo=1，便于最后一条命令精确清除，不误伤真实数据）
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS commission_records (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              contract TEXT NOT NULL,
              parties TEXT DEFAULT '',
              group_name TEXT DEFAULT '',
              sign_date TEXT DEFAULT '',
              deposit_date TEXT DEFAULT '',
              currency TEXT DEFAULT '',
              equip_rmb TEXT DEFAULT '',
              equip_usd TEXT DEFAULT '',
              equip_vnd TEXT DEFAULT '',
              rate_rmb TEXT DEFAULT '',
              rate_usd TEXT DEFAULT '',
              remark TEXT DEFAULT '',
              is_demo INTEGER DEFAULT 0,
              created_at TEXT DEFAULT (datetime('now','localtime')),
              updated_at TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_rec_contract ON commission_records(contract)")
    except Exception:
        pass
    # 个人佣金 · 受益人表（payments 为 JSON 字符串，存 1~N 期支付明细）
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS commission_beneficiaries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              record_id INTEGER NOT NULL,
              ben_index INTEGER DEFAULT 0,
              name TEXT DEFAULT '',
              currency TEXT DEFAULT '',
              total_rmb TEXT DEFAULT '',
              total_usd TEXT DEFAULT '',
              total_vnd TEXT DEFAULT '',
              sign_date TEXT DEFAULT '',
              deposit_date TEXT DEFAULT '',
              paid_rmb TEXT DEFAULT '',
              paid_usd TEXT DEFAULT '',
              paid_vnd TEXT DEFAULT '',
              pay_count INTEGER DEFAULT 0,
              unpaid_rmb TEXT DEFAULT '',
              unpaid_usd TEXT DEFAULT '',
              unpaid_vnd TEXT DEFAULT '',
              pay_nature TEXT DEFAULT '',
              note TEXT DEFAULT '',
              payments TEXT DEFAULT '[]',
              updated_at TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_comm_ben_rec ON commission_beneficiaries(record_id)")
    except Exception:
        pass
    # 个人佣金 · 修改金额审批表（后门三人组 tom/cuong/travis 专用）
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS comm_amt_requests (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              req_key TEXT NOT NULL,
              contract_no TEXT DEFAULT '',
              beneficiary TEXT DEFAULT '',
              pay_no TEXT DEFAULT '',
              currency TEXT DEFAULT '',
              old_amount TEXT DEFAULT '',
              new_amount TEXT DEFAULT '',
              reason TEXT DEFAULT '',
              requester TEXT NOT NULL,
              approver1 TEXT NOT NULL,
              approver2 TEXT NOT NULL,
              dec1 TEXT DEFAULT '',
              dec2 TEXT DEFAULT '',
              status TEXT DEFAULT 'pending',
              created_at TEXT,
              resolved_at TEXT
            )
        """)
    except Exception:
        pass
    # 权限相关字段
    for col, ddl in [
        ("position", "TEXT DEFAULT ''"),
        ("vis_can_see_me", "TEXT DEFAULT '[]'"),   # 可看该用户数据的人 id 列表（反向授权）
        ("vis_he_can_see", "TEXT DEFAULT '[]'"),   # 该用户可看的人 id 列表（正向授权）
        ("perms", "TEXT DEFAULT '{}'"),            # 区块权限决策 {bid: {decision, approvers}}
        ("forgot_approvers", "TEXT DEFAULT '[]'"), # 忘记密码审批人（tom 默认，可追加；通过后密码重置为初始密码）
        ("sort_order", "INTEGER DEFAULT 0"),       # 用户列表排序权重（越小越靠前）
    ]:
        try:
            c.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
        except sqlite3.OperationalError:
            pass

    # 登录记录表
    c.execute("""
        CREATE TABLE IF NOT EXISTS login_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            login_time TEXT DEFAULT (datetime('now','localtime')),
            ip_address TEXT DEFAULT '',
            user_agent TEXT DEFAULT ''
        )
    """)

    # 自由任命管理人员表：与职位解耦，单独维护 2-4 名管理员
    c.execute("""
        CREATE TABLE IF NOT EXISTS managers (
            username TEXT PRIMARY KEY NOT NULL,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # 忘记密码申请表
    c.execute("""
        CREATE TABLE IF NOT EXISTS password_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            requested_at TEXT DEFAULT '',
            processed_at TEXT DEFAULT '',
            note TEXT DEFAULT ''
        )
    """)
    seed = c.execute("SELECT COUNT(*) FROM users WHERE username='tom'").fetchone()[0]
    if seed == 0:
        c.execute("INSERT INTO users (username, password, real_name, role, status, created_at) VALUES (?,?,?,?,?,?)",
                  ("tom", "66668888", "Tom", "admin", "active", time.strftime("%Y-%m-%d %H:%M:%S")))
        print("[init_db] 已创建种子用户 tom / 66668888")

    # 确保 tom 始终在管理员名单中
    c.execute("INSERT OR IGNORE INTO managers (username) VALUES (?)", ("tom",))
    # 迁移旧逻辑中的 gm1/gm2（若存在）到管理员表，保证平滑过渡
    for old_mgr in ("gm1", "gm2"):
        exists = c.execute("SELECT 1 FROM users WHERE username=?", (old_mgr,)).fetchone()
        if exists:
            c.execute("INSERT OR IGNORE INTO managers (username) VALUES (?)", (old_mgr,))

    # ★ 种子数据：CRM（潜在项目）没有有效数据时自动注入 30 组示例数据
    # 若存在空占位行（quote_no 为空），先清理，再判断是否为空。
    c.execute("DELETE FROM crm_projects WHERE quote_no IS NULL OR quote_no = ''")
    cnt = c.execute("SELECT COUNT(*) FROM crm_projects").fetchone()[0]
    # ★ 种子数据：签约项目（won_projects）没有有效数据时自动注入示例数据
    # 如果表为空或没有 AGI-Customer/GS-Customer 数据（看板图表需要这些数据），插入种子数据
    won_cnt = c.execute("SELECT COUNT(*) FROM won_projects WHERE customer IS NOT NULL AND customer != ''").fetchone()[0]
    bu_cnt = c.execute("SELECT COUNT(*) FROM won_projects WHERE signing_parties IN ('AGI-Customer', 'GS-Customer')").fetchone()[0]
    if not DEMO_SEED:
        # 生产模式：不注入任何示例数据，表可保持为空
        print("[init_db] 生产模式(DEMO_SEED=False)：跳过示例数据注入")
    elif won_cnt == 0 or bu_cnt == 0:
        seed_won_projects(c)
        if won_cnt == 0:
            print("[init_db] won_projects 无有效数据，已自动注入示例签约项目数据")
        else:
            print("[init_db] won_projects 缺少 AGI-Customer/GS-Customer 数据，已补充示例数据")
    else:
        pass  # 已有数据，不做修改

    if DEMO_SEED and cnt == 0:
        seed_crm_projects(c)
        print("[init_db] crm_projects 无有效数据，已自动注入 30 组示例数据")
    elif not DEMO_SEED:
        pass   # 生产模式：保持为空，不注入
    else:
        # 已存在数据：修正旧版种子数据（省份/BU/建设情况 需与模态框下拉选项值一致；
        # 启动概率/签约概率 不得超过 100%）
        migrate_crm_seed(c)
        # 三币联动/电话/公司信息/概率 多样化修正
        migrate_crm_seed_v2(c)

    # 迁移：把旧权限数据里存的审批人数字 ID 全部转换为用户名
    _migrate_approver_ids_to_usernames(c)

    conn.commit()
    conn.close()


def seed_crm_projects(c):
    """在 crm_projects 为空时注入 30 组示例数据（供测试/演示用）。"""
    # 省份 / BU / 建设情况：取值必须与前端下拉框的 <option value> 完全一致，
    # 否则模态框打开时下拉框无法匹配，会停留在"未选择"并导致必填校验失败。
    provinces = ["Bắc Ninh", "Đà Nẵng", "Hải Phòng", "TP. Hồ Chí Minh", "Hà Nội",
                 "Tây Ninh", "Đồng Nai", "Vĩnh Long", "Quảng Ninh", "Thái Nguyên"]
    bus = ["pig_farm", "broiler_farm", "chicken_egg_farm", "duck_farm",
           "duck_egg_farm", "others"]
    constructions = ["land", "license", "design", "bidding", "supplier_sel",
                     "nearing", "signed_no_deposit", "signed_deposit", "failed", "cancelled"]
    incoterms = ["EXW", "FOB", "CIF", "DDP", "CIP"]
    # 负责人（客户方联系人）：必须是越南人名，不含中文
    managers = [
        "Nguyen Van An", "Tran Thi Binh", "Le Quang Huy", "Pham Minh Duc",
        "Hoang Van Long", "Vu Thi Mai", "Do Cong Thanh", "Bui Tuan Kiet",
        "Ngo Thanh Trung", "Dang Xuan Phuc", "Vo Van Tam", "Ly Thi Hoa",
        "Phan Ngoc Son", "Duong Minh Tri", "Trinh Van Hai", "Nguyen Thi Lan",
        "Huynh Phuoc Thanh", "Thai Van Dung", "Cao Tuan Anh", "Dinh Van Phuoc",
    ]
    # 销售（内部员工）
    sales = ["Tom", "Travis", "Ali", "Cuong", "Khoa", "James"]
    customers = [
        "越南富光电子", "GreenTech Solar", "Long An Steel", "Hai Phong Logistics",
        "河内精密制造", "Dong Nai Auto Parts", "Binh Duong Electric", "Quang Ninh Cement",
        "Thai Nguyen Machinery", "Vinfast Components", "Samsung Display VN", "LG Innotek VN",
    ]
    zones = ["A区", "B区", "二期", "一期", "扩建"]
    rmb_bases = [850000, 920000, 1000000, 760000, 1150000, 680000, 1290000, 540000, 980000,
                 1430000, 610000, 880000, 1220000, 730000, 1350000, 990000, 470000, 1120000,
                 1500000, 1050000]
    # 启动概率 / 签约概率：多样化，避免全部为 100%（签约概率不高于启动概率）
    startup_pcts = [30, 45, 60, 75, 80, 90, 55, 70, 85, 95, 40, 65, 50, 88, 72,
                    35, 58, 68, 92, 48, 62, 38, 82, 52, 78, 42, 96, 25, 64, 74]
    sign_pcts =    [15, 30, 45, 60, 70, 80, 40, 55, 70, 85, 25, 50, 35, 72, 55,
                    20, 42, 52, 80, 32, 46, 22, 68, 36, 60, 28, 85, 15, 50, 62]
    # 负责人电话：越南手机号（10位，以 03/05/07/08/09 开头），多样化
    phone_pref = ["09", "03", "07", "08", "05"]
    # 公司信息：结合客户名 + 越南不同省份/地址，多样化
    addr_cities = ["胡志明市", "河内", "海防", "岘港", "同奈", "北宁", "太原", "广宁", "西宁", "永隆"]
    addr_zone = ["工业园区", "高新技术区", "出口加工区", "经济开发区", "商贸中心"]
    company_extra = ["越南分公司", "驻越办事处", "制造基地", "项目工程部", "区域服务中心"]

    def fdate(month, day):
        return "2026-{:02d}-{:02d}".format(month, max(1, min(28, day)))

    def rmb_to_q(rmb_amount, rate_rmb_vnd, rate_usd_vnd):
        """按项目自身汇率，将 RMB 换算为一致的 USD 与 VND（与模态框 crmQuoteLink 的 RMB 换算一致）。"""
        vnd = round(rmb_amount * rate_rmb_vnd)
        usd = round(vnd / rate_usd_vnd)
        return vnd, usd

    rows = []
    for i in range(30):
        base = rmb_bases[i % len(rmb_bases)]
        q1 = round(base * 0.20); q2 = round(base * 0.15); q3 = round(base * 0.25)
        q4 = round(base * 0.12); q5 = round(base * 0.08); q6 = round(base * 0.10)
        q7 = round(base * 0.10)
        cust = customers[i % len(customers)]
        rate_rmb_vnd = 3000 + i * 11
        rate_usd_vnd = (20 + i % 5) * 1000
        # 三币联动：以 RMB 为基准，按本项目汇率换算 USD / VND
        qa = rmb_to_q(q1, rate_rmb_vnd, rate_usd_vnd)
        qb = rmb_to_q(q2, rate_rmb_vnd, rate_usd_vnd)
        qc = rmb_to_q(q3, rate_rmb_vnd, rate_usd_vnd)
        qd = rmb_to_q(q4, rate_rmb_vnd, rate_usd_vnd)
        qe = rmb_to_q(q5, rate_rmb_vnd, rate_usd_vnd)
        qf = rmb_to_q(q6, rate_rmb_vnd, rate_usd_vnd)
        qg = rmb_to_q(q7, rate_rmb_vnd, rate_usd_vnd)
        phone = phone_pref[i % len(phone_pref)] + "{:08d}".format((i * 137) % 100000000)
        company = "{}·{}·{} · {}".format(cust, addr_cities[i % len(addr_cities)],
                                         addr_zone[i % len(addr_zone)],
                                         company_extra[i % len(company_extra)])
        rows.append((
            "QT-2026-{:03d}".format(i + 1),
            cust + " " + zones[i % len(zones)],
            provinces[i % len(provinces)],
            cust,
            bus[i % len(bus)],
            constructions[i % len(constructions)],
            str(startup_pcts[i % len(startup_pcts)]),
            str(sign_pcts[i % len(sign_pcts)]),
            managers[i % len(managers)],
            phone,
            company,
            fdate(1 + i % 12, 1 + i % 9),
            fdate(1 + (i + 2) % 12, 11 + (i + 3) % 10),
            fdate(1 + (i + 4) % 12, 21 + (i + 5) % 8),
            "V{}".format(1 + i % 3),
            fdate(1 + (i + 1) % 12, 12 + (i + 2) % 10),
            "{}".format(rate_rmb_vnd),
            "{}".format(rate_usd_vnd),
            incoterms[i % len(incoterms)],
            "是" if i % 3 != 2 else "否",
            sales[i % len(sales)],
            ["", "重点跟进", "客户要求年前报价", "已提交技术方案", "等待审批"][i % 5],
            "", "", "",
            q1, qa[1], qa[0],
            q2, qb[1], qb[0],
            q3, qc[1], qc[0],
            q4, qd[1], qd[0],
            q5, qe[1], qe[0],
            q6, qf[1], qf[0],
            q7, qg[1], qg[0],
            (sales[i % len(sales)]).strip().lower(),   # owner_user_id（独立记录归属）
        ))

    cols = ("quote_no,project_name,province,customer,bu,construction,startup_pct,sign_pct,"
            "manager,manager_phone,company_info,initial_quote_date,est_purchase_date,"
            "est_ship_date,quote_version,last_quote_date,rate_rmb_vnd,rate_usd_vnd,incoterm,"
            "install_quoted,salesperson,remark,pdf_equip,pdf_install,pdf_both,"
            "q1_rmb,q1_usd,q1_vnd,q2_rmb,q2_usd,q2_vnd,q3_rmb,q3_usd,q3_vnd,"
            "q4_rmb,q4_usd,q4_vnd,q5_rmb,q5_usd,q5_vnd,q6_rmb,q6_usd,q6_vnd,"
            "q7_rmb,q7_usd,q7_vnd,owner_user_id")
    placeholders = ",".join(["?"] * 47)
    c.executemany(
        "INSERT INTO crm_projects ({}) VALUES ({})".format(cols, placeholders),
        rows
    )


def seed_won_projects(c):
    """在 won_projects 为空时注入示例签约项目数据（供看板图表测试/演示用）。
    
    这些数据用于渲染签约项目看板中的三个图表：
    1. 各BU累计销售 vs 当年 - 需要 AGI-Customer 和 GS-Customer 的项目
    2. 各BU历年销售占比 - 需要按年份分组的数据
    3. 各BU当年销售占比 - 需要当年按签约方分组的数据
    
    注意：前端看板使用 total_equip_usd 字段计算销售金额，所以种子数据必须包含此字段
    """
    import datetime
    now = datetime.datetime.now()
    current_year = now.year
    
    # 示例签约项目数据：混合不同年份和签约方
    # total_equip_* 是前端图表使用的关键字段（签单金额）
    won_data = [
        # AGI-Customer 项目 (历年)
        {"contract_no": "AGI-2024-001", "customer": "河内养猪场A", "contract_date": f"{current_year-2}-03-15",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25000,
         "incoterm": "CIF", "salesperson": "Tom", 
         "total_equip_rmb": 2200000, "total_equip_usd": 75000, "total_equip_vnd": 1875000000,
         "total_ei_rmb": 2800000, "total_ei_usd": 95000, "total_ei_vnd": 2375000000},
        {"contract_no": "AGI-2024-002", "customer": "海防蛋鸡场B", "contract_date": f"{current_year-2}-06-20",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25000,
         "incoterm": "DDP", "salesperson": "Travis",
         "total_equip_rmb": 2500000, "total_equip_usd": 85000, "total_equip_vnd": 2125000000,
         "total_ei_rmb": 3200000, "total_ei_usd": 108000, "total_ei_vnd": 2700000000},
        {"contract_no": "AGI-2024-003", "customer": "同奈肉鸡场C", "contract_date": f"{current_year-2}-09-10",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25000,
         "incoterm": "CIF", "salesperson": "Tom",
         "total_equip_rmb": 1500000, "total_equip_usd": 51000, "total_equip_vnd": 1275000000,
         "total_ei_rmb": 1950000, "total_ei_usd": 66000, "total_ei_vnd": 1650000000},
        {"contract_no": "AGI-2025-001", "customer": "北宁养猪场D", "contract_date": f"{current_year-1}-02-28",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25500,
         "incoterm": "CIF", "salesperson": "Ali",
         "total_equip_rmb": 3200000, "total_equip_usd": 105000, "total_equip_vnd": 2677500000,
         "total_ei_rmb": 4100000, "total_ei_usd": 135000, "total_ei_vnd": 3442500000},
        {"contract_no": "AGI-2025-002", "customer": "胡志明饲料厂E", "contract_date": f"{current_year-1}-05-15",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25500,
         "incoterm": "DDP", "salesperson": "Tom",
         "total_equip_rmb": 4400000, "total_equip_usd": 145000, "total_equip_vnd": 3697500000,
         "total_ei_rmb": 5600000, "total_ei_usd": 184000, "total_ei_vnd": 4692000000},
        {"contract_no": "AGI-2025-003", "customer": "岘港禽蛋场F", "contract_date": f"{current_year-1}-08-22",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25500,
         "incoterm": "CIF", "salesperson": "Travis",
         "total_equip_rmb": 1800000, "total_equip_usd": 59000, "total_equip_vnd": 1504500000,
         "total_ei_rmb": 2350000, "total_ei_usd": 77000, "total_ei_vnd": 1963500000},
        {"contract_no": "AGI-2026-001", "customer": "太原养猪场G", "contract_date": f"{current_year}-01-10",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25800,
         "incoterm": "CIF", "salesperson": "Tom",
         "total_equip_rmb": 3800000, "total_equip_usd": 123000, "total_equip_vnd": 3173400000,
         "total_ei_rmb": 4800000, "total_ei_usd": 155000, "total_ei_vnd": 3999000000},
        {"contract_no": "AGI-2026-002", "customer": "广宁鸭场H", "contract_date": f"{current_year}-03-18",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25800,
         "incoterm": "DDP", "salesperson": "Ali",
         "total_equip_rmb": 1650000, "total_equip_usd": 53000, "total_equip_vnd": 1367400000,
         "total_ei_rmb": 2100000, "total_ei_usd": 68000, "total_ei_vnd": 1754400000},
        {"contract_no": "AGI-2026-003", "customer": "西宁禽类场I", "contract_date": f"{current_year}-06-05",
         "signing_parties": "AGI-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25800,
         "incoterm": "CIF", "salesperson": "Travis",
         "total_equip_rmb": 3000000, "total_equip_usd": 97000, "total_equip_vnd": 2502600000,
         "total_ei_rmb": 3800000, "total_ei_usd": 123000, "total_ei_vnd": 3173400000},
        # GS-Customer 项目 (历年)
        {"contract_no": "GS-2024-001", "customer": "河内养鸡场J", "contract_date": f"{current_year-2}-04-12",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25000,
         "incoterm": "CIF", "salesperson": "Cuong",
         "total_equip_rmb": 1200000, "total_equip_usd": 41000, "total_equip_vnd": 1025000000,
         "total_ei_rmb": 1500000, "total_ei_usd": 51000, "total_ei_vnd": 1275000000},
        {"contract_no": "GS-2024-002", "customer": "海防养鸭场K", "contract_date": f"{current_year-2}-07-25",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25000,
         "incoterm": "DDP", "salesperson": "Khoa",
         "total_equip_rmb": 1750000, "total_equip_usd": 59500, "total_equip_vnd": 1487500000,
         "total_ei_rmb": 2200000, "total_ei_usd": 74500, "total_ei_vnd": 1862500000},
        {"contract_no": "GS-2024-003", "customer": "同奈养猪场L", "contract_date": f"{current_year-2}-10-08",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25000,
         "incoterm": "CIF", "salesperson": "Cuong",
         "total_equip_rmb": 1400000, "total_equip_usd": 47500, "total_equip_vnd": 1187500000,
         "total_ei_rmb": 1800000, "total_ei_usd": 61000, "total_ei_vnd": 1525000000},
        {"contract_no": "GS-2025-001", "customer": "北宁禽蛋场M", "contract_date": f"{current_year-1}-03-30",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25500,
         "incoterm": "CIF", "salesperson": "James",
         "total_equip_rmb": 2300000, "total_equip_usd": 76000, "total_equip_vnd": 1938000000,
         "total_ei_rmb": 2900000, "total_ei_usd": 95500, "total_ei_vnd": 2435250000},
        {"contract_no": "GS-2025-002", "customer": "胡志明养鸡场N", "contract_date": f"{current_year-1}-07-18",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25500,
         "incoterm": "DDP", "salesperson": "Cuong",
         "total_equip_rmb": 3250000, "total_equip_usd": 107000, "total_equip_vnd": 2728500000,
         "total_ei_rmb": 4100000, "total_ei_usd": 135000, "total_ei_vnd": 3442500000},
        {"contract_no": "GS-2025-003", "customer": "岘港饲料厂O", "contract_date": f"{current_year-1}-11-05",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25500,
         "incoterm": "CIF", "salesperson": "Khoa",
         "total_equip_rmb": 1300000, "total_equip_usd": 42800, "total_equip_vnd": 1091400000,
         "total_ei_rmb": 1650000, "total_ei_usd": 54300, "total_ei_vnd": 1384650000},
        {"contract_no": "GS-2026-001", "customer": "太原禽类场P", "contract_date": f"{current_year}-02-14",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25800,
         "incoterm": "CIF", "salesperson": "Cuong",
         "total_equip_rmb": 2750000, "total_equip_usd": 89000, "total_equip_vnd": 2296200000,
         "total_ei_rmb": 3500000, "total_ei_usd": 113000, "total_ei_vnd": 2915400000},
        {"contract_no": "GS-2026-002", "customer": "广宁养猪场Q", "contract_date": f"{current_year}-04-22",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25800,
         "incoterm": "DDP", "salesperson": "James",
         "total_equip_rmb": 2150000, "total_equip_usd": 69500, "total_equip_vnd": 1793100000,
         "total_ei_rmb": 2700000, "total_ei_usd": 87500, "total_ei_vnd": 2257500000},
        {"contract_no": "GS-2026-003", "customer": "西宁养鸡场R", "contract_date": f"{current_year}-07-12",
         "signing_parties": "GS-Customer", "contract_currency": "USD", "rate_rmb_vnd": 4800, "rate_usd_vnd": 25800,
         "incoterm": "CIF", "salesperson": "Khoa",
         "total_equip_rmb": 2450000, "total_equip_usd": 79000, "total_equip_vnd": 2038200000,
         "total_ei_rmb": 3100000, "total_ei_usd": 100000, "total_ei_vnd": 2580000000},
    ]
    
    # 插入数据库
    for proj in won_data:
        c.execute("""
            INSERT INTO won_projects (
                contract_no, customer, contract_date, signing_parties, contract_currency,
                rate_rmb_vnd, rate_usd_vnd, incoterm, salesperson, owner_user_id,
                total_equip_rmb, total_equip_usd, total_equip_vnd,
                total_ei_rmb, total_ei_usd, total_ei_vnd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            proj["contract_no"], proj["customer"], proj["contract_date"],
            proj["signing_parties"], proj["contract_currency"],
            proj["rate_rmb_vnd"], proj["rate_usd_vnd"], proj["incoterm"], proj["salesperson"],
            (proj.get("salesperson") or "").strip().lower(),
            proj["total_equip_rmb"], proj["total_equip_usd"], proj["total_equip_vnd"],
            proj["total_ei_rmb"], proj["total_ei_usd"], proj["total_ei_vnd"]
        ))


def seed_approval_requests(c):
    """注入示例审批数据，所有审批均来自「界面/操作权限」中勾选了"发起审批"的区块。

    字段说明（对应实际表结构）：
      - title：审批事项标题 = 权限区块名称
      - requester：发起人（用户名）
      - approvers：审批人（多人 JSON 数组）
      - created_at：发起日期
      - resolved_at：审批日期
      - status：pending / approved / rejected
      - result_note：审批结果/意见
      - content：审批内容 = 该区块"默认保留信息"列的说明文字
      - block_id / block_name：对应权限区块
    """
    cnt = c.execute("SELECT COUNT(*) FROM approval_requests").fetchone()[0]
    if cnt > 0:
        return
    now = time.strftime("%Y-%m-%d %H:%M:%S")

    # 与前端 i18n 中 user_block_<bid>_info 保持一致的说明文字（审批内容）
    INFO = {
        "DB-P1": "保留默认=不显示此图（C类全公司聚合，需「特别授权看全公司」才显示按省份柱图） · 默认不显示",
        "DB-B1": "保留默认=不显示此图（C类全公司聚合，需「特别授权看全公司」才显示按BU柱图） · 默认不显示",
        "DB-C1": "保留默认=不显示此图（C类全公司聚合，需「特别授权看全公司」才显示按建设阶段柱图） · 默认不显示",
        "CRM-D2": "保留默认=列表/详情显示「编辑」按钮，可编辑数据范围内的CRM项目 · 默认显示",
        "CRM-D3": "保留默认=列表/详情显示「删除」按钮，可删除数据范围内的CRM项目 · 默认显示",
        "CRM-E1": "保留默认=列表顶部显示「导出」按钮，导出数据范围内的项目 · 默认显示",
        "WON-D2": "保留默认=列表/详情显示「编辑」按钮，可编辑数据范围内的Won项目 · 默认显示",
        "WON-D4": "保留默认=详情显示「查看CPR报告」按钮，可打开数据范围内项目的智能报告 · 默认显示",
        "APP-L3": "保留默认=不显示此入口（C类全公司记录，需「特别授权看全公司」才显示） · 默认不显示",
        "USR-D1": "保留默认=不显示此入口（S类敏感操作，仅管理员可见） · 默认不显示",
    }
    # (block_id, block_name, 发起人, 审批人, 发起日期, 审批日期, 状态, 审批意见)
    samples = [
        ("DB-P1", "按省份统计双轴柱图", "cuong", ["tom", "dgm1"], "2026-08-10 09:12", "2026-08-11 15:40", "approved", "已阅，同意开放该图表。"),
        ("DB-B1", "按BU统计双轴柱图", "james", ["tom", "travis"], "2026-08-12 14:03", "2026-08-13 10:25", "approved", "BU 聚合信息可开放。"),
        ("DB-C1", "按建设情况统计双轴柱图", "khoa", ["tom", "salesdir1"], "2026-08-14 11:20", "", "pending", ""),
        ("CRM-E1", "导出Excel", "ali", ["travis", "fin1"], "2026-08-18 16:45", "", "pending", ""),
        ("WON-D4", "查看CPR报告", "linh", ["tom", "gm2"], "2026-08-19 08:50", "2026-08-20 17:10", "rejected", "权限过高，暂不同意。"),
        ("APP-L3", "全公司审批记录", "minh", ["tom", "dgm1"], "2026-08-21 13:30", "2026-08-22 09:15", "approved", "已确认可查看。"),
    ]
    for bid, bname, requester, approvers, created, resolved, status, note in samples:
        c.execute("""
            INSERT INTO approval_requests
            (title, requester, approvers, created_at, resolved_at, status, result_note, content, block_id, block_name)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (bname, requester, json.dumps(approvers, ensure_ascii=False), created, resolved,
              status, note, INFO.get(bid, ""), bid, bname))
    print("[init_db] approval_requests 已自动注入示例审批数据")


def migrate_crm_seed(c):
    """修正旧版种子数据，使其与模态框下拉选项值一致。

    旧版种子将省份存为中文、BU 存为 "GS/AGI/BOD"、建设情况存为中文，
    而前端下拉框的 <option value> 分别为越南语省名、BU 代码、建设情况代码，
    导致模态框下拉框无法匹配、必填校验失败（表现为按钮无反应）。
    本函数仅处理种子数据（quote_no 形如 QT-2026-xxx），不改动用户录入的数据。
    """
    # 旧中文省名 -> 越南语省名（对应前端 provinceOptionsHtml 的 value）
    province_map = {
        "北江": "Bắc Ninh", "北宁": "Bắc Ninh", "海防": "Hải Phòng",
        "胡志明市": "TP. Hồ Chí Minh", "河内": "Hà Nội", "隆安": "Tây Ninh",
        "同奈": "Đồng Nai", "平阳": "Vĩnh Long", "广宁": "Quảng Ninh",
        "太原": "Thái Nguyên",
    }
    # 旧 "GS/AGI/BOD" -> BU 代码
    bu_map = {"GS": "pig_farm", "AGI": "broiler_farm", "BOD": "chicken_egg_farm"}
    # 旧中文建设情况 -> 建设情况代码
    cons_map = {
        "钢结构": "land", "土建": "license", "机电": "design", "消防": "bidding",
        "给排水": "supplier_sel", "装修": "nearing",
    }

    rows = c.execute(
        "SELECT id, province, bu, construction, startup_pct, sign_pct "
        "FROM crm_projects WHERE quote_no LIKE 'QT-2026-%'"
    ).fetchall()
    changed = 0
    for rid, province, bu, cons, startup_pct, sign_pct in rows:
        new_prov = province_map.get(province, province)
        new_bu = bu_map.get(bu, bu)
        new_cons = cons_map.get(cons, cons)

        def clamp_pct(v):
            try:
                n = int(str(v).replace("%", ""))
            except (TypeError, ValueError):
                return v
            return str(max(0, min(100, n)))

        new_startup = clamp_pct(startup_pct)
        new_sign = clamp_pct(sign_pct)

        if (new_prov != province or new_bu != bu or new_cons != cons
                or new_startup != startup_pct or new_sign != sign_pct):
            c.execute(
                "UPDATE crm_projects SET province=?, bu=?, construction=?, "
                "startup_pct=?, sign_pct=? WHERE id=?",
                (new_prov, new_bu, new_cons, new_startup, new_sign, rid)
            )
            changed += 1
    if changed:
        print("[init_db] 已修正 {} 条 CRM 种子数据（省份/BU/建设情况/概率）".format(changed))


def migrate_crm_seed_v2(c):
    """修正 CRM 种子数据的展示一致性与多样性：

    1. 三币联动：将 q1~q7 的 USD/VND 按各项目自身的汇率换算，使 RMB/USD/VND 三币一致；
    2. 负责人电话：多样化越南手机号，避免千篇一律；
    3. 公司信息：结合客户名 + 越南不同地址，避免全部相同；
    4. 启动概率/签约概率：多样化，避免全部为 100%（签约概率不高于启动概率）。
    仅处理种子数据（quote_no 形如 QT-2026-xxx），不改动用户录入的数据。
    """
    startup_pcts = [30, 45, 60, 75, 80, 90, 55, 70, 85, 95, 40, 65, 50, 88, 72,
                    35, 58, 68, 92, 48, 62, 38, 82, 52, 78, 42, 96, 25, 64, 74]
    sign_pcts =    [15, 30, 45, 60, 70, 80, 40, 55, 70, 85, 25, 50, 35, 72, 55,
                    20, 42, 52, 80, 32, 46, 22, 68, 36, 60, 28, 85, 15, 50, 62]
    phone_pref = ["09", "03", "07", "08", "05"]
    addr_cities = ["胡志明市", "河内", "海防", "岘港", "同奈", "北宁", "太原", "广宁", "西宁", "永隆"]
    addr_zone = ["工业园区", "高新技术区", "出口加工区", "经济开发区", "商贸中心"]
    company_extra = ["越南分公司", "驻越办事处", "制造基地", "项目工程部", "区域服务中心"]

    def to_num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    rows = c.execute(
        "SELECT id, customer, rate_rmb_vnd, rate_usd_vnd, "
        "q1_rmb,q1_usd,q1_vnd,q2_rmb,q2_usd,q2_vnd,q3_rmb,q3_usd,q3_vnd,"
        "q4_rmb,q4_usd,q4_vnd,q5_rmb,q5_usd,q5_vnd,q6_rmb,q6_usd,q6_vnd,"
        "q7_rmb,q7_usd,q7_vnd "
        "FROM crm_projects WHERE quote_no LIKE 'QT-2026-%' ORDER BY id"
    ).fetchall()
    changed = 0
    for idx, row in enumerate(rows):
        rid = row["id"]
        customer = row["customer"] or ""
        rate_rmb_vnd = to_num(row["rate_rmb_vnd"])
        rate_usd_vnd = to_num(row["rate_usd_vnd"])
        # 三币联动：以 RMB 为基准，按项目汇率换算 USD / VND（与模态框 crmQuoteLink 一致）
        q_vals = []
        for qn in range(1, 8):
            rmb = to_num(row["q{}_rmb".format(qn)])
            vnd = round(rmb * rate_rmb_vnd) if rate_rmb_vnd > 0 else to_num(row["q{}_vnd".format(qn)])
            usd = round(vnd / rate_usd_vnd) if rate_usd_vnd > 0 else to_num(row["q{}_usd".format(qn)])
            q_vals.extend([round(rmb), usd, vnd])
        # 电话 / 公司信息 / 概率 多样化
        phone = phone_pref[idx % len(phone_pref)] + "{:08d}".format((idx * 137) % 100000000)
        company = "{}·{}·{} · {}".format(customer, addr_cities[idx % len(addr_cities)],
                                         addr_zone[idx % len(addr_zone)],
                                         company_extra[idx % len(company_extra)])
        startup = startup_pcts[idx % len(startup_pcts)]
        sign = sign_pcts[idx % len(sign_pcts)]
        c.execute(
            "UPDATE crm_projects SET "
            "q1_rmb=?,q1_usd=?,q1_vnd=?,q2_rmb=?,q2_usd=?,q2_vnd=?,"
            "q3_rmb=?,q3_usd=?,q3_vnd=?,q4_rmb=?,q4_usd=?,q4_vnd=?,"
            "q5_rmb=?,q5_usd=?,q5_vnd=?,q6_rmb=?,q6_usd=?,q6_vnd=?,"
            "q7_rmb=?,q7_usd=?,q7_vnd=?,manager_phone=?,company_info=?,"
            "startup_pct=?,sign_pct=? WHERE id=?",
            q_vals + [phone, company, str(startup), str(sign), rid]
        )
        changed += 1
    if changed:
        print("[init_db] 已修正 {} 条 CRM 种子数据（三币联动/电话/公司信息/概率 多样化）".format(changed))


init_db()


# ===================== 工具 =====================
def safe_name(s):
    s = os.path.basename(s or "")
    s = re.sub(r"[^A-Za-z0-9_.-]", "_", s) if False else s.replace("\\", "_").replace("/", "_")
    return s or "file"

ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".xls", ".xlsx", ".doc", ".docx", ".txt"}

# ===================== API：登录 / 密码 =====================
@app.route("/api/login", methods=["POST"])
def _verify_cloud_password(stored, password):
    """校验云端 Worker 同款密码：pbkdf2$迭代$盐hex$哈希hex（PBKDF2-SHA256/256位）。
    历史明文（无前缀）直接比对。"""
    try:
        stored = str(stored or "")
        if not stored.startswith("pbkdf2$"):
            return stored == password
        parts = stored.split("$")
        it = int(parts[1]) if parts[1].isdigit() else 100000
        salt = bytes.fromhex(parts[2])
        expected = parts[3]
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, it, dklen=32)
        return dk.hex() == expected
    except Exception:
        return False


def _cloud_mirror_login(conn, username, password):
    """桌面版离线登录兜底：用同步下来的云端用户镜像（_cloud_users）校验。

    返回 (user_dict, None) 或 (None, 错误消息)。镜像不存在时返回 (None, '')，
    由调用方回退到「用户名不存在」。"""
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(_cloud_users)").fetchall()]
        if "username" not in cols:
            return None, ''
        row = conn.execute("SELECT * FROM _cloud_users WHERE username=?", (username,)).fetchone()
        if not row:
            return None, ''
        if str(row["status"] or "active") != "active":
            return None, "该账号已被禁用"
        if not _verify_cloud_password(row["password"], password):
            return None, "密码错误"
        try:
            perms = json.loads(row["perms"]) if row["perms"] else {}
        except Exception:
            perms = {}
        is_admin = False
        try:
            is_admin = bool(conn.execute(
                "SELECT 1 FROM _cloud_managers WHERE username=?", (username,)).fetchone())
        except Exception:
            pass
        if not is_admin and (row["role"] or "") == "管理员":
            is_admin = True
        def _ids(raw):
            try:
                v = json.loads(raw or "[]")
                return v if isinstance(v, list) else []
            except Exception:
                return []
        return {
            "username": row["username"],
            "real_name": row["real_name"] or "",
            "role": row["role"] or "",
            "position": row["position"] or "",
            "is_admin": bool(is_admin),
            "status": "active",
            "vis_he_can_see": _ids(row["vis_he_can_see"]),
            "vis_can_see_me": _ids(row["vis_can_see_me"]),
            "perms": perms,
            "offline": True,
        }, None
    except Exception:
        return None, ''


def login():
    data = request.get_json(force=True, silent=True) or {}
    # 统一转小写：手机键盘首字母自动大写会输入 "Tom"，而库存的是 "tom"，
    # SQLite 的 = 比较大小写敏感会导致登录失败。这里归一化，任何大小写都能登录。
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"ok": False, "error": "请输入用户名和密码"})
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        # 本机 users 表没有该账号 → 尝试【云端用户目录镜像】离线登录（桌面版）。
        # 镜像由 sync_client.sync_users() 随每次同步从云端单向拉下来，
        # 密码是云端同款 PBKDF2 哈希，本机离线也能校验，效果与联网登录一致。
        cuser, cerr = _cloud_mirror_login(conn, username, password)
        if cuser is None:
            conn.close()
            return jsonify({"ok": False, "error": cerr or "用户名不存在"})
        try:
            conn.execute("INSERT INTO login_history (username, ip_address, user_agent) VALUES (?, ?, ?)",
                         (username, request.remote_addr or '', (request.headers.get('User-Agent') or '')[:200]))
            conn.commit()
        except Exception:
            pass
        conn.close()
        return jsonify({"ok": True, "user": cuser})
    if row["status"] != "active":
        conn.close()
        return jsonify({"ok": False, "error": "该账号已被禁用"})
    if row["password"] != password:
        conn.close()
        return jsonify({"ok": False, "error": "密码错误"})
    # 记录登录（成功才记录）
    try:
        ip = request.remote_addr or ''
        ua = request.headers.get('User-Agent', '')[:200]
        conn.execute("INSERT INTO login_history (username, ip_address, user_agent) VALUES (?, ?, ?)",
                     (username, ip, ua))
        conn.commit()
    except Exception as e:
        print(f"[Login] Failed to record login history: {e}")
    def _col(k, d=""):
        try:
            v = row[k]
            return v if v is not None else d
        except Exception:
            return d
    role_val = _col("role")
    role_l = (role_val or "").lower()
    is_admin = _is_manager(conn, _col("username"))
    perms_raw = _col("perms", "{}")
    try:
        perms = json.loads(perms_raw) if perms_raw else {}
    except Exception:
        perms = {}
    perms = _norm_user_perms(perms, conn)
    def _ids(raw):
        try:
            v = json.loads(raw or "[]")
            return v if isinstance(v, list) else []
        except Exception:
            return []
    conn.close()
    return jsonify({"ok": True, "user": {
        "username": _col("username"),
        "real_name": _col("real_name"),
        "role": role_val,
        "position": _col("position"),
        "is_admin": bool(is_admin),
        "status": _col("status", "active"),
        "vis_he_can_see": _ids(_col("vis_he_can_see", "[]")),
        "vis_can_see_me": _ids(_col("vis_can_see_me", "[]")),
        # 操作权限决策：{bid: {decision, approvers}}，前端据此做界面拦截
        "perms": perms
    }})


def _is_manager(conn, username):
    """判断用户是否为管理员：在自由任命的管理员表中，或角色为“管理员”。"""
    if not username:
        return False
    row = conn.execute("SELECT 1 FROM managers WHERE username=?", (username,)).fetchone()
    if row:
        return True
    u = conn.execute("SELECT role FROM users WHERE username=?", (username,)).fetchone()
    return bool(u) and (u["role"] or "") == "管理员"


def _manager_usernames(conn):
    """返回当前所有管理员账号列表。"""
    return [r["username"] for r in conn.execute("SELECT username FROM managers ORDER BY username").fetchall()]


@app.route("/api/me", methods=["GET"])
def api_me():
    """前端恢复 sessionStorage 中的 authUser 后，用 username 刷新最新 role/is_admin/perms，
    避免旧缓存（没有 is_admin 字段）导致管理员入口/图表被隐藏。"""
    username = (request.args.get("username") or "").strip()
    if not username:
        return jsonify({"ok": False, "error": "missing username"})
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "user not found"})
    def _col(k, d=""):
        try:
            v = row[k]
            return v if v is not None else d
        except Exception:
            return d
    is_admin = _is_manager(conn, _col("username"))
    perms_raw = _col("perms", "{}")
    try:
        perms = json.loads(perms_raw) if perms_raw else {}
    except Exception:
        perms = {}
    perms = _norm_user_perms(perms, conn)
    def _ids(raw):
        try:
            v = json.loads(raw or "[]")
            return v if isinstance(v, list) else []
        except Exception:
            return []
    conn.close()
    return jsonify({"ok": True, "user": {
        "username": _col("username"),
        "real_name": _col("real_name"),
        "role": _col("role"),
        "position": _col("position"),
        "is_admin": bool(is_admin),
        "status": _col("status", "active"),
        "vis_he_can_see": _ids(_col("vis_he_can_see", "[]")),
        "vis_can_see_me": _ids(_col("vis_can_see_me", "[]")),
        "perms": perms
    }})

# ============================================================
# 看板聚合统计：复刻云端 /api/dashboard-stats，供桌面版使用
# ============================================================
def _dash_sum_with_fallback(primary, fallback, suffix):
    p = primary + "_" + suffix
    f = fallback + "_" + suffix
    return (f"SUM(CASE WHEN {p} IS NULL THEN COALESCE(CAST({f} AS REAL),0) "
            f"ELSE CAST({p} AS REAL) END)")


@app.route("/api/dashboard-stats", methods=["GET"])
def api_dashboard_stats():
    """返回 CRM/WON/LOST 的计数与三币汇总，降低前端全量拉表开销。"""
    username = (request.headers.get("X-User-Name") or "").strip()

    def _stats_for(table, block_id, primary, fallback, status_where=None):
        vs_clause, vs_params = _visible_scope(username, block_id)
        where = ["lower(salesperson) <> 'agi-gs internal'"]
        params = []
        if status_where:
            where.append(status_where)
        if vs_clause:
            where.append("(" + vs_clause + ")")
            params.extend(vs_params)
        where_sql = " WHERE " + " AND ".join(where)
        sql = (f"SELECT COUNT(*) AS cnt, "
               f"{_dash_sum_with_fallback(primary, fallback, 'rmb')} AS rmb, "
               f"{_dash_sum_with_fallback(primary, fallback, 'usd')} AS usd, "
               f"{_dash_sum_with_fallback(primary, fallback, 'vnd')} AS vnd "
               f"FROM {table}{where_sql}")
        conn = get_db()
        try:
            row = conn.execute(sql, params).fetchone()
            return {
                "count": row["cnt"] or 0,
                "rmb": round(row["rmb"] or 0),
                "usd": round(row["usd"] or 0),
                "vnd": round(row["vnd"] or 0),
            }
        finally:
            conn.close()

    try:
        # 看板顶部统计卡统一受 DB-S1 数据范围控制，与三模块列表权限独立
        crm = _stats_for(
            "crm_projects", "DB-S1", "q1", "0",
            status_where="(status='active' OR status IS NULL OR status='')"
        )
        won = _stats_for("won_projects", "DB-S1", "total_ei", "equip")
        lost = _stats_for("lost_projects", "DB-S1", "q1", "0")
        return jsonify({"ok": True, "crm": crm, "won": won, "lost": lost})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ==================== 个人佣金 · 修改金额审批 ====================
# 规则（后门三人组专用）：
#   1. 仅 tom / cuong / travis 可发起佣金金额修改；
#   2. 审批发给【除请求者外的另外两人】；
#   3. 两人都同意 → 通过，系统自动把金额改成新值；任一拒绝 → 作废；
#   4. 只支持改金额，不支持改付款日期；
#   5. 只在「个人佣金 → 查看与审批」展示，不混入全局审批页。
COMMISSION_APPROVERS = ["tom", "cuong", "travis"]


def _comm_now():
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _comm_approvers_for(requester):
    r = str(requester or "").strip().lower()
    return [u for u in COMMISSION_APPROVERS if u != r]


# ==================== 个人佣金 · 佣金记录持久化（SQLite） ====================
#   设计要点：
#     · 案例数据（DEMO2 灌入）写库时打 is_demo=1；真实录入的数据 is_demo=0
#     · 最后「清空 DEMO」只需 DELETE ... WHERE is_demo=1，绝不会误伤真实数据
#     · 主记录按 contract 唯一索引 upsert；受益人按 record_id 整组替换（明细 payments 存 JSON）

def _comm_rec_to_dict(row, conn):
    """把主记录行 + 其受益人（含 payments 明细）组装成前端 COMM_RECORDS 的元素结构"""
    d = dict(row)
    item = {
        "contract": d.get("contract") or "",
        "parties": d.get("parties") or "",
        "group": d.get("group_name") or "",
        "date": d.get("sign_date") or "",
        "depositDate": d.get("deposit_date") or "",
        "currency": d.get("currency") or "",
        "equipRMB": d.get("equip_rmb") or "",
        "equipUSD": d.get("equip_usd") or "",
        "equipVND": d.get("equip_vnd") or "",
        "rateRMB": d.get("rate_rmb") or "",
        "rateUSD": d.get("rate_usd") or "",
        "remark": d.get("remark") or "",
        "isDemo": int(d.get("is_demo") or 0),
        "beneficiaries": [],
    }
    bens = conn.execute(
        "SELECT * FROM commission_beneficiaries WHERE record_id=? ORDER BY ben_index",
        (d.get("id"),)).fetchall()
    for b in bens:
        bd = dict(b)
        try:
            payments = json.loads(bd.get("payments") or "[]")
        except Exception:
            payments = []
        # 明细里的空字符串统一还原为 ''（前端 parseMoney 兼容）
        for p in payments:
            for k, v in list(p.items()):
                if v is None:
                    p[k] = ""
        item["beneficiaries"].append({
            "name": bd.get("name") or "",
            "currency": bd.get("currency") or "",
            "totalRMB": bd.get("total_rmb") or "",
            "totalUSD": bd.get("total_usd") or "",
            "totalVND": bd.get("total_vnd") or "",
            "signDate": bd.get("sign_date") or "",
            "depositDate": bd.get("deposit_date") or "",
            "paidRMB": bd.get("paid_rmb") or "",
            "paidUSD": bd.get("paid_usd") or "",
            "paidVND": bd.get("paid_vnd") or "",
            "payCount": bd.get("pay_count") or 0,
            "unpaidRMB": bd.get("unpaid_rmb") or "",
            "unpaidUSD": bd.get("unpaid_usd") or "",
            "unpaidVND": bd.get("unpaid_vnd") or "",
            "payNature": bd.get("pay_nature") or "",
            "note": bd.get("note") or "",
            "payments": payments,
        })
    return item


@app.route("/api/commission/records", methods=["GET"])
def api_comm_records_get():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM commission_records ORDER BY id").fetchall()
        items = [_comm_rec_to_dict(r, conn) for r in rows]
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/commission/records", methods=["POST"])
def api_comm_records_save():
    """保存一条佣金记录（按 contract upsert），payload 形如：
       { record: {...前端 COMM_RECORDS 元素...}, isDemo: 0|1 }"""
    body = request.get_json(force=True, silent=True) or {}
    rec = body.get("record") or {}
    contract = str(rec.get("contract") or "").strip()
    if not contract:
        return jsonify({"error": "缺少合同编号"}), 400

    is_demo = 1 if (body.get("isDemo") or rec.get("isDemo")) else 0
    bens = rec.get("beneficiaries") or []
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id FROM commission_records WHERE contract=?", (contract,)).fetchone()
        if row:
            rid = row["id"]
            conn.execute(
                "UPDATE commission_records SET parties=?, group_name=?, sign_date=?,"
                " deposit_date=?, currency=?, equip_rmb=?, equip_usd=?, equip_vnd=?,"
                " rate_rmb=?, rate_usd=?, remark=?, is_demo=?,"
                " updated_at=datetime('now','localtime') WHERE id=?",
                (str(rec.get("parties") or ""), str(rec.get("group") or ""),
                 str(rec.get("date") or ""), str(rec.get("depositDate") or ""),
                 str(rec.get("currency") or ""), str(rec.get("equipRMB") or ""),
                 str(rec.get("equipUSD") or ""), str(rec.get("equipVND") or ""),
                 str(rec.get("rateRMB") or ""), str(rec.get("rateUSD") or ""),
                 str(rec.get("remark") or ""), is_demo, rid))
        else:
            cur = conn.execute(
                "INSERT INTO commission_records (contract, parties, group_name,"
                " sign_date, deposit_date, currency, equip_rmb, equip_usd, equip_vnd,"
                " rate_rmb, rate_usd, remark, is_demo)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (contract, str(rec.get("parties") or ""), str(rec.get("group") or ""),
                 str(rec.get("date") or ""), str(rec.get("depositDate") or ""),
                 str(rec.get("currency") or ""), str(rec.get("equipRMB") or ""),
                 str(rec.get("equipUSD") or ""), str(rec.get("equipVND") or ""),
                 str(rec.get("rateRMB") or ""), str(rec.get("rateUSD") or ""),
                 str(rec.get("remark") or ""), is_demo))
            rid = cur.lastrowid

        # 受益人整组替换（明细 payments 序列化为 JSON）
        conn.execute("DELETE FROM commission_beneficiaries WHERE record_id=?", (rid,))
        for i, b in enumerate(bens):
            if not isinstance(b, dict):
                continue
            conn.execute(
                "INSERT INTO commission_beneficiaries (record_id, ben_index, name,"
                " currency, total_rmb, total_usd, total_vnd, sign_date, deposit_date,"
                " paid_rmb, paid_usd, paid_vnd, pay_count, unpaid_rmb, unpaid_usd,"
                " unpaid_vnd, pay_nature, note, payments)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rid, i, str(b.get("name") or ""), str(b.get("currency") or ""),
                 str(b.get("totalRMB") or ""), str(b.get("totalUSD") or ""),
                 str(b.get("totalVND") or ""), str(b.get("signDate") or ""),
                 str(b.get("depositDate") or ""), str(b.get("paidRMB") or ""),
                 str(b.get("paidUSD") or ""), str(b.get("paidVND") or ""),
                 int(b.get("payCount") or 0), str(b.get("unpaidRMB") or ""),
                 str(b.get("unpaidUSD") or ""), str(b.get("unpaidVND") or ""),
                 str(b.get("payNature") or ""), str(b.get("note") or ""),
                 json.dumps(b.get("payments") or [], ensure_ascii=False)))
        conn.commit()
        return jsonify({"ok": True, "id": rid, "saved": len(bens)})
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/commission/records/demo", methods=["DELETE"])
def api_comm_records_clear_demo():
    """清除全部 DEMO 案例（is_demo=1），真实录入的数据（is_demo=0）一律保留"""
    conn = get_db()
    try:
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM commission_records WHERE is_demo=1").fetchall()]
        n = 0
        if ids:
            ph = ",".join("?" * len(ids))
            conn.execute(
                "DELETE FROM commission_beneficiaries WHERE record_id IN (%s)" % ph, ids)
            n = conn.execute(
                "DELETE FROM commission_records WHERE id IN (%s)" % ph, ids).rowcount
        conn.commit()
        return jsonify({"ok": True, "cleared": (n if n and n > 0 else len(ids))})
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/commission/records/<contract>", methods=["DELETE"])
def api_comm_records_delete(contract):
    """删除指定合同编号的记录（用于前端删除单条）"""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id FROM commission_records WHERE contract=?", (contract,)).fetchone()
        if not row:
            return jsonify({"error": "记录不存在"}), 404
        rid = row["id"]
        conn.execute("DELETE FROM commission_beneficiaries WHERE record_id=?", (rid,))
        conn.execute("DELETE FROM commission_records WHERE id=?", (rid,))
        conn.commit()
        return jsonify({"ok": True})
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/commission/amount-requests", methods=["GET", "POST"])
def api_comm_amt_requests():
    conn = get_db()
    if request.method == "GET":
        rows = conn.execute(
            "SELECT * FROM comm_amt_requests ORDER BY id DESC").fetchall()
        conn.close()
        items = []
        for r in rows:
            d = dict(r)
            # 重新激活类申请（req_key 以 REACTIVATE 开头）→ 前端据此外挂解锁而非改金额
            d["reactivate"] = str(d.get("req_key") or "").startswith("REACTIVATE")
            items.append(d)
        return jsonify({"ok": True, "items": items})

    body = request.get_json(force=True, silent=True) or {}
    requester = str(body.get("requester") or "").strip().lower()
    if requester not in COMMISSION_APPROVERS:
        conn.close()
        return jsonify({"error": "只有授权人员可以发起佣金金额修改"}), 403

    is_react = bool(body.get("reactivate"))
    old_amount = str(body.get("old_amount") or "").strip()
    new_amount = str(body.get("new_amount") or "").strip()
    # 重新激活类申请：不携带新旧金额，跳过金额校验（req_key 加 REACTIVATE 前缀防重）
    if not is_react and (not new_amount or new_amount == old_amount):
        conn.close()
        return jsonify({"error": "请填写与原来不同的新金额"}), 400

    a1, a2 = _comm_approvers_for(requester)
    req_key = "||".join([
        "REACTIVATE" if is_react else str(body.get("contract_no") or ""),
        str(body.get("beneficiary") or ""),
        str(body.get("pay_no") or ""),
    ])
    dup = conn.execute(
        "SELECT id FROM comm_amt_requests WHERE req_key=? AND status='pending'",
        (req_key,)).fetchone()
    if dup:
        conn.close()
        return jsonify({"error": "该笔金额已有待审批的修改申请"}), 409

    conn.execute(
        "INSERT INTO comm_amt_requests (req_key, contract_no, beneficiary, pay_no,"
        " currency, old_amount, new_amount, reason, requester, approver1, approver2,"
        " status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?)",
        (req_key, str(body.get("contract_no") or ""),
         str(body.get("beneficiary") or ""), str(body.get("pay_no") or ""),
         str(body.get("currency") or ""), old_amount, new_amount,
         str(body.get("reason") or ""), requester, a1, a2, _comm_now()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "approvers": [a1, a2]})


@app.route("/api/commission/amount-requests/<int:rid>/resolve", methods=["POST"])
def api_comm_amt_resolve(rid):
    body = request.get_json(force=True, silent=True) or {}
    action = str(body.get("action") or "").strip().lower()
    resolver = str(body.get("resolver") or "").strip().lower()
    if action not in ("approve", "reject"):
        return jsonify({"error": "操作无效"}), 400

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM comm_amt_requests WHERE id=?", (rid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "审批不存在"}), 404
    if row["status"] != "pending":
        conn.close()
        return jsonify({"error": "该审批已结束"}), 409
    if resolver not in (row["approver1"], row["approver2"]):
        conn.close()
        return jsonify({"error": "你不是该笔审批的审批人"}), 403

    dec_field = "dec1" if resolver == row["approver1"] else "dec2"
    conn.execute(
        "UPDATE comm_amt_requests SET %s=? WHERE id=?" % dec_field, (action, rid))
    conn.commit()

    cur = conn.execute(
        "SELECT * FROM comm_amt_requests WHERE id=?", (rid,)).fetchone()
    status = "pending"
    decs = [cur["dec1"], cur["dec2"]]
    if "reject" in decs:
        status = "rejected"
    elif cur["dec1"] == "approve" and cur["dec2"] == "approve":
        status = "approved"   # 两人都同意 → 通过，前端据此外挂新金额

    if status != "pending":
        conn.execute(
            "UPDATE comm_amt_requests SET status=?, resolved_at=? WHERE id=?",
            (status, _comm_now(), rid))
        conn.commit()
    conn.close()
    return jsonify({
        "ok": True,
        "status": status,
        "new_amount": cur["new_amount"] if status == "approved" else None,
    })


@app.route("/api/perm-version", methods=["GET"])
def api_perm_version():
    """前端轮询：返回某用户权限版本号。版本变化即代表其 perms/role/status 已变更，
    前端据此立即刷新本地会话缓存（无需重新登录）。"""
    username = (request.args.get("username") or "").strip()
    if not username:
        return jsonify({"ok": False, "error": "missing username"})
    return jsonify({"ok": True, "username": username, "version": get_perm_version(username)})


@app.route("/api/login-history", methods=["GET"])
def get_login_history():
    """获取登录记录统计数据"""
    conn = get_db()
    # 获取每月每用户的登录次数
    monthly = conn.execute("""
        SELECT strftime('%Y-%m', login_time) as month,
               username,
               COUNT(*) as count
        FROM login_history
        GROUP BY month, username
        ORDER BY month DESC, username
    """).fetchall()
    # 获取每年每用户的登录次数
    yearly = conn.execute("""
        SELECT strftime('%Y', login_time) as year,
               username,
               COUNT(*) as count
        FROM login_history
        GROUP BY year, username
        ORDER BY year DESC, username
    """).fetchall()
    # 获取当月每用户的登录次数
    current_month = conn.execute("""
        SELECT username,
               COUNT(*) as count
        FROM login_history
        WHERE strftime('%Y-%m', login_time) = strftime('%Y-%m', 'now', 'localtime')
        GROUP BY username
        ORDER BY count DESC, username
    """).fetchall()
    # 获取当年每用户的登录次数
    current_year = conn.execute("""
        SELECT username,
               COUNT(*) as count
        FROM login_history
        WHERE strftime('%Y', login_time) = strftime('%Y', 'now', 'localtime')
        GROUP BY username
        ORDER BY count DESC, username
    """).fetchall()
    conn.close()
    return jsonify({
        "ok": True,
        "monthly": [dict(r) for r in monthly],
        "yearly": [dict(r) for r in yearly],
        "userMonthly": [dict(r) for r in current_month],
        "userYearly": [dict(r) for r in current_year]
    })

@app.route("/api/change-password", methods=["POST"])
def change_password():
    """Reset Password：校验旧密码，设置新密码"""
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    old_pw = data.get("old_password") or ""
    new_pw = data.get("new_password") or ""
    if not username:
        return jsonify({"ok": False, "error": "缺少用户名"})
    if len(new_pw) < 6:
        return jsonify({"ok": False, "error": "新密码长度至少 6 位"})
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "用户名不存在"})
    if row["password"] != old_pw:
        conn.close()
        return jsonify({"ok": False, "error": "旧密码错误"})
    conn.execute("UPDATE users SET password=? WHERE username=?", (new_pw, username))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "message": "密码修改成功"})

@app.route("/api/forget-password", methods=["POST"])
def forget_password():
    """忘记密码：不再直接重置/返回临时密码。
    流程：根据该用户配置的 forgot_approvers（忘记密码审批人，tom 默认）创建一条
    PWD-FORGET 审批请求 → 审批人待办角标 +1 → 任一审批人"通过"后，
    密码自动重置为初始密码 66668888（DEFAULT_INIT_PASSWORD）。"""
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify({"ok": False, "error": "请输入用户名"})
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "用户名不存在"})
    # 该用户的忘记密码审批人（默认 tom；空则兜底 tom + 全体管理员）
    try:
        approvers = json.loads(row["forgot_approvers"] or "[]")
    except Exception:
        approvers = []
    approvers = [a for a in approvers if a]
    if not approvers:
        approvers = ["tom"]
        try:
            for m in conn.execute("SELECT username FROM managers"):
                if m["username"] not in approvers:
                    approvers.append(m["username"])
        except Exception:
            pass
    # 防重复：同一用户已有待处理的忘记密码审批则不再新建
    dup = conn.execute(
        "SELECT id FROM approval_requests WHERE block_id='PWD-FORGET' AND target_id=? AND status='pending'",
        (username,)).fetchone()
    if dup:
        conn.close()
        return jsonify({"ok": True, "message": "already_pending", "approvers": approvers})
    real_name = row["real_name"] or username
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO approval_requests (requester, requester_name, block_id, block_name, action_name, "
        "approvers, status, created_at, persist, target_id, title, content) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (username, real_name, "PWD-FORGET", "Password Reset", "忘记密码重置",
         json.dumps(approvers, ensure_ascii=False), "pending", now, "single-use", username,
         "忘记密码重置", f"{real_name}({username}) 申请重置登录密码"))
    conn.execute("INSERT INTO password_requests (username, status, requested_at, note) VALUES (?,?,?,?)",
                 (username, "pending", now, "sent_to_approvers"))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "message": "sent_to_approvers", "approvers": approvers})

# ===================== API：项目 CRUD =====================
# ★ 调试路由：查看 API 返回的签约项目数据结构（用于诊断图表问题）
@app.route("/api/won-projects/debug", methods=["GET"])
def debug_won_projects():
    """返回签约项目数据的诊断信息：字段列表、前几条数据样本"""
    conn = get_db()
    c = conn.cursor()
    try:
        # 获取表结构
        cols = c.execute("PRAGMA table_info(won_projects)").fetchall()
        col_names = [col[1] for col in cols]
        
        # 获取数据样本
        rows = c.execute("SELECT * FROM won_projects LIMIT 3").fetchall()
        sample_data = [dict(zip(col_names, r)) for r in rows]
        
        # 签约方分布
        party_dist = {}
        for row in c.execute("SELECT signing_parties, COUNT(*) FROM won_projects GROUP BY signing_parties"):
            party_dist[row[0] or '空'] = row[1]
        
        return jsonify({
            "columns": col_names,
            "sample": sample_data,
            "signing_parties_distribution": party_dist
        })
    finally:
        conn.close()

# ★ 调试路由：强制重新生成签约项目种子数据（用于修复看板图表空白问题）
# 访问方式：GET /api/won-projects/reseed
@app.route("/api/won-projects/reseed", methods=["GET"])
def reseed_won_projects():
    """强制清除并重新插入签约项目示例数据（看板图表演示用）"""
    import os
    # 只允许本地访问
    if request.remote_addr not in ('127.0.0.1', 'localhost', '::1') and os.environ.get('FLASK_ENV') != 'development':
        return jsonify({"error": "仅允许本地访问"}), 403
    
    conn = get_db()
    c = conn.cursor()
    try:
        # 清空现有数据（谨慎操作，仅清空签约项目表）
        c.execute("DELETE FROM won_projects")
        conn.commit()
        
        # 重新插入种子数据
        seed_won_projects(c)
        conn.commit()
        
        # 验证插入结果
        count = c.execute("SELECT COUNT(*) FROM won_projects").fetchone()[0]
        bu_count = c.execute("SELECT COUNT(*) FROM won_projects WHERE signing_parties IN ('AGI-Customer', 'GS-Customer')").fetchone()[0]
        
        return jsonify({
            "ok": True,
            "message": f"已重新生成签约项目种子数据（共 {count} 条，含 AGI/GS 签约方数据 {bu_count} 条）",
            "total": count,
            "bu_projects": bu_count
        })
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

def _norm_decision(decision):
    """把任意语言的权限决策规范化为统一 key。"""
    if not decision:
        return ""
    d = str(decision).strip()
    if d in ("特别授权看全公司", "Grant Company-wide", "Cấp toàn công ty", "all", "company"):
        return "all"
    if d in ("隐藏该项", "Hide", "Ẩn mục này", "hide"):
        return "hide"
    if d in ("发起审批", "Submit approval", "Gửi phê duyệt", "Khởi tạo phê duyệt", "approve"):
        return "approve"
    return "default"


def _user_has_full_company(conn, username, block_id):
    """判断 username 是否对 block_id 拥有“特别授权看全公司”（decision=='all'）。"""
    if not username or not block_id:
        return False
    row = conn.execute("SELECT perms FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        return False
    try:
        perms = json.loads(row["perms"]) if row["perms"] else {}
    except Exception:
        return False
    if not isinstance(perms, dict):
        return False
    blk = perms.get(block_id)
    if not isinstance(blk, dict):
        return False
    return _norm_decision(blk.get("decision")) == "all"


def _visible_scope(username, block_id=None):
    """返回 (where_clause, params) 用于限制某用户可见的项目记录（独立记录）。

    - 未登录 / 管理员 / 总经理 / 副总经理：返回 ('', []) 表示看全部（向后兼容）。
    - 普通用户：若对 block_id 拥有“特别授权看全公司”(decision='all')，也看全部。
    - 其他：仅看 owner_user_id 属于“自己 + vis_he_can_see 指定人员”的记录；
      兼容旧数据（owner_user_id 为空）：退而按 salesperson 文本匹配同一组人。
    """
    if not username:
        return ("", [])
    conn = get_db()
    user = conn.execute("SELECT role, vis_he_can_see FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        conn.close()
        return ("", [])
    # 看全部：自由任命的管理员
    if _is_manager(conn, username):
        conn.close()
        return ("", [])
    # 看全部：对该区块拥有“特别授权看全公司”
    if block_id and _user_has_full_company(conn, username, block_id):
        conn.close()
        return ("", [])
    visible = [username.lower()]
    try:
        vs = json.loads(user["vis_he_can_see"]) if user["vis_he_can_see"] else []
    except Exception:
        vs = []
    # vis_he_can_see 兼容两种存储格式：
    #   1) 数字/数字串 → 用户 ID（管理界面保存），需先解析为用户名
    #   2) 用户名字符串 → 旧种子数据，直接使用
    id_list = []
    name_list = []
    for v in vs:
        s = str(v).strip()
        if not s:
            continue
        if s.isdigit():
            id_list.append(int(s))
        else:
            name_list.append(s.lower())
    if id_list:
        try:
            ph = ",".join("?" * len(id_list))
            for r in conn.execute(f"SELECT username FROM users WHERE id IN ({ph})", id_list).fetchall():
                name_list.append(str(r["username"]).strip().lower())
        except Exception:
            pass
    for n in name_list:
        if n and n not in visible:
            visible.append(n)
    # 反向授权：其他用户的 vis_can_see_me 中包含当前用户（按 ID 或用户名）→ 其数据对当前用户可见
    try:
        me = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        my_id = me["id"] if me else None
        for r in conn.execute(
            "SELECT username, vis_can_see_me FROM users WHERE username<>? AND vis_can_see_me IS NOT NULL AND vis_can_see_me<>'' AND vis_can_see_me<>'[]'",
            (username,)
        ).fetchall():
            try:
                arr = json.loads(r["vis_can_see_me"]) if r["vis_can_see_me"] else []
            except Exception:
                arr = []
            hit = False
            for v in arr:
                s = str(v).strip()
                if not s:
                    continue
                if s.isdigit():
                    if my_id is not None and int(s) == my_id:
                        hit = True
                        break
                elif s.lower() == username.lower():
                    hit = True
                    break
            if hit:
                u2 = str(r["username"]).strip().lower()
                if u2 and u2 not in visible:
                    visible.append(u2)
    except Exception:
        pass
    # 离职代理：当前用户是被代理人的 delegate_to 时，自动可见离职/停用人员名下的数据
    try:
        delegated = conn.execute(
            "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username<>?",
            (username, username)
        ).fetchall()
        for d in delegated:
            visible.append(str(d["username"]).strip().lower())
    except Exception:
        pass
    conn.close()
    ph = ",".join("?" * len(visible))
    # owner_user_id（录入人）或 salesperson（实际销售）任一命中可见集合即可见，
    # 这样正向/反向授权看某人数据时，其作为销售员的记录也能被正确纳入。
    # 两个分支都必须 lower：owner_user_id / salesperson 实际存的是用户名字符串，
    # 存量数据大小写混杂（如 'Khoa'），不 lower 会导致“自己的行不可见”
    clause = f"lower(owner_user_id) IN ({ph}) OR lower(salesperson) IN ({ph})"
    return (clause, visible + visible)


def _owns_row(table, pid, username):
    """后端写操作真实拦截：写权限仅限行归属者本人（防止通过数据范围授权越权修改他人数据）。

    - 数据范围授权（vis_he_can_see / vis_can_see_me）只授予“查看”权，不授予“写”权；
      被授权人只能读，不能修改/删除他人数据，他人数据也不会被其修改。
    - 管理员（总经理/副总经理/自由任命管理员）豁免，可写全部。
    - 未带 X-User-Name（如自动化/老调用）视为有权，向后兼容。
    返回 True 表示允许写。
    """
    if not username:
        return True
    conn = get_db()
    try:
        if _is_manager(conn, username):
            return True
        row = conn.execute(f"SELECT owner_user_id, salesperson FROM {table} WHERE id=?", (pid,)).fetchone()
        if not row:
            return False
        me = username.strip().lower()
        owner = (row["owner_user_id"] or "").strip().lower()
        if owner:
            return owner == me
        # 兼容旧数据：owner 为空时按 salesperson 文本匹配本人
        sp = (row["salesperson"] or "").strip().lower()
        return sp == me
    finally:
        conn.close()


def _perm_gate(conn, username, bid, target_id=None):
    """服务端权限闸门（无条件强制）：所有写操作按该用户权限决策在服务端校验。

    规则（对任意用户无条件生效，与浏览器状态/前端代码无关）：
    - hide（隐藏该项）          → 403 拒绝
    - approve（发起审批）       → 必须存在"该用户对该 bid+target 的已通过单次审批"（未消耗）；
                                  放行同时标记 consumed=1（一次审批只能执行一次操作）
    - default/company（保留默认/特别授权）→ 放行
    - 管理员豁免；未带 X-User-Name 放行（向后兼容自动化/脚本）
    返回 None=放行；返回 (jsonify元组)=拒绝响应。
    """
    if not username:
        return None
    try:
        if _is_manager(conn, username):
            return None
    except Exception:
        pass
    try:
        row = conn.execute("SELECT perms FROM users WHERE username=?", (username,)).fetchone()
    except Exception:
        return None
    if not row or not row["perms"]:
        return None
    try:
        p = json.loads(row["perms"])
        dec = ((p.get(bid) or {}).get("decision") or "").strip().lower()
    except Exception:
        return None
    if not dec or dec in ("default", "company"):
        return None
    if dec == "hide":
        return (jsonify({"error": "forbidden_hidden", "message": "无权限：该模块已被隐藏"}), 403)
    if dec == "approve":
        tid = str(target_id if target_id is not None else "")
        g = conn.execute(
            "SELECT id FROM approval_requests WHERE requester=? AND block_id=? AND target_id=? "
            "AND status='approved' AND persist='single-use' AND COALESCE(consumed,0)=0 "
            "ORDER BY id DESC LIMIT 1",
            (username, bid, tid)).fetchone()
        if not g:
            return (jsonify({"error": "approval_required",
                             "message": "该操作需审批人通过后才能执行"}), 403)
        conn.execute("UPDATE approval_requests SET consumed=1 WHERE id=?", (g["id"],))
        return None
    return None


# ===================== WON-P345：签约项目 P3/P4/P5 列权限 =====================
# 隐藏时服务端直接剥离这些字段（列表+详情），任何客户端手段都拿不到
WON_P345_KEYS = (
    "gs_comm_pct", "gs_comm_rmb", "gs_comm_usd", "gs_comm_vnd",
    "gs_pay_count", "gs_paid_rmb", "gs_paid_usd", "gs_paid_vnd",
    "gs_unpaid_rmb", "gs_unpaid_usd", "gs_unpaid_vnd", "gs_remark",
    "agi_payable_rmb", "agi_payable_usd", "agi_payable_vnd",
    "agi_pay_count", "agi_paid_rmb", "agi_paid_usd", "agi_paid_vnd",
    "agi_unpaid_rmb", "agi_unpaid_usd", "agi_unpaid_vnd", "agi_remark",
    "doc_equip", "doc_install", "doc_both", "doc_addendum_cnt", "doc_remark",
    # ★ 三语备注列同步纳入 P345 剥离
    "gs_remark_zh", "gs_remark_en", "gs_remark_vi",
    "agi_remark_zh", "agi_remark_en", "agi_remark_vi",
)

def _won_p345_hidden(conn, username):
    """P3/P4/P5 列隐藏判定：显式决策优先；未配置时销售/销售总监职位默认隐藏。"""
    if not username:
        return False
    try:
        row = conn.execute("SELECT perms, position FROM users WHERE username=?", (username,)).fetchone()
        if not row:
            return False
        try:
            p = json.loads(row["perms"] or "{}")
            dec = ((p.get("WON-P345") or {}).get("decision") or "").strip().lower()
        except Exception:
            dec = ""
        if dec:
            return dec == "hide"
        pos = (row["position"] or "").strip()
        return pos in ("销售", "销售总监", "观察者")   # 观察者职位缺省隐藏（预设值，配置后按配置）
    except Exception:
        return False

def _strip_won_p345(rows):
    for d in rows:
        for k in WON_P345_KEYS:
            d.pop(k, None)
    return rows


# ★ 三语备注 / 付款方式 JSON 展开：本机后端复刻云端 wonlost.js 行为，
# 让桌面版也能像网页版一样正确显示中文/英文/越南文。
_WON_RM_BASES = ["cust_remark", "gs_remark", "agi_remark"]

def _expand_won_remarks(row):
    if not row:
        return row
    for b in _WON_RM_BASES:
        obj = None
        try:
            obj = json.loads(row[b]) if row.get(b) else None
        except Exception:
            obj = None
        if obj and isinstance(obj, dict):
            row[b + "_zh"] = obj.get("zh") or ""
            row[b + "_en"] = obj.get("en") or ""
            row[b + "_vi"] = obj.get("vi") or ""
        else:
            old = str(row[b]) if row.get(b) is not None else ""
            row[b + "_zh"] = old
            row[b + "_en"] = ""
            row[b + "_vi"] = ""
    return row

def _expand_payment_terms(row):
    if not row:
        return row
    raw = str(row.get("payment_terms") or "")
    obj = None
    if raw.strip().startswith("{"):
        try:
            obj = json.loads(raw)
        except Exception:
            obj = None
    if obj and isinstance(obj, dict):
        row["payment_terms_zh"] = obj.get("zh") or ""
        row["payment_terms_en"] = obj.get("en") or ""
        row["payment_terms_vi"] = obj.get("vi") or ""
    else:
        row["payment_terms_zh"] = raw
        row["payment_terms_en"] = raw
        row["payment_terms_vi"] = raw
    return row


def _expand_won_row(row):
    _expand_won_remarks(row)
    _expand_payment_terms(row)
    return row


@app.route("/api/won-projects", methods=["GET"])
def list_projects():
    conn = get_db()
    uname = request.headers.get("X-User-Name")
    clause, params = _visible_scope(uname, "WON-L1")
    sql = "SELECT * FROM won_projects WHERE lower(salesperson) <> 'agi-gs internal'"
    if clause:
        sql += " AND (" + clause + ")"
    sql += " ORDER BY id DESC"
    rows = conn.execute(sql, params).fetchall()
    out = [row_to_dict(r) for r in rows]
    for d in out:
        _expand_won_row(d)
    # WON-P345 权限闸门（服务端硬剥离）：隐藏决策/销售缺省 → 剥掉 P3/P4/P5 全部字段，
    # 浏览器、接口直调、任何客户端手段都拿不到这些数据
    if _won_p345_hidden(conn, uname):
        _strip_won_p345(out)
    conn.close()
    return jsonify(out)

@app.route("/api/won-projects", methods=["POST"])
def create_project():
    data = request.get_json(force=True, silent=True) or {}
    fields = [
        "contract_no","customer","province","contract_date","signing_parties","contract_currency",
        "rate_rmb_vnd","rate_usd_vnd","incoterm","include_install","payment_terms","payment_terms_zh","payment_terms_en","payment_terms_vi","salesperson",
        "equip_rmb","equip_usd","equip_vnd","superv_rmb","superv_usd","superv_vnd",
        "fb_budget_rmb","fb_budget_usd","fb_budget_vnd","fb_actual_rmb","fb_actual_usd","fb_actual_vnd",
        "cc_budget_rmb","cc_budget_usd","cc_budget_vnd","cc_actual_rmb","cc_actual_usd","cc_actual_vnd",
        "total_equip_rmb","total_equip_usd","total_equip_vnd",
        "inst_budget_rmb","inst_budget_usd","inst_budget_vnd","inst_actual_rmb","inst_actual_usd","inst_actual_vnd",
        "total_ei_rmb","total_ei_usd","total_ei_vnd",
        # ★ 新增：增值税&关税&其他费用调节平衡输入
        "vat_rmb","vat_usd","vat_vnd",
        # ★ 新增：质保金信息
        "warranty_rmb","warranty_usd","warranty_vnd","warranty_start","warranty_end",
        "cust_pay_count","cust_paid_rmb","cust_paid_usd","cust_paid_vnd",
        "cust_unpaid_rmb","cust_unpaid_usd","cust_unpaid_vnd","cust_remark",
        "gs_comm_pct","gs_comm_rmb","gs_comm_usd","gs_comm_vnd",
        "gs_pay_count","gs_paid_rmb","gs_paid_usd","gs_paid_vnd",
        "gs_unpaid_rmb","gs_unpaid_usd","gs_unpaid_vnd","gs_remark",
        "agi_payable_rmb","agi_payable_usd","agi_payable_vnd",
        "agi_pay_count","agi_paid_rmb","agi_paid_usd","agi_paid_vnd",
        "agi_unpaid_rmb","agi_unpaid_usd","agi_unpaid_vnd","agi_remark",
        "doc_equip","doc_install","doc_both","doc_addendum_cnt","doc_remark",
        # ★ 三语备注列
        "cust_remark_zh","cust_remark_en","cust_remark_vi",
        "gs_remark_zh","gs_remark_en","gs_remark_vi",
        "agi_remark_zh","agi_remark_en","agi_remark_vi"
    ]
    cols = []
    vals = []
    for f in fields:
        if f in data:
            cols.append(f)
            v = data[f]
            if f.startswith(("equip_","superv_","fb_","cc_","inst_","total_","cust_","gs_","agi_","vat_","doc_")) and f not in ("cust_remark","gs_remark","gs_comm_pct","agi_remark","doc_remark","doc_equip","doc_install","doc_both","cust_remark_zh","cust_remark_en","cust_remark_vi","gs_remark_zh","gs_remark_en","gs_remark_vi","agi_remark_zh","agi_remark_en","agi_remark_vi"):
                try:
                    v = int(v or 0)
                except:
                    v = 0
            vals.append(v)
    cols += ["attachments","supp_summary","cust_view_detail","gs_view_detail"]
    vals += [
        json.dumps(data.get("attachments") or [], ensure_ascii=False),
        json.dumps(data.get("supp_summary") or [], ensure_ascii=False),
        json.dumps(data.get("cust_view_detail") or [], ensure_ascii=False),
        json.dumps(data.get("gs_view_detail") or [], ensure_ascii=False)
    ]
    # 独立记录：记录归属人 = 当前登录用户（前端通过 X-User-Name 头传递）
    cols.append("owner_user_id")
    vals.append((request.headers.get("X-User-Name") or "").strip().lower())
    # AGI 明细 & 补充协议：字符串原样存储（与前端文本框值一致）
    for k in ("agi_view_detail", "doc_view_addendum"):
        if data.get(k) is not None:
            cols.append(k)
            vals.append(data.get(k))
    sql = f"INSERT INTO won_projects ({','.join(cols)}) VALUES ({','.join(['?']*len(vals))})"
    conn = get_db()
    cur = conn.execute(sql, vals)
    new_id = cur.lastrowid
    conn.execute("UPDATE won_projects SET updated_at=datetime('now','localtime') WHERE id=?", (new_id,))
    row = conn.execute("SELECT * FROM won_projects WHERE id=?", (new_id,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(row)), 201

@app.route("/api/won-projects/<int:pid>", methods=["GET"])
def get_project(pid):
    conn = get_db()
    uname = request.headers.get("X-User-Name")
    row = conn.execute("SELECT * FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}), 404
    d = row_to_dict(row)
    _expand_won_row(d)
    if _won_p345_hidden(conn, uname):
        _strip_won_p345([d])
    conn.close()
    return jsonify(d)

@app.route("/api/won-projects/<int:pid>", methods=["PUT"])
def update_project(pid):
    data = request.get_json(force=True, silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT id FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    # 后端真实拦截：仅记录所有者/被授权可见者可读写
    if not _owns_row("won_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    fields = [
        "contract_no","customer","province","contract_date","signing_parties","contract_currency",
        "rate_rmb_vnd","rate_usd_vnd","incoterm","include_install","payment_terms","payment_terms_zh","payment_terms_en","payment_terms_vi","salesperson",
        "equip_rmb","equip_usd","equip_vnd","superv_rmb","superv_usd","superv_vnd",
        "fb_budget_rmb","fb_budget_usd","fb_budget_vnd","fb_actual_rmb","fb_actual_usd","fb_actual_vnd",
        "cc_budget_rmb","cc_budget_usd","cc_budget_vnd","cc_actual_rmb","cc_actual_usd","cc_actual_vnd",
        "total_equip_rmb","total_equip_usd","total_equip_vnd",
        "inst_budget_rmb","inst_budget_usd","inst_budget_vnd","inst_actual_rmb","inst_actual_usd","inst_actual_vnd",
        "total_ei_rmb","total_ei_usd","total_ei_vnd",
        # ★ 新增：增值税&关税&其他费用调节平衡输入
        "vat_rmb","vat_usd","vat_vnd",
        # ★ 新增：质保金信息
        "warranty_rmb","warranty_usd","warranty_vnd","warranty_start","warranty_end",
        "cust_pay_count","cust_paid_rmb","cust_paid_usd","cust_paid_vnd",
        "cust_unpaid_rmb","cust_unpaid_usd","cust_unpaid_vnd","cust_remark",
        "gs_comm_pct","gs_comm_rmb","gs_comm_usd","gs_comm_vnd",
        "gs_pay_count","gs_paid_rmb","gs_paid_usd","gs_paid_vnd",
        "gs_unpaid_rmb","gs_unpaid_usd","gs_unpaid_vnd","gs_remark",
        "agi_payable_rmb","agi_payable_usd","agi_payable_vnd",
        "agi_pay_count","agi_paid_rmb","agi_paid_usd","agi_paid_vnd",
        "agi_unpaid_rmb","agi_unpaid_usd","agi_unpaid_vnd","agi_remark",
        "doc_equip","doc_install","doc_both","doc_addendum_cnt","doc_remark",
        # ★ 三语备注列
        "cust_remark_zh","cust_remark_en","cust_remark_vi",
        "gs_remark_zh","gs_remark_en","gs_remark_vi",
        "agi_remark_zh","agi_remark_en","agi_remark_vi"
    ]
    sets = []
    vals = []
    for f in fields:
        if f in data:
            sets.append(f"{f}=?")
            v = data[f]
            if f.startswith(("equip_","superv_","fb_","cc_","inst_","total_","cust_","gs_","agi_","vat_","doc_")) and f not in ("cust_remark","gs_remark","gs_comm_pct","agi_remark","doc_remark","doc_equip","doc_install","doc_both","cust_remark_zh","cust_remark_en","cust_remark_vi","gs_remark_zh","gs_remark_en","gs_remark_vi","agi_remark_zh","agi_remark_en","agi_remark_vi"):
                try:
                    v = int(v or 0)
                except:
                    v = 0
            vals.append(v)
    for k in ("attachments","supp_summary","cust_view_detail","gs_view_detail","agi_view_detail","doc_view_addendum"):
        if k in data:
            sets.append(f"{k}=?")
            vals.append(json.dumps(data[k], ensure_ascii=False) if isinstance(data[k], (list,dict)) else (data[k] or ""))
    if sets:
        sets.append("updated_at=datetime('now','localtime')")
        vals.append(pid)
        conn.execute(f"UPDATE won_projects SET {', '.join(sets)} WHERE id=?", vals)
    row = conn.execute("SELECT * FROM won_projects WHERE id=?", (pid,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(row))

def _rm_upload_file(name):
    """安全删除 uploads/ 目录下的一个文件（删记录时捆绑清理，维护磁盘空间）。

    兼容三种取值：纯文件名 / 含 uploads/ 的 URL / 空值。
    只按 basename 处理且仅作用于 UPLOAD_DIR 内，绝不误删目录外的文件；文件不存在时静默跳过。
    """
    if not name:
        return
    s = str(name).strip()
    if "uploads/" in s:
        s = s.split("uploads/")[-1]
    s = os.path.basename(s.strip())
    if not s:
        return
    try:
        os.remove(os.path.join(UPLOAD_DIR, s))
    except OSError:
        pass


def _rm_upload_files(*names):
    """批量安全删除 uploads/ 文件（值可为空/URL/文件名，逐个容错）。"""
    for n in names:
        _rm_upload_file(n)


# ===================== 彻底删除（Purge）工具 =====================
# 与云端 cloudflare/src/purge.js 对称：
# 本地数据库同样没有外键、没开 PRAGMA foreign_keys，删记录时
# 必须手写级联，否则审批单 / 佣金记录 / 磁盘文件都会残留。
#
# 设计原则：
#   1) 引用计数安全删除：同一个文件若仍被其它记录引用则不删
#      （"CRM 转失败"后 CRM 与 LOST 共享同一批 pdf 值，删一边不能弄坏另一边）
#   2) 全级联：磁盘文件 + 审批单 + 佣金记录，一次删干净
# =====================

def _norm_file_ref(v):
    """把 文件名 / uploads/xxx URL / 空值 统一成纯文件名，无法解析返回 ''。"""
    s = str(v or "").strip()
    if not s:
        return ""
    if "uploads/" in s:
        s = s.split("uploads/")[-1]
    return os.path.basename(s.strip())


def _row_file_refs(table, row):
    """从一条记录里取出它引用的所有文件名。"""
    out = []
    if not row:
        return out
    try:
        if table == "won_projects":
            atts = json.loads(row["attachments"]) if row["attachments"] else []
            for a in atts or []:
                n = _norm_file_ref((a or {}).get("filename") or (a or {}).get("url"))
                if n:
                    out.append(n)
            # ★ V45/V52：WON 合同/安装合同 PDF 也存成 uploads/ 下的纯文件名，
            # 必须纳入引用集，否则 purge-orphans 会误删真实合同附件。
            for f in ("doc_equip", "doc_install", "doc_both"):
                n = _norm_file_ref(row[f])
                if n:
                    out.append(n)
            return out
        for f in ("pdf_equip", "pdf_install", "pdf_both"):
            n = _norm_file_ref(row[f])
            if n:
                out.append(n)
    except Exception:
        pass
    return out


def _collect_referenced_files(conn):
    """收集整个数据库里被引用的所有文件名（用于孤儿扫描 + 安全删除）。"""
    refs = set()
    for t in ("crm_projects", "lost_projects", "won_projects"):
        try:
            if t == "won_projects":
                rows = conn.execute(
                    "SELECT attachments, doc_equip, doc_install, doc_both FROM won_projects"
                ).fetchall()
                for r in rows:
                    refs.update(_row_file_refs("won_projects", r))
            else:
                rows = conn.execute(
                    "SELECT pdf_equip, pdf_install, pdf_both FROM %s" % t
                ).fetchall()
                for r in rows:
                    refs.update(_row_file_refs(t, r))
        except Exception:
            continue
    return refs


def _rm_files_if_orphan(conn, names, exclude_table=None, exclude_id=None):
    """引用计数安全删除：只删没有任何其它记录引用的文件。

    返回 (deleted, kept) 数量。
    """
    refs = _collect_referenced_files(conn)
    # 排除"正在被删除的这条记录"自身的引用
    if exclude_table and exclude_id is not None:
        try:
            row = conn.execute(
                "SELECT * FROM %s WHERE id=?" % exclude_table, (exclude_id,)
            ).fetchone()
            for k in _row_file_refs(exclude_table, row):
                refs.discard(k)
        except Exception:
            pass
    deleted = kept = 0
    for n in names or []:
        fn = _norm_file_ref(n)
        if not fn:
            continue
        if fn in refs:
            kept += 1
            continue
        try:
            os.remove(os.path.join(UPLOAD_DIR, fn))
            deleted += 1
        except OSError:
            pass
    return deleted, kept


def _purge_approvals(conn, block_prefix, pid):
    """删除指向该记录的审批单（target_id 存记录 id，block_id 形如 CRM-D3）。"""
    try:
        cur = conn.execute(
            "DELETE FROM approval_requests WHERE block_id LIKE ? AND target_id=?",
            (block_prefix + "%", str(pid)),
        )
        return cur.rowcount or 0
    except Exception:
        return 0


def _purge_commission(conn, contract_no):
    """按合同号删除佣金记录（主表 + 受益人表）。"""
    if not contract_no:
        return 0, 0
    try:
        ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM commission_records WHERE contract=?", (contract_no,)
            ).fetchall()
        ]
        if not ids:
            return 0, 0
        ph = ",".join("?" * len(ids))
        b = conn.execute(
            "DELETE FROM commission_beneficiaries WHERE record_id IN (%s)" % ph, ids
        ).rowcount or 0
        r = conn.execute(
            "DELETE FROM commission_records WHERE id IN (%s)" % ph, ids
        ).rowcount or 0
        return r, b
    except Exception:
        return 0, 0


def _cleanup_replaced_pdf(old_val, new_name):
    """替换上传后删除旧文件：old_val 为该槽位原文件名/URL，与新文件同名则跳过。"""
    if not old_val:
        return
    old = str(old_val).strip()
    if "uploads/" in old:
        old = old.split("uploads/")[-1].strip()
    old = os.path.basename(old)
    if old and old != new_name:
        _rm_upload_file(old)


@app.route("/api/won-projects/<int:pid>", methods=["DELETE"])
def delete_project(pid):
    conn = get_db()
    row = conn.execute("SELECT attachments FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    # 后端真实拦截
    if not _owns_row("won_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    # 彻底删除：磁盘附件 + 审批单(WON-*) + 佣金记录(按合同号) → 主记录
    full = conn.execute(
        "SELECT attachments, contract_no FROM won_projects WHERE id=?", (pid,)
    ).fetchone()
    try:
        atts = json.loads(full["attachments"]) if full and full["attachments"] else []
    except Exception:
        atts = []
    contract_no = (full["contract_no"] if full else "") or ""
    deleted, kept = _rm_files_if_orphan(
        conn, [a.get("filename") for a in atts],
        exclude_table="won_projects", exclude_id=pid,
    )
    approvals = _purge_approvals(conn, "WON-", pid)
    comm_rec, comm_ben = _purge_commission(conn, contract_no)
    conn.execute("DELETE FROM won_projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "purge": {
        "files_deleted": deleted, "files_kept": kept,
        "approvals_deleted": approvals,
        "commission_records": comm_rec, "commission_beneficiaries": comm_ben,
    }})

# ===================== API：CRM（报价/跟进） CRUD =====================
CRM_FIELDS = [
    "quote_no","project_name","province","customer","bu","construction",
    "startup_pct","sign_pct","manager","manager_phone","company_info",
    "initial_quote_date","est_purchase_date","est_ship_date","quote_version",
    "last_quote_date","rate_rmb_vnd","rate_usd_vnd","incoterm",
    "install_quoted","salesperson","remark","pdf_equip","pdf_install","pdf_both",
    "remark_zh","remark_en","remark_vi",
    "q1_rmb","q1_usd","q1_vnd",
    "q2_rmb","q2_usd","q2_vnd",
    "q3_rmb","q3_usd","q3_vnd",
    "q4_rmb","q4_usd","q4_vnd",
    "q5_rmb","q5_usd","q5_vnd",
    "q6_rmb","q6_usd","q6_vnd",
    "q7_rmb","q7_usd","q7_vnd",
]
CRM_NUM_FIELDS = set([
    "q1_rmb","q1_usd","q1_vnd","q2_rmb","q2_usd","q2_vnd",
    "q3_rmb","q3_usd","q3_vnd","q4_rmb","q4_usd","q4_vnd",
    "q5_rmb","q5_usd","q5_vnd","q6_rmb","q6_usd","q6_vnd",
    "q7_rmb","q7_usd","q7_vnd",
])

@app.route("/api/crm-projects", methods=["GET"])
def list_crm_projects():
    conn = get_db()
    # 只返回潜在项目（active），已转到“失败项目”的不再展示
    base = "status='active' OR status IS NULL OR status=''"
    scope = (request.args.get("scope") or "").strip()
    username = request.headers.get("X-User-Name")
    # scope=all 表示前端显式请求“全公司”数据（看板图表/概况弹窗使用）；
    # 否则按用户可见范围，若该用户拥有 CRM-L1 “特别授权看全公司”也看全部
    if scope == "all":
        clause, params = ("", [])
    else:
        clause, params = _visible_scope(username, "CRM-L1")
    sql = ("SELECT * FROM crm_projects WHERE (%s) AND lower(salesperson) <> 'agi-gs internal'" % base)
    if clause:
        sql += " AND (%s)" % clause
    sql += " ORDER BY id ASC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return jsonify([row_to_dict(r) for r in rows])

@app.route("/api/crm-projects", methods=["POST"])
def create_crm_project():
    data = request.get_json(force=True, silent=True) or {}
    cols = []
    vals = []
    for f in CRM_FIELDS:
        if f in data:
            cols.append(f)
            v = data[f]
            if f in CRM_NUM_FIELDS:
                try:
                    v = int(v or 0)
                except:
                    v = 0
            vals.append(v)
    # 独立记录：记录归属人 = 当前登录用户（前端通过 X-User-Name 头传递）
    cols.append("owner_user_id")
    vals.append((request.headers.get("X-User-Name") or "").strip().lower())
    sql = f"INSERT INTO crm_projects ({','.join(cols)}) VALUES ({','.join(['?']*len(vals))})"
    conn = get_db()
    cur = conn.execute(sql, vals)
    new_id = cur.lastrowid
    conn.execute("UPDATE crm_projects SET updated_at=datetime('now','localtime') WHERE id=?", (new_id,))
    row = conn.execute("SELECT * FROM crm_projects WHERE id=?", (new_id,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(row)), 201

@app.route("/api/crm-projects/<int:pid>", methods=["GET"])
def get_crm_project(pid):
    conn = get_db()
    row = conn.execute("SELECT * FROM crm_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error":"not found"}), 404
    return jsonify(row_to_dict(row))

@app.route("/api/crm-projects/<int:pid>", methods=["PUT"])
def update_crm_project(pid):
    data = request.get_json(force=True, silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT id FROM crm_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    if not _owns_row("crm_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    gerr = _perm_gate(conn, request.headers.get("X-User-Name"), "CRM-D2", str(pid))
    if gerr:
        conn.commit(); conn.close()
        return gerr
    sets = []
    vals = []
    for f in CRM_FIELDS:
        if f in data:
            sets.append(f"{f}=?")
            v = data[f]
            if f in CRM_NUM_FIELDS:
                try:
                    v = int(v or 0)
                except:
                    v = 0
            vals.append(v)
    if sets:
        sets.append("updated_at=datetime('now','localtime')")
        vals.append(pid)
        conn.execute(f"UPDATE crm_projects SET {', '.join(sets)} WHERE id=?", vals)
    row = conn.execute("SELECT * FROM crm_projects WHERE id=?", (pid,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(row))

@app.route("/api/crm-projects/<int:pid>", methods=["DELETE"])
def delete_crm_project(pid):
    conn = get_db()
    # 先取出文件引用（pdf_* 存的是 uploads/ 里的文件名），删记录时捆绑清理磁盘文件
    row = conn.execute("SELECT id, pdf_equip, pdf_install, pdf_both FROM crm_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    if not _owns_row("crm_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    gerr = _perm_gate(conn, request.headers.get("X-User-Name"), "CRM-D3", str(pid))
    if gerr:
        conn.commit(); conn.close()
        return gerr
    # 彻底删除：磁盘附件 + 审批单(CRM-*) → 主记录
    # 引用计数安全删除：CRM 转失败后 CRM 与 LOST 共享同一批 pdf 值，
    # 只要 LOST 那边还在引用，文件就不能删，否则 LOST 的附件会变死链。
    deleted, kept = _rm_files_if_orphan(
        conn,
        [row["pdf_equip"], row["pdf_install"], row["pdf_both"]],
        exclude_table="crm_projects", exclude_id=pid,
    )
    approvals = _purge_approvals(conn, "CRM-", pid)
    conn.execute("DELETE FROM crm_projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "purge": {
        "files_deleted": deleted, "files_kept": kept, "approvals_deleted": approvals,
    }})

@app.route("/api/crm-projects/<int:pid>/failed", methods=["POST"])
def move_crm_project_to_failed(pid):
    """将潜在项目转到失败项目（状态置为 failed，同时在 lost_projects 创建记录）。"""
    conn = get_db()
    row = conn.execute("SELECT id FROM crm_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    if not _owns_row("crm_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    gerr = _perm_gate(conn, request.headers.get("X-User-Name"), "CRM-F1", str(pid))
    if gerr:
        conn.commit(); conn.close()
        return gerr
    # 获取 CRM 完整记录，按列名映射（避免两张表列顺序不同导致错位）
    crm_row = conn.execute("SELECT * FROM crm_projects WHERE id=?", (pid,)).fetchone()
    crm_cols = [d[1] for d in conn.execute("PRAGMA table_info(crm_projects)").fetchall()]
    crm_dict = dict(zip(crm_cols, crm_row))
    # 获取 lost_projects 表的列顺序
    lost_cols = [d[1] for d in conn.execute("PRAGMA table_info(lost_projects)").fetchall()]
    fail_reason = request.json.get("fail_reason","") if request.is_json else ""
    insert_vals = []
    for col in lost_cols:
        if col in ("id", "created_at", "updated_at"):   # DB 自动生成
            insert_vals.append(None)
        elif col == "fail_reason":                      # 用户选择的失败原因
            insert_vals.append(fail_reason)
        elif col == "fail_date":                        # 当前日期
            insert_vals.append(datetime.now().strftime("%Y-%m-%d"))
        elif col == "status":                           # 状态置为 failed
            insert_vals.append("failed")
        else:                                           # 其余字段按列名一一对应
            insert_vals.append(crm_dict.get(col, None))
    conn.execute(f"INSERT INTO lost_projects ({','.join(lost_cols)}) VALUES ({','.join(['?']*len(lost_cols))})", insert_vals)
    conn.execute("UPDATE crm_projects SET status='failed', updated_at=datetime('now','localtime') WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"ok":True})

# ===================== API：失败项目（Lost） CRUD =====================
LOST_FIELDS = CRM_FIELDS + ["fail_reason", "fail_date"]
LOST_NUM_FIELDS = set(CRM_NUM_FIELDS)

@app.route("/api/lost-projects", methods=["GET"])
def list_lost_projects():
    conn = get_db()
    clause, params = _visible_scope(request.headers.get("X-User-Name"), "LOST-L1")
    sql = "SELECT * FROM lost_projects WHERE lower(salesperson) <> 'agi-gs internal'"
    if clause:
        sql += " AND (" + clause + ")"
    sql += " ORDER BY id ASC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return jsonify([row_to_dict(r) for r in rows])

@app.route("/api/lost-projects", methods=["POST"])
def create_lost_project():
    data = request.get_json(force=True, silent=True) or {}
    cols = []
    vals = []
    for f in LOST_FIELDS:
        if f in data:
            cols.append(f)
            v = data[f]
            if f in LOST_NUM_FIELDS:
                try:
                    v = int(v or 0)
                except:
                    v = 0
            vals.append(v)
    sql = f"INSERT INTO lost_projects ({','.join(cols)}) VALUES ({','.join(['?']*len(vals))})"
    conn = get_db()
    cur = conn.execute(sql, vals)
    new_id = cur.lastrowid
    conn.execute("UPDATE lost_projects SET updated_at=datetime('now','localtime') WHERE id=?", (new_id,))
    row = conn.execute("SELECT * FROM lost_projects WHERE id=?", (new_id,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(row)), 201

@app.route("/api/lost-projects/<int:pid>", methods=["GET"])
def get_lost_project(pid):
    conn = get_db()
    row = conn.execute("SELECT * FROM lost_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error":"not found"}), 404
    return jsonify(row_to_dict(row))

@app.route("/api/lost-projects/<int:pid>", methods=["PUT"])
def update_lost_project(pid):
    data = request.get_json(force=True, silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT id FROM lost_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    if not _owns_row("lost_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    gerr = _perm_gate(conn, request.headers.get("X-User-Name"), "LOST-D2", str(pid))
    if gerr:
        conn.commit(); conn.close()
        return gerr
    sets = []
    vals = []
    for f in LOST_FIELDS:
        if f in data:
            sets.append(f"{f}=?")
            v = data[f]
            if f in LOST_NUM_FIELDS:
                try:
                    v = int(v or 0)
                except:
                    v = 0
            vals.append(v)
    if sets:
        sets.append("updated_at=datetime('now','localtime')")
        vals.append(pid)
        conn.execute(f"UPDATE lost_projects SET {', '.join(sets)} WHERE id=?", vals)
    row = conn.execute("SELECT * FROM lost_projects WHERE id=?", (pid,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(row))

@app.route("/api/lost-projects/<int:pid>", methods=["DELETE"])
def delete_lost_project(pid):
    conn = get_db()
    # 先取出文件引用（pdf_* 存的是 uploads/ 里的文件名），删记录时捆绑清理磁盘文件
    row = conn.execute("SELECT id, pdf_equip, pdf_install, pdf_both FROM lost_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    if not _owns_row("lost_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    gerr = _perm_gate(conn, request.headers.get("X-User-Name"), "LOST-D3", str(pid))
    if gerr:
        conn.commit(); conn.close()
        return gerr
    # 彻底删除：磁盘附件 + 审批单(LOST-*) → 主记录（同样用引用计数安全删除）
    deleted, kept = _rm_files_if_orphan(
        conn,
        [row["pdf_equip"], row["pdf_install"], row["pdf_both"]],
        exclude_table="lost_projects", exclude_id=pid,
    )
    approvals = _purge_approvals(conn, "LOST-", pid)
    conn.execute("DELETE FROM lost_projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "purge": {
        "files_deleted": deleted, "files_kept": kept, "approvals_deleted": approvals,
    }})

@app.route("/api/lost-projects/<int:pid>/restore", methods=["POST"])
def restore_lost_project(pid):
    """将失败项目转回为潜在项目：从 lost_projects 移回 crm_projects(status='active')。"""
    conn = get_db()
    row = conn.execute("SELECT * FROM lost_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    if not _owns_row("lost_projects", pid, request.headers.get("X-User-Name")):
        conn.close()
        return jsonify({"error":"forbidden"}), 403
    gerr = _perm_gate(conn, request.headers.get("X-User-Name"), "LOST-R1", str(pid))
    if gerr:
        conn.commit(); conn.close()
        return gerr
    d = row_to_dict(row)
    cols = list(CRM_FIELDS)  # 业务字段，不含 status / fail_reason / fail_date
    # ★ 归属人随流转保留：LOST 行 owner 来自当初 CRM 转失败时保留的归属，
    #   转回潜在必须延续同一归属人，不得留空（否则退化为按 salesperson 匹配，
    #   三模块数据授权链在 LOST→CRM 处断裂）。
    _owner = (row["owner_user_id"] or "").strip().lower() if row["owner_user_id"] else ""
    if not _owner:
        _owner = (request.headers.get("X-User-Name") or "").strip().lower()
    cols.append("owner_user_id")
    vals = [d.get(c, "") if c not in CRM_NUM_FIELDS else int(d.get(c) or 0) for c in CRM_FIELDS]
    vals.append(_owner)
    placeholders = ",".join(["?"] * len(cols))
    conn.execute(
        f"INSERT INTO crm_projects ({','.join(cols)}, status) VALUES ({placeholders}, 'active')",
        vals,
    )
    conn.execute("DELETE FROM lost_projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

# 失败项目报价单 PDF 上传（与 CRM 报价单文档同机制）
@app.route("/api/lost-projects/<int:pid>/documents", methods=["POST"])
def upload_lost_pdf(pid):
    if "file" not in request.files:
        return jsonify({"error":"no file"}),400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error":"empty filename"}),400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext != ".pdf":
        return jsonify({"error":"invalid pdf"}),415
    # 槽位（pdf_equip/pdf_install/pdf_both）：带槽位才能找到被替换的旧文件
    slot = (request.form.get("slot") or request.args.get("slot") or "").strip()
    if slot not in ("pdf_equip", "pdf_install", "pdf_both"):
        slot = ""
    conn = get_db()
    row = conn.execute("SELECT id, pdf_equip, pdf_install, pdf_both FROM lost_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error":"not found"}),404
    base = safe_name(f.filename)
    fname = f"{int(time.time()*1000)}_{base}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    f.save(fpath)
    with open(fpath,"rb") as fh:
        data = fh.read(1024)
    i = 0
    while i < len(data) and (data[i] in (0x20, 0x09, 0x0A, 0x0D) or
                             (data[i:i+3] == b"\xef\xbb\xbf")):
        if data[i:i+3] == b"\xef\xbb\xbf":
            i += 3
        else:
            i += 1
    is_pdf = data[i:i+5] == b"%PDF-"
    if not is_pdf:
        try:
            os.remove(fpath)
        except Exception:
            pass
        return jsonify({"error":"invalid pdf"}),415
    # ★ 替换上传：新文件已验证合法，删除该槽位被替换的旧文件（维护磁盘空间）
    if slot:
        _cleanup_replaced_pdf(row[slot], fname)
    return jsonify({"ok":True, "filename": fname, "url": f"/uploads/{fname}"})

# ===================== API：附件 =====================
@app.route("/api/won-projects/<int:pid>/attachments", methods=["POST"])
def upload_attachment(pid):
    if "file" not in request.files:
        return jsonify({"error":"no file"}),400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error":"empty filename"}),400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error":"ext not allowed"}),400

    conn = get_db()
    row = conn.execute("SELECT id, attachments FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404

    base = safe_name(f.filename)
    fname = f"{int(time.time()*1000)}_{base}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    f.save(fpath)

    if ext == ".pdf":
        with open(fpath,"rb") as fh:
            head = fh.read(5)
        if head != b"%PDF-":
            os.remove(fpath)
            conn.close()
            return jsonify({"error":"invalid pdf"}),400

    try:
        atts = json.loads(row["attachments"]) if row["attachments"] else []
    except:
        atts = []
    item = {
        "filename": fname,
        "original": f.filename,
        "ext": ext,
        "uploaded_at": time.strftime("%Y-%m-%d %H:%M"),
        "url": f"/uploads/{fname}"
    }
    atts.append(item)
    conn.execute("UPDATE won_projects SET attachments=?, updated_at=datetime('now','localtime') WHERE id=?",
                 (json.dumps(atts, ensure_ascii=False), pid))
    conn.commit()
    new_row = conn.execute("SELECT * FROM won_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(new_row))

@app.route("/api/won-projects/<int:pid>/attachments/<path:filename>", methods=["DELETE"])
def delete_attachment(pid, filename):
    filename = os.path.basename(filename)
    conn = get_db()
    row = conn.execute("SELECT attachments FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    try:
        atts = json.loads(row["attachments"]) if row["attachments"] else []
    except:
        atts = []
    atts = [a for a in atts if a.get("filename") != filename]
    conn.execute("UPDATE won_projects SET attachments=?, updated_at=datetime('now','localtime') WHERE id=?",
                 (json.dumps(atts, ensure_ascii=False), pid))
    conn.commit()
    try:
        os.remove(os.path.join(UPLOAD_DIR, filename))
    except:
        pass
    new_row = conn.execute("SELECT * FROM won_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(new_row))

# ===================== 禁用前端缓存（根治"改了代码看不到效果"） =====================
# 原理：给 HTML/JS 响应加 Cache-Control: no-cache，浏览器每次都会向服务器校验
# 文件是否变化（ETag/Last-Modified 未变则返回 304，开销极小；变了立刻拿到新代码）。
# 此前 Flask 默认不带该头，Windows 浏览器会凭"启发式缓存"直接用本地旧副本，
# 导致改了 index.html / crm_table.js 后用户强刷也可能拿到旧版。
@app.after_request
def add_no_cache_headers(resp):
    try:
        mt = (resp.mimetype or '')
        if mt == 'text/html' or mt.startswith('application/javascript') or mt.startswith('text/javascript'):
            resp.headers['Cache-Control'] = 'no-cache'
    except Exception:
        pass
    return resp

# ===================== 桌面版：附件"按需取回" =====================
# 场景：用户刚装好、还没同步，或换了一台电脑 —— 界面里有附件引用，
#       但本机 uploads/ 里还没有文件。以前只能干等下一次同步，
#       现在点"查看/下载"时临时从云端取回并缓存到本机，之后离线也能打开。
CLOUD_BASE = "https://agi-gs.tomalso911.workers.dev"
# 云端 R2 的目录前缀（与 cloudflare/src 写入时保持一致）
_CLOUD_DIRS = ("crm-docs", "won-docs", "lost-docs", "crm", "won", "lost")


def _cloud_headers():
    """读取桌面版保存的云端令牌（sync.json）。未登录返回 None。"""
    try:
        with io.open(os.path.join(DATA_DIR, "sync.json"), "r", encoding="utf-8") as f:
            tok = (json.load(f) or {}).get("token", "")
        if not tok:
            return None
        return {"Authorization": "Bearer " + tok,
                "User-Agent": "AGI-PM-Desktop"}
    except Exception:
        return None


def _fetch_cloud_file(path):
    """从云端取回附件并缓存到 uploads/。成功返回本机文件名，失败返回 ''。

    path 可以是云端形态（/api/files/crm-docs/xxx.pdf）或纯文件名；
    纯文件名时依次尝试各业务目录（crm-docs / won-docs / lost-docs …）。
    """
    if not _cloud_headers():
        return ""
    import urllib.request

    name = os.path.basename(path or "")
    if not name:
        return ""
    s = (path or "").strip()
    cands = []
    if s.startswith("/api/files/"):
        cands.append(s)
    if "/" in s.strip("/"):
        cands.append("/api/files/" + s.lstrip("/"))
    cands += ["/api/files/%s/%s" % (d, name) for d in _CLOUD_DIRS]
    cands.append("/api/files/" + name)

    import urllib.error

    headers = _cloud_headers()
    for c in cands:
        try:
            req = urllib.request.Request(CLOUD_BASE + c, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as r:
                data = r.read()
            if not data:
                continue
            with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
                f.write(data)
            return name
        except urllib.error.HTTPError as e:
            # 401/403 = 令牌失效或未登录：再试其它目录也没用，立即放弃，
            # 避免每个缺失文件都空转 7 次网络请求（界面会卡住）。
            if e.code in (401, 403):
                return ""
            continue
        except Exception:
            continue
    return ""


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    filename = os.path.basename(filename)
    # 本机没有且已登录云端 → 临时取回一次（离线或云端也没有则 404）
    if not os.path.isfile(os.path.join(UPLOAD_DIR, filename)):
        got = _fetch_cloud_file(filename)
        if got:
            filename = got
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/files/<path:filename>")
def serve_api_file(filename):
    """桌面版专用：兼容【云端形态】的附件路径 /api/files/<目录>/<文件名>。

    为什么必须有这条路由（V2026.09.05.29 修复）：
      云端把附件引用存成 "/api/files/crm-docs/xxx.pdf"，网页端由 Worker
      从 R2 取回，一切正常；但桌面版跑的是本机 Flask，以前没有这条路由，
      于是界面里"查看/下载 PDF"发出的 /api/files/... 请求一律 404 ——
      表现就是"桌面版不能预览、也不能下载 PDF"，而网页端同样的按钮是好的。

    处理：按【文件名】从本机 uploads/ 提供（同步已把文件下载到该目录）。
    带 ?dl=1 时按附件下载，否则内联预览（与云端 files.js 行为一致）。
    """
    name = os.path.basename(filename or "")
    if not name:
        return jsonify({"error": "file not found"}), 404
    if not os.path.isfile(os.path.join(UPLOAD_DIR, name)):
        # 本机还没这个文件（未同步 / 换电脑）→ 已登录则临时从云端取回
        got = _fetch_cloud_file(filename)
        if not got:
            return jsonify({"error": "file not found", "missing": name}), 404
        name = got
    as_att = (request.args.get("dl") or "").strip() not in ("", "0", "false")
    return send_from_directory(UPLOAD_DIR, name, as_attachment=as_att)


# 离线桌面版：把第三方前端库（html2canvas / jsPDF / chart.js 等）随 exe 打包在
# BASE_DIR/vendor 下，前端用 /vendor/xxx 同源加载，断网也能用打印 PDF / 容量饼图。
@app.route("/vendor/<path:filename>")
def serve_vendor(filename):
    vendor_dir = os.path.join(BASE_DIR, "vendor")
    return send_from_directory(vendor_dir, filename)

# ===================== API：CRM 报价单 PDF 上传 =====================
@app.route("/api/crm-projects/<int:pid>/documents", methods=["POST"])
def upload_crm_pdf(pid):
    if "file" not in request.files:
        return jsonify({"error":"no file"}),400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error":"empty filename"}),400
    ext = os.path.splitext(f.filename)[1].lower()
    # 上传后二次校验：仅允许 PDF，且校验文件头 %PDF-
    if ext != ".pdf":
        return jsonify({"error":"invalid pdf"}),415
    # 槽位（pdf_equip/pdf_install/pdf_both）：带槽位才能找到被替换的旧文件
    slot = (request.form.get("slot") or request.args.get("slot") or "").strip()
    if slot not in ("pdf_equip", "pdf_install", "pdf_both"):
        slot = ""
    conn = get_db()
    row = conn.execute("SELECT id, pdf_equip, pdf_install, pdf_both FROM crm_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error":"not found"}),404
    base = safe_name(f.filename)
    fname = f"{int(time.time()*1000)}_{base}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    f.save(fpath)
    # 上传后二次校验：跳过 UTF-8 BOM 与前导空白后，文件头必须为 %PDF-
    with open(fpath,"rb") as fh:
        data = fh.read(1024)
    i = 0
    while i < len(data) and (data[i] in (0x20, 0x09, 0x0A, 0x0D) or
                             (data[i:i+3] == b"\xef\xbb\xbf")):
        if data[i:i+3] == b"\xef\xbb\xbf":
            i += 3
        else:
            i += 1
    is_pdf = data[i:i+5] == b"%PDF-"
    if not is_pdf:
        try:
            os.remove(fpath)
        except Exception:
            pass
        return jsonify({"error":"invalid pdf"}),415
    # ★ 替换上传：新文件已验证合法，删除该槽位被替换的旧文件（维护磁盘空间）
    if slot:
        _cleanup_replaced_pdf(row[slot], fname)
    return jsonify({"ok":True, "filename": fname, "url": f"/uploads/{fname}"})

# ===================== API：WON 设备/安装合同 PDF 上传（V45） =====================
@app.route("/api/won-projects/<int:pid>/documents", methods=["POST"])
def upload_won_doc(pid):
    if "file" not in request.files:
        return jsonify({"error":"no file"}),400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error":"empty filename"}),400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext != ".pdf":
        return jsonify({"error":"invalid pdf"}),415
    slot = (request.form.get("slot") or request.args.get("slot") or "").strip()
    if slot not in ("doc_equip", "doc_install", "doc_both"):
        slot = ""
    conn = get_db()
    row = conn.execute("SELECT id, doc_equip, doc_install, doc_both FROM won_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error":"not found"}),404
    base = safe_name(f.filename)
    fname = f"{int(time.time()*1000)}_{base}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    f.save(fpath)
    with open(fpath,"rb") as fh:
        data = fh.read(1024 + 5)
    # ★ 二次校验（与前端/云端同标准）：前 1024 字节内查找 %PDF- 魔数
    if data.find(b"%PDF-", 0, 1024) < 0:
        try:
            os.remove(fpath)
        except Exception:
            pass
        return jsonify({"error":"invalid pdf"}),415
    # 替换上传：删除被替换的旧文件
    if slot:
        _cleanup_replaced_pdf(row[slot], fname)
    return jsonify({"ok":True, "filename": fname, "url": f"/uploads/{fname}"})

# ===================== API：补充协议摘要 =====================
@app.route("/api/won-projects/<int:pid>/supp-summary", methods=["PUT"])
def update_supp_summary(pid):
    data = request.get_json(force=True, silent=True) or {}
    arr = data.get("supp_summary", [])
    if not isinstance(arr, list):
        return jsonify({"error":"supp_summary must be list"}),400
    conn = get_db()
    row = conn.execute("SELECT id FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    conn.execute("UPDATE won_projects SET supp_summary=?, updated_at=datetime('now','localtime') WHERE id=?",
                 (json.dumps(arr, ensure_ascii=False), pid))
    new_row = conn.execute("SELECT * FROM won_projects WHERE id=?", (pid,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(new_row))

# ===================== 静态首页 =====================
# 本机模式页面缓存：{mtime, html} —— index.html 一改动就自动重建，不会用到旧页面
_local_index_cache = {"mtime": None, "html": ""}


@app.route("/")
def index():
    # 本机模式：把「已上云」的接口改回同源（本机），
    # 这样通过 http://localhost:5050 访问时，登录/会话/业务数据全部走本机后端 + 本机数据库，
    # 不受云端维护锁（LOGIN_ONLY_USERS）限制 —— 用于本地测试时释放全部用户。
    # 注意：只影响本机返回的这一份页面副本，磁盘上的 index.html 与线上 WEB 完全不变。
    try:
        src = os.path.join(BASE_DIR, "index.html")
        st = os.stat(src)
        if _local_index_cache["mtime"] != st.st_mtime:
            with io.open(src, encoding="utf-8") as f:
                html = f.read()
            # 把 var CLOUD_ONLY = [ ... ]; 整段替换为空数组
            html = re.sub(r"var CLOUD_ONLY\s*=\s*\[[\s\S]*?\];",
                          "var CLOUD_ONLY = [];  /* 本机模式：全部接口走 localhost */",
                          html, count=1)
            _local_index_cache["mtime"] = st.st_mtime
            _local_index_cache["html"] = html
        return Response(_local_index_cache["html"], mimetype="text/html")
    except Exception:
        # 兜底：任何异常都退回原文件，保证页面一定能打开
        return send_from_directory(BASE_DIR, "index.html")

@app.route("/crm_table.js")
def serve_crm_table():
    return send_from_directory(BASE_DIR, "crm_table.js", mimetype="application/javascript")

@app.route("/vault.html")
def serve_vault():
    return send_from_directory(BASE_DIR, "vault.html", mimetype="text/html")

@app.route("/lost_table.js")
def serve_lost_table():
    return send_from_directory(BASE_DIR, "lost_table.js", mimetype="application/javascript")

# ===== PWA / 手机 APP 静态资源 =====
@app.route("/manifest.json")
def serve_manifest():
    return send_from_directory(BASE_DIR, "manifest.json",
                               mimetype="application/manifest+json")


@app.route("/icon-192.png")
def serve_icon_192():
    return send_from_directory(BASE_DIR, "icon-192.png", mimetype="image/png")


@app.route("/favicon.svg")
def serve_favicon_svg():
    return send_from_directory(BASE_DIR, "favicon.svg", mimetype="image/svg+xml")


@app.route("/icon-512.png")
def serve_icon_512():
    return send_from_directory(BASE_DIR, "icon-512.png", mimetype="image/png")


@app.route("/icon-512-maskable.png")
def serve_icon_maskable():
    return send_from_directory(BASE_DIR, "icon-512-maskable.png", mimetype="image/png")


# ===================== API：私密空间（Vault，tom 专属） =====================
def _vault_now():
    return time.time()

def _vault_check_lock():
    """返回 (locked, remain) ；locked=True 时 remain 为剩余锁定秒数。"""
    if _vault_fail["lock_until"] > _vault_now():
        return True, int(_vault_fail["lock_until"] - _vault_now())
    return False, 0

def _vault_owner_ok(req_user):
    """请求方是否为私密空间主人 tom（区分大小写归一）。"""
    return (req_user or "").strip().lower() == VAULT_OWNER

def _vault_auth_token():
    """从 header 或查询参数取出 token，校验有效性，返回 (ok, reason)。
    查询参数 ?vt= 兼容浏览器直接导航（<a>/<img> 带不了自定义头）。"""
    tok = (request.headers.get("X-Vault-Token") or request.args.get("vt") or "").strip()
    if not tok:
        return False, "missing token"
    exp = _vault_tokens.get(tok)
    if not exp:
        return False, "invalid token"
    if exp < _vault_now():
        _vault_tokens.pop(tok, None)
        return False, "expired token"
    return True, ""


def _vault_sanitize_rel(p):
    """清洗相对路径：逐段过滤 .. 与非法字符，返回 'a/b/c.ext' 形式（无首尾斜杠）。"""
    segs = []
    for s in re.split(r"[\\/]+", str(p or "")):
        s = re.sub(r'[\\/:*?"<>|]', "_", s)
        s = re.sub(r"\s+", "_", s).strip()
        if not s or s in (".", ".."):
            continue
        segs.append(s[:120])
    return "/".join(segs[:12])


def _vault_resolve_name(captured=""):
    """解析文件名：优先 ?n= 查询参数（完整相对路径），退化取 URL 路径捕获；拒绝 .. 穿越。"""
    name = (request.args.get("n") or captured or "").strip().lstrip("/")
    if not name or re.search(r"(^|/)\.\.(/|$)", name):
        return None
    return name


def _vault_unique_path(dirpath, filename):
    """重名自动加 (n)，与云端行为一致。"""
    base, ext = os.path.splitext(filename)
    cand = filename
    i = 1
    while os.path.exists(os.path.join(dirpath, cand)):
        cand = "%s (%d)%s" % (base, i, ext)
        i += 1
        if i > 99:
            cand = "%s (%d)%s" % (base, int(time.time()), ext)
            break
    return cand

import secrets as _secrets

@app.route("/api/vault/unlock", methods=["POST"])
def vault_unlock():
    """校验 PIN，成功后签发有时效的 token。仅 tom 可调用。"""
    data = request.get_json(force=True, silent=True) or {}
    req_user = (data.get("username") or "").strip()
    pin = (data.get("pin") or "").strip()
    locked, remain = _vault_check_lock()
    if locked:
        return jsonify({"ok": False, "error": "尝试过多，请 %d 秒后再试" % remain, "lock": remain}), 429
    if not _vault_owner_ok(req_user):
        return jsonify({"ok": False, "error": "无权限访问该空间"}), 403
    if pin != VAULT_PIN:
        _vault_fail["count"] += 1
        if _vault_fail["count"] >= VAULT_MAX_FAIL:
            _vault_fail["lock_until"] = _vault_now() + VAULT_LOCK_SECONDS
            _vault_fail["count"] = 0
            return jsonify({"ok": False, "error": "错误次数过多，已锁定 %d 秒" % VAULT_LOCK_SECONDS, "lock": VAULT_LOCK_SECONDS}), 429
        return jsonify({"ok": False, "error": "密码错误", "fail": _vault_fail["count"]}), 401
    # 成功：签发 token
    _vault_fail["count"] = 0
    tok = _secrets.token_hex(VAULT_TOKEN_BYTES)
    _vault_tokens[tok] = _vault_now() + VAULT_TOKEN_TTL
    return jsonify({"ok": True, "token": tok, "ttl": VAULT_TOKEN_TTL})

@app.route("/api/vault/files", methods=["GET"])
def vault_list():
    ok, reason = _vault_auth_token()
    if not ok:
        return jsonify({"ok": False, "error": reason}), 401
    items = []
    try:
        # 递归遍历：name 返回相对路径（含文件夹），前端渲染目录树
        for root, _dirs, files in os.walk(VAULT_DIR):
            for fn in files:
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, VAULT_DIR).replace("\\", "/")
                st = os.stat(fp)
                items.append({
                    "name": rel,
                    "size": st.st_size,
                    "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime)),
                })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    items.sort(key=lambda x: x["name"])
    return jsonify({"ok": True, "files": items})

@app.route("/api/vault/upload", methods=["POST"])
def vault_upload():
    ok, reason = _vault_auth_token()
    if not ok:
        return jsonify({"ok": False, "error": reason}), 401
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "no file"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "empty filename"}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    # 私密空间：仅拦截真正危险的可执行文件，其余任意类型均可上传
    if ext in VAULT_BLOCKED_EXT:
        return jsonify({"ok": False, "error": "不允许上传可执行文件：%s" % ext}), 400
    # 文件夹结构：path 字段为相对路径（a/b/c.ext），缺失时退化用文件名
    rel = _vault_sanitize_rel(request.form.get("path") or f.filename)
    if not rel:
        return jsonify({"ok": False, "error": "invalid path"}), 400
    parts = rel.split("/")
    dirpath = os.path.join(VAULT_DIR, *parts[:-1]) if len(parts) > 1 else VAULT_DIR
    os.makedirs(dirpath, exist_ok=True)
    fname = _vault_unique_path(dirpath, parts[-1])
    fpath = os.path.join(dirpath, fname)
    f.save(fpath)
    if ext == ".pdf":
        with open(fpath, "rb") as fh:
            head = fh.read(5)
        if head != b"%PDF-":
            os.remove(fpath)
            return jsonify({"ok": False, "error": "invalid pdf"}), 400
    rel_name = os.path.relpath(fpath, VAULT_DIR).replace("\\", "/")
    return jsonify({"ok": True, "name": rel_name, "original": f.filename})

@app.route("/api/vault/download/<path:name>", methods=["GET"])
def vault_download(name):
    ok, reason = _vault_auth_token()
    if not ok:
        return jsonify({"ok": False, "error": reason}), 401
    name = _vault_resolve_name(name)
    if not name:
        return jsonify({"ok": False, "error": "文件不存在"}), 404
    fp = os.path.join(VAULT_DIR, *name.split("/"))
    if not os.path.isfile(fp):
        return jsonify({"ok": False, "error": "文件不存在"}), 404
    return send_from_directory(VAULT_DIR, name, as_attachment=True)

@app.route("/api/vault/preview/<path:name>", methods=["GET"])
def vault_preview(name):
    ok, reason = _vault_auth_token()
    if not ok:
        return jsonify({"ok": False, "error": reason}), 401
    name = _vault_resolve_name(name)
    if not name:
        return jsonify({"ok": False, "error": "文件不存在"}), 404
    fp = os.path.join(VAULT_DIR, *name.split("/"))
    if not os.path.isfile(fp):
        return jsonify({"ok": False, "error": "文件不存在"}), 404
    return send_from_directory(VAULT_DIR, name)

@app.route("/api/vault/delete/<path:name>", methods=["DELETE"])
def vault_delete(name):
    ok, reason = _vault_auth_token()
    if not ok:
        return jsonify({"ok": False, "error": reason}), 401
    name = _vault_resolve_name(name)
    if not name:
        return jsonify({"ok": False, "error": "文件不存在"}), 404
    fp = os.path.join(VAULT_DIR, *name.split("/"))
    if not os.path.isfile(fp):
        return jsonify({"ok": False, "error": "文件不存在"}), 404
    os.remove(fp)
    _vault_cleanup_dirs(os.path.dirname(fp))
    return jsonify({"ok": True})


def _vault_cleanup_dirs(dirpath):
    """删除文件后顺手清掉空目录（根目录除外）。"""
    try:
        while os.path.abspath(dirpath) != os.path.abspath(VAULT_DIR):
            if os.path.isdir(dirpath) and not os.listdir(dirpath):
                os.rmdir(dirpath)
                dirpath = os.path.dirname(dirpath)
            else:
                break
    except Exception:
        pass

@app.route("/api/vault/delete", methods=["POST"])
def vault_delete_batch():
    """批量删除：body = {"names": [filename, ...]}"""
    ok, reason = _vault_auth_token()
    if not ok:
        return jsonify({"ok": False, "error": reason}), 401
    data = request.get_json(force=True, silent=True) or {}
    names = data.get("names") or []
    if not isinstance(names, list) or not names:
        return jsonify({"ok": False, "error": "没有选择文件"}), 400
    deleted, missing, blocked = [], [], []
    for n in names:
        n = str(n).strip().lstrip("/")
        if not n or re.search(r"(^|/)\.\.(/|$)", n):
            blocked.append(n); continue
        fp = os.path.join(VAULT_DIR, *n.split("/"))
        if not os.path.isfile(fp):
            missing.append(n); continue
        try:
            os.remove(fp)
            _vault_cleanup_dirs(os.path.dirname(fp))
            deleted.append(n)
        except Exception:
            missing.append(n)
    return jsonify({"ok": True, "deleted": deleted, "missing": missing, "blocked": blocked})


@app.route("/health")
def health():
    return jsonify({"ok": True, "db": DB_PATH, "upload_dir": UPLOAD_DIR})


# ===================== API：系统清理（仅 tom） =====================
# 与云端 /api/admin/purge-* 对称，用于清掉删记录后残留的孤儿文件。
@app.route("/api/admin/purge-report")
def admin_purge_report():
    """只读报告：磁盘文件总数、孤儿文件数与样例。"""
    if (request.headers.get("X-User-Name") or "").strip().lower() != "tom":
        return jsonify({"error": "forbidden: owner only"}), 403
    conn = get_db()
    refs = _collect_referenced_files(conn)
    conn.close()
    files, orphans = [], []
    for root, _dirs, names in os.walk(UPLOAD_DIR):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), UPLOAD_DIR).replace("\\", "/")
            files.append(rel)
            if not rel.startswith("vault/") and rel not in refs:
                orphans.append(rel)
    return jsonify({"ok": True, "report": {
        "upload_total": len(files),
        "upload_orphans": len(orphans),
        "orphan_sample": orphans[:30],
        "referenced_files": len(refs),
    }})


@app.route("/api/admin/purge-orphans", methods=["POST", "GET"])
def admin_purge_orphans():
    """清理 uploads/ 下没有任何数据库记录引用的孤儿文件（vault/ 不在此列）。"""
    if (request.headers.get("X-User-Name") or "").strip().lower() != "tom":
        return jsonify({"error": "forbidden: owner only"}), 403
    data = request.get_json(force=True, silent=True) or {}
    dry = bool(data.get("dryRun"))
    conn = get_db()
    refs = _collect_referenced_files(conn)
    conn.close()
    deleted, orphans = 0, []
    for root, _dirs, names in os.walk(UPLOAD_DIR):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), UPLOAD_DIR).replace("\\", "/")
            if rel.startswith("vault/") or rel in refs:
                continue
            orphans.append(rel)
            if not dry:
                try:
                    os.remove(os.path.join(UPLOAD_DIR, rel))
                    deleted += 1
                except OSError:
                    pass
    return jsonify({"ok": True, "result": {
        "orphan_found": len(orphans), "deleted": 0 if dry else deleted,
        "dryRun": dry, "sample": orphans[:50],
    }})


@app.route("/api/admin/storage-report")
def admin_storage_report():
    """本地 uploads/ 容量分布（与云端 /api/admin/storage-report 对称），离线桌面版也显示饼图。仅 tom 可用。"""
    if (request.headers.get("X-User-Name") or "").strip().lower() != "tom":
        return jsonify({"error": "forbidden: owner only"}), 403
    conn = get_db()
    # 按表收集被引用的文件名（用于把 uploads 文件归类到 won/crm/lost）
    refs = {"won": set(), "crm": set(), "lost": set()}
    try:
        rows = conn.execute("SELECT pdf_equip, pdf_install, pdf_both FROM crm_projects").fetchall()
        for r in rows:
            refs["crm"].update(_row_file_refs("crm_projects", r))
    except Exception:
        pass
    try:
        rows = conn.execute("SELECT pdf_equip, pdf_install, pdf_both FROM lost_projects").fetchall()
        for r in rows:
            refs["lost"].update(_row_file_refs("lost_projects", r))
    except Exception:
        pass
    try:
        rows = conn.execute("SELECT attachments FROM won_projects").fetchall()
        for r in rows:
            refs["won"].update(_row_file_refs("won_projects", r))
    except Exception:
        pass
    conn.close()

    areas = {k: 0 for k in ("won", "crm", "lost", "vault", "snapshots", "other")}
    for root, _dirs, names in os.walk(UPLOAD_DIR):
        for n in names:
            full = os.path.join(root, n)
            try:
                sz = os.path.getsize(full)
            except OSError:
                continue
            rel = os.path.relpath(full, UPLOAD_DIR).replace("\\", "/")
            if rel.startswith("vault/"):
                cat = "vault"
            elif n in refs["won"]:
                cat = "won"
            elif n in refs["crm"]:
                cat = "crm"
            elif n in refs["lost"]:
                cat = "lost"
            else:
                cat = "other"
            areas[cat] += sz
    # 数据快照（本地在 DATA_DIR）
    for snap in ("demo_snapshot.json", "price_snapshot.json"):
        try:
            p = os.path.join(DATA_DIR, snap)
            if os.path.isfile(p):
                areas["snapshots"] += os.path.getsize(p)
        except Exception:
            pass

    used = sum(areas.values())
    # 容量对齐云端 shape：用磁盘总空间 / 剩余空间（饼图除以 capacity_bytes）
    try:
        du = shutil.disk_usage(UPLOAD_DIR)
        capacity = du.total
        free = du.free
    except Exception:
        capacity = used or 1
        free = 0
    area_meta = {"won": "WON", "crm": "CRM", "lost": "LOST",
                 "vault": "Vault", "snapshots": "Snapshots", "other": "Other"}
    area_arr = [{"key": k, "name": area_meta[k], "bytes": areas[k],
                 "percent": (areas[k] / capacity * 100) if capacity else 0.0}
                for k in ("won", "crm", "lost", "vault", "snapshots", "other")
                if areas[k] > 0]
    area_arr.sort(key=lambda a: a["bytes"], reverse=True)
    return jsonify({"ok": True, "storage": {
        "capacity_bytes": capacity,
        "capacity_gb": round(capacity / 1e9, 2),
        "used_bytes": used,
        "used_gb": round(used / 1e9, 2),
        "used_percent": round(used / capacity * 100, 2) if capacity else 0.0,
        "free_bytes": free,
        "free_gb": round(free / 1e9, 2),
        "free_percent": round(free / capacity * 100, 2) if capacity else 0.0,
        "areas": area_arr,
    }})

# ===================== API：用户与授权（CRUD + 权限） =====================
DEFAULT_INIT_PASSWORD = "66668888"  # 新用户默认初始密码


def _row_to_user(row, manager_set=None):
    """将数据库行转换为前端需要的用户对象。"""
    import json as _json
    def rv(k, default=""):
        try:
            v = row[k]
            return v if v is not None else default
        except (IndexError, KeyError):
            return default
    try:
        vis_can_see_me = _json.loads(rv("vis_can_see_me", "[]")) if rv("vis_can_see_me") else []
    except Exception:
        vis_can_see_me = []
    try:
        vis_he_can_see = _json.loads(rv("vis_he_can_see", "[]")) if rv("vis_he_can_see") else []
    except Exception:
        vis_he_can_see = []
    try:
        perms = _json.loads(rv("perms", "{}")) if rv("perms") else {}
    except Exception:
        perms = {}
    try:
        forgot_approvers = _json.loads(rv("forgot_approvers", "[]")) if rv("forgot_approvers") else []
    except Exception:
        forgot_approvers = []
    username = rv("username")
    return {
        "id": rv("id"),
        "username": username,
        "real_name": rv("real_name"),
        "role": rv("role"),
        "position": rv("position"),
        "status": rv("status") or "active",
        "is_admin": (username in manager_set) if manager_set is not None else False,
        "vis_can_see_me": vis_can_see_me,
        "vis_he_can_see": vis_he_can_see,
        "perms": perms,
        "delegate_to": rv("delegate_to"),
        "forgot_approvers": forgot_approvers if isinstance(forgot_approvers, list) else [],
    }


# ===================== API：灌入各角色测试用户（用于测试） =====================
SEED_USERS = [
    # 销售（多个，作为 WON/LOST/CRM 销售人员下拉的主要来源）
    ("tom",    "Tom",    "销售",      False),
    ("cuong",  "Cuong",  "销售",      False),
    ("james",  "James",  "销售",      False),
    ("travis", "Travis", "销售",      False),
    ("ali",    "Ali",    "销售",      False),
    ("khoa",   "Khoa",   "销售",      False),
    ("minh",   "Minh",   "销售",      False),
    ("linh",   "Linh",   "销售",      False),
    # 销售总监
    ("salesdir1", "Henry",  "销售总监", False),
    ("salesdir2", "Wendy",  "销售总监", False),
    # 总经理
    ("gm1", "George", "总经理", True),
    ("gm2", "Grace",  "总经理", True),
    # 副总经理
    ("dgm1", "David", "副总经理", False),
    ("dgm2", "Diana", "副总经理", False),
    # 观察者
    ("obs1", "Olivia", "观察者", False),
    ("obs2", "Oscar",  "观察者", False),
    # 财务经理
    ("fin1", "Fiona", "财务经理", False),
    ("fin2", "Felix", "财务经理", False),
    # 总经理助理
    ("asst1", "Amy", "总经理助理", False),
    # 人事经理
    ("hr1", "Hannah", "人事经理", False),
]

@app.route("/api/seed-users", methods=["GET", "POST"])
def api_seed_users():
    """灌入各角色测试用户（upsert：username 已存在则跳过）。"""
    conn = get_db()
    inserted = 0
    for username, real_name, position, is_admin in SEED_USERS:
        exists = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if exists:
            continue
        pw_hash = DEFAULT_INIT_PASSWORD
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            """INSERT INTO users
               (username, password, real_name, role, position, status,
                vis_can_see_me, vis_he_can_see, perms, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (username, pw_hash, real_name,
             "admin" if is_admin else "user", position, "active",
             json.dumps([username], ensure_ascii=False),
             json.dumps([username], ensure_ascii=False),
             json.dumps({}, ensure_ascii=False),
             now)
        )
        # 种子数据里 is_admin=True 的旧标记同步迁移到 managers 表
        if is_admin:
            conn.execute("INSERT OR IGNORE INTO managers (username) VALUES (?)", (username,))
        inserted += 1
    # 保证 tom 始终为管理员
    conn.execute("INSERT OR IGNORE INTO managers (username) VALUES (?)", ("tom",))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "inserted": inserted, "total_defined": len(SEED_USERS)})


# ===== 审批请求 API（“发起审批”类型的真实拦截） =====
@app.route("/api/approval-requests", methods=["POST"])
def api_approval_create():
    data = request.get_json(force=True, silent=True) or {}
    requester = (data.get("requester") or "").strip()
    if not requester:
        return jsonify({"ok": False, "msg": "未登录"}), 401
    block_id = data.get("block_id") or ""
    block_name = data.get("block_name") or block_id
    # 审批标题 = 区块名称；审批内容 = 前端传来的权限说明文字（"默认保留信息"列）
    title = data.get("title") or block_name
    content = data.get("content") or ""
    approvers = data.get("approvers") or []
    conn = get_db()
    # ===== 审批人以数据库真源为准（核心修复）=====
    # 发起人浏览器里的权限快照可能已过期（管理员刚改完配置、发起人尚未刷新）。
    # 优先级：① 数据库中发起人当前配置的审批人 ② 前端提交的名单 ③ tom+管理员兜底。
    # 这样保证"当前配置的审批人"一定收到请求，业务流程永远不会因配置读取问题而中断。
    db_approvers = []
    try:
        _row = conn.execute("SELECT perms FROM users WHERE username=?", (requester,)).fetchone()
        if _row and _row["perms"]:
            _p = json.loads(_row["perms"])
            db_approvers = [str(a).strip() for a in ((_p.get(block_id) or {}).get("approvers") or []) if str(a).strip()]
    except Exception:
        db_approvers = []
    if db_approvers:
        approvers = db_approvers

    def _mgr_fallback():
        fb = ["tom"]
        try:
            for m in conn.execute("SELECT username FROM managers"):
                if m["username"] not in fb:
                    fb.append(m["username"])
        except Exception:
            pass
        return fb

    if not approvers:
        approvers = _mgr_fallback()
    # 单次生效审批按 target_id 区分同一区块不同操作对象；持续生效审批仍按区块去重
    persist = (data.get("persist") or "persistent").strip().lower()
    if persist not in ("persistent", "single-use"):
        persist = "persistent"
    target_id = (data.get("target_id") or "").strip()
    dup_sql = (
        "SELECT 1 FROM approval_requests WHERE requester=? AND block_id=? AND status='pending' AND persist=?"
        + (" AND target_id=?" if persist == "single-use" else "")
    )
    dup_params = (requester, block_id, persist)
    if persist == "single-use":
        dup_params += (target_id,)
    dup = conn.execute(dup_sql, dup_params).fetchone()
    if dup:
        conn.close()
        return jsonify({"ok": False, "msg": "该操作已存在待审批请求"}), 409
    # 用户与权限管理审批（USR-L1/D1/D2/D3）：审批人锁死为固定三人组，任一人审批即结束；
    # payload 保存暂存数据（新增用户资料 / 权限变更前后对比 / 删除目标），通过后由服务端执行
    if block_id in ("USR-L1", "USR-D1", "USR-D2", "USR-D3"):
        approvers = list(TRI_APPROVERS)
    # 规范化审批人：兼容前端旧 bug 中存的数字 ID（保留停用/离职用户，以便其代理人能代为审批）
    approvers = _norm_approver_list(approvers, conn)
    # 过滤不存在的用户名（如配置残留的已删除账号），剩余为空则兜底 tom+管理员，
    # 保证业务审批请求永远能创建成功（宁可兜底送达，也不让发起人流程中断）
    existing_users = {r["username"] for r in conn.execute("SELECT username FROM users").fetchall()}
    approvers = [a for a in approvers if a in existing_users]
    if not approvers:
        approvers = _mgr_fallback()
        approvers = [a for a in approvers if a in existing_users]
    if not approvers:
        conn.close()
        return jsonify({"ok": False, "msg": "系统中没有可用的审批人（tom 不存在？）"}), 400
    conn.execute("""INSERT INTO approval_requests
        (title, requester, requester_name, block_id, block_name, action_name, approvers, status, created_at, content, persist, target_id, payload)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
        title,
        requester,
        data.get("requester_name") or "",
        block_id,
        block_name,
        data.get("action_name") or "",
        json.dumps(approvers, ensure_ascii=False),
        "pending",
        time.strftime("%Y-%m-%d %H:%M:%S"),
        content,
        persist,
        target_id,
        data.get("payload") or ""
    ))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route("/api/approval-requests", methods=["GET"])
def api_approval_list():
    # 支持按 ?scope=mine(我发起的) / ?scope=todo(待我审批) / ?scope=all(全部)
    scope = request.args.get("scope", "all")
    me = (request.args.get("me") or "").strip()
    conn = get_db()
    rows = conn.execute("SELECT * FROM approval_requests ORDER BY id DESC").fetchall()
    items = []
    for r in rows:
        x = row_to_dict(r)
        # 把审批人字段规范化用户名（兼容旧数字 ID 数据）
        try:
            arr = json.loads(x["approvers"]) if x["approvers"] else []
        except Exception:
            arr = []
        x["approvers"] = _norm_approver_list(arr, conn)
        items.append(x)
    conn.close()
    if scope == "mine":
        items = [x for x in items if x["requester"] == me]
    elif scope == "todo":
        # 待我审批：含直接指派给我，以及离职代理（我是某离职审批人的 delegate_to）的待办
        delegated_users = set()
        if me:
            try:
                conn2 = get_db()
                du = conn2.execute(
                    "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username<>?",
                    (me, me)
                ).fetchall()
                delegated_users = {str(d["username"]) for d in du}
                conn2.close()
            except Exception:
                pass
        items = [x for x in items
                 if x["status"] == "pending"
                 and (me in x["approvers"]
                      or bool(delegated_users & set(x["approvers"])))]
    return jsonify({"ok": True, "items": items})


@app.route("/api/approval-requests/<int:rid>/resolve", methods=["POST"])
def api_approval_resolve(rid):
    data = request.get_json(force=True, silent=True) or {}
    action = data.get("action")  # approve / reject
    resolver = (data.get("resolver") or "").strip()
    if action not in ("approve", "reject"):
        return jsonify({"ok": False, "msg": "invalid action"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM approval_requests WHERE id=?", (rid,)).fetchone()
    if not row:
        conn.close(); return jsonify({"ok": False, "msg": "not found"}), 404
    if row["status"] != "pending":
        conn.close(); return jsonify({"ok": False, "msg": "已处理"}), 409
    approvers = _norm_approver_list(json.loads(row["approvers"]) if row["approvers"] else [], conn)
    # 校验 resolver 是否是指定审批人，或审批人已离职且 resolver 是其代理人
    allowed = resolver in approvers
    if not allowed:
        delegated = {d["username"] for d in conn.execute(
            "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username IN (%s)"
            % ",".join("?"*len(approvers)), (resolver, *approvers)).fetchall()}
        allowed = bool(delegated)
    if not allowed:
        conn.close()
        return jsonify({"ok": False, "msg": "您不是该审批单的指定审批人"}), 403
    new_status = "approved" if action == "approve" else "rejected"
    result_note = data.get("note") or data.get("result_note") or ""
    # 顺带把审批人字段持久化为规范的用户名（修复旧数字 ID 数据）
    conn.execute("""UPDATE approval_requests SET status=?, resolved_at=?, resolver=?, resolver_name=?, result_note=?, approvers=?
                    WHERE id=?""", (
        new_status, time.strftime("%Y-%m-%d %H:%M:%S"),
        resolver, data.get("resolver_name") or "",
        result_note, json.dumps(approvers, ensure_ascii=False), rid
    ))
    conn.commit(); conn.close()
    # 忘记密码审批（PWD-FORGET）：通过 → 密码自动重置为初始密码 66668888；拒绝 → 不做任何变更
    if row["block_id"] == "PWD-FORGET":
        if new_status == "approved":
            try:
                conn2 = get_db()
                conn2.execute("UPDATE users SET password=? WHERE username=?",
                              (DEFAULT_INIT_PASSWORD, row["target_id"] or row["requester"]))
                conn2.execute("UPDATE password_requests SET status='processed', processed_at=?, note='approved_reset' "
                              "WHERE username=? AND status='pending'",
                              (time.strftime("%Y-%m-%d %H:%M:%S"), row["target_id"] or row["requester"]))
                conn2.commit(); conn2.close()
            except Exception as e:
                print("[PWD-FORGET] 重置密码失败:", e)
        else:
            try:
                conn2 = get_db()
                conn2.execute("UPDATE password_requests SET status='rejected', processed_at=?, note='rejected' "
                              "WHERE username=? AND status='pending'",
                              (time.strftime("%Y-%m-%d %H:%M:%S"), row["target_id"] or row["requester"]))
                conn2.commit(); conn2.close()
            except Exception:
                pass
        bump_perm_version(row["requester"])
        return jsonify({"ok": True, "status": new_status})
    # 用户与权限管理审批（USR-D1 权限变更 / USR-D2 新增用户 / USR-D3 删除用户）：
    # 通过 → 按暂存 payload 执行；拒绝 → 丢弃。审批人已锁死三人组，任一人审批即结束。
    if row["block_id"] in ("USR-D1", "USR-D2", "USR-D3"):
        try:
            pl = json.loads(row["payload"] or "{}")
        except Exception:
            pl = {}
        conn2 = get_db()
        try:
            if new_status == "approved":
                if row["block_id"] == "USR-D1":
                    if pl.get("uid"):
                        conn2.execute("UPDATE users SET perms=? WHERE id=?",
                                      (json.dumps(pl.get("perms") or {}, ensure_ascii=False), pl["uid"]))
                elif row["block_id"] == "USR-D2":
                    # 账号一律小写（与登录名一致）：审批建号也必须归一化，
                    # 否则审批通过的账号会带大写，后续权限/数据范围/统计对不上。
                    _uname = (pl.get("username") or pl.get("login") or "").strip().lower()   # 前端 payload 用 login 字段
                    if _uname:
                        ex = conn2.execute("SELECT 1 FROM users WHERE lower(username)=lower(?)", (_uname,)).fetchone()
                        if not ex:
                            fa = pl.get("forgot_approvers") or ["tom"]
                            if isinstance(fa, list) and "tom" not in fa:
                                fa.insert(0, "tom")
                            conn2.execute("""INSERT INTO users
                               (username, password, real_name, role, position, status,
                                vis_can_see_me, vis_he_can_see, perms, forgot_approvers, created_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (
                                _uname, DEFAULT_INIT_PASSWORD, pl.get("name") or _uname,
                                "user", pl.get("position") or "", "active",
                                json.dumps(pl.get("vis_can_see_me") or []), json.dumps(pl.get("vis_he_can_see") or []),
                                json.dumps(pl.get("perms") or {}, ensure_ascii=False),
                                json.dumps(fa[:3], ensure_ascii=False), time.strftime("%Y-%m-%d %H:%M:%S")))
                            if pl.get("delegate_to"):
                                conn2.execute("UPDATE users SET delegate_to=? WHERE lower(username)=lower(?)",
                                              (pl["delegate_to"], _uname))
                elif row["block_id"] == "USR-D3":
                    if pl.get("uid"):
                        conn2.execute("DELETE FROM users WHERE id=?", (pl["uid"],))
                # 管理员名单同步（新增/编辑场景可能携带；tom 不可移除）
                if isinstance(pl.get("managers"), list) and pl["managers"]:
                    names = sorted({str(m).strip().lower() for m in pl["managers"] if str(m).strip()})
                    if "tom" not in names:
                        names.append("tom")
                    if 2 <= len(names) <= 4:
                        conn2.execute("DELETE FROM managers")
                        for n in names:
                            conn2.execute("INSERT OR IGNORE INTO managers (username) VALUES (?)", (n,))
                try:
                    bump_perm_version(pl.get("username") or "")
                except Exception:
                    pass
        except Exception as e:
            print("[USR-审批] 执行失败:", e)
        finally:
            try:
                conn2.commit()   # 关键：提交执行体写入（否则 close 时事务回滚丢弃）
            except Exception:
                pass
            try:
                conn2.close()
            except Exception:
                pass
        bump_perm_version(row["requester"])
        return jsonify({"ok": True, "status": new_status})
    # 审批通过：持续生效的审批才写入发起人 perms；单次生效审批仅做状态变更，不写入长期权限。
    # 同时刷新其版本号，触发其前端立即更新。
    is_persistent = (row["persist"] or "persistent").lower() == "persistent"
    if new_status == "approved" and is_persistent:
        try:
            conn2 = get_db()
            tgt = conn2.execute("SELECT id, perms FROM users WHERE username=?",
                                (row["requester"],)).fetchone()
            if tgt:
                import json as _json
                try:
                    p = _json.loads(tgt["perms"]) if tgt["perms"] else {}
                except Exception:
                    p = {}
                if not isinstance(p, dict):
                    p = {}
                # 通过后给予“特别授权看全公司”（与权限模态框的授权语义一致）
                blk = row["block_id"]
                if blk:
                    p[blk] = dict(p.get(blk, {}))
                    p[blk]["decision"] = "特别授权看全公司"
                    p[blk]["granted_by_approval"] = rid
                conn2.execute("UPDATE users SET perms=? WHERE id=?",
                              (_json.dumps(p, ensure_ascii=False), tgt["id"]))
                conn2.commit(); conn2.close()
        except Exception as e:
            print("[Approval] 写入授权失败:", e)
        bump_perm_version(row["requester"])
    elif new_status == "rejected" and is_persistent:
        # 拒绝：撤销因该审批产生的授权，恢复为“发起审批”以便用户再次申请
        try:
            conn2 = get_db()
            tgt = conn2.execute("SELECT id, perms FROM users WHERE username=?",
                                (row["requester"],)).fetchone()
            if tgt:
                import json as _json
                try:
                    p = _json.loads(tgt["perms"]) if tgt["perms"] else {}
                except Exception:
                    p = {}
                if isinstance(p, dict):
                    blk = row["block_id"]
                    if blk and blk in p and p[blk].get("granted_by_approval") == rid:
                        p[blk]["decision"] = "发起审批"
                        p[blk].pop("granted_by_approval", None)
                        conn2.execute("UPDATE users SET perms=? WHERE id=?",
                                      (_json.dumps(p, ensure_ascii=False), tgt["id"]))
                        conn2.commit()
                conn2.close()
        except Exception as e:
            print("[Approval] 撤销授权失败:", e)
        bump_perm_version(row["requester"])
    else:
        # 单次生效审批仅刷新版本号，不修改 perms
        bump_perm_version(row["requester"])
    return jsonify({"ok": True, "status": new_status})


def _can_delete_approval(conn, username):
    """是否有权限删除审批单。
    权限完全由「职位标签(role)」弹性决定，不绑定具体账号：
      - 职位标签含 管理员 / 总经理 / 副总经理 / 总裁 的人；
      - 以及固定人名 tom（真实且固定的个人）。
    role 由用户在用户列表里自由新增/修改，因此这里只按 role 文字匹配，
    不再硬编码任何具体账号（如 gm*/dgm*）。"""
    if not username:
        return False
    if username == "tom":
        return True
    u = conn.execute("SELECT role FROM users WHERE username=?", (username,)).fetchone()
    role = (u["role"] or "") if u else ""
    for kw in ("管理员", "总经理", "副总经理", "总裁"):
        if kw in role:
            return True
    return False


@app.route("/api/approval-requests/<int:rid>", methods=["DELETE"])
def api_approval_delete(rid):
    username = (request.args.get("username") or "").strip()
    conn = get_db()
    if not _can_delete_approval(conn, username):
        conn.close()
        return jsonify({"ok": False, "msg": "无删除权限"}), 403
    row = conn.execute("SELECT * FROM approval_requests WHERE id=?", (rid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "msg": "not found"}), 404
    conn.execute("DELETE FROM approval_requests WHERE id=?", (rid,))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route("/api/users", methods=["GET"])
def api_users_list():
    conn = get_db()
    managers = set(_manager_usernames(conn))
    rows = conn.execute(
        "SELECT * FROM users ORDER BY sort_order ASC, id ASC"
    ).fetchall()
    users = [_row_to_user(r, managers) for r in rows]
    for u in users:
        u["perms"] = _norm_user_perms(u.get("perms", {}) or {}, conn)
    conn.close()
    return jsonify({"ok": True, "users": users, "managers": sorted(managers)})


# 销售/销售总监的 WON 锁死权限：这 5 项一律强制 decision=hide，
# UI 已锁死下拉，此处兜底所有保存路径（新建/更新），防止任何绕过
SALES_LOCKED_WON_PERMS = ("WON-D2", "WON-D3", "WON-N1", "WON-C1", "WON-P345")

# 用户与权限管理三人审批组（锁死）：任一人审批即结束该流程；三人自己操作免审批（与管理员同级直达）
TRI_APPROVERS = ("tom", "cuong", "james")


def _user_perm_dec(conn, username, bid):
    """读取用户 perms 中某区块的决策；未配置返回 ''。"""
    try:
        r = conn.execute("SELECT perms FROM users WHERE username=?", (username,)).fetchone()
        if not r or not r["perms"]:
            return ""
        p = json.loads(r["perms"])
        return ((p.get(bid) or {}).get("decision") or "")
    except Exception:
        return ""


def _usr_op_gate(conn, op, bid):
    """用户管理写操作闸门。
    返回 'direct'（三人组/管理员，直接执行）、'allow'（被授权，前端应走暂存审批）、'deny'（无权限）。
    未配置的 USR-D* 一律视为隐藏（deny）。"""
    if (op or "").strip().lower() in [x.lower() for x in TRI_APPROVERS]:
        return "direct"
    try:
        if _is_manager(conn, op):
            return "direct"
    except Exception:
        pass
    if _user_perm_dec(conn, op, bid) == "allow":
        return "allow"
    return "deny"

# 观察者固定权限模板：整套权限锁死为此值（审批人保留原有配置）；
# 未列入的区块（审批 APP-*、用户与权限管理 USR-* 等）对观察者一律禁止
OBSERVER_FIXED_PERMS = {
    "DB-S1": "default", "DB-P1": "default", "DB-B1": "default", "DB-C1": "default",
    "US-LH1": "default", "US-LH2": "default",
    "DB-MT1": "default", "DB-FD1": "default", "DB-LS1": "default", "DB-FX1": "default",
    "CRM-L1": "all", "CRM-D1": "default", "CRM-D2": "hide", "CRM-D3": "hide",
    "CRM-F1": "approve", "CRM-N1": "hide", "CRM-E1": "default",
    "WON-L1": "default", "WON-D1": "default", "WON-D2": "hide", "WON-D3": "hide",
    "WON-D4": "default", "WON-E1": "default", "WON-N1": "hide", "WON-C1": "hide",
    "WON-P345": "hide",
    "LOST-L1": "all", "LOST-D1": "default", "LOST-D2": "hide", "LOST-D3": "hide",
    "LOST-R1": "approve", "LOST-E1": "default",
}


def _is_observer_pos(position):
    return (position or "").strip() == "观察者"


def _force_observer_perms(perms, position):
    """观察者：仅作预设——完全未配置的区块按固定模板填初始值；已有配置（管理员改过）一律不动。"""
    try:
        if not _is_observer_pos(position):
            return perms
        if not isinstance(perms, dict):
            perms = {}
        for bid, dec in OBSERVER_FIXED_PERMS.items():
            if bid not in perms:
                perms[bid] = {"decision": dec, "approvers": []}
        return perms
    except Exception:
        return perms


def _force_sales_locked_perms(perms, position):
    try:
        if (position or "").strip() not in ("销售", "销售总监"):
            return perms
        if not isinstance(perms, dict):
            return perms
        for bid in SALES_LOCKED_WON_PERMS:
            blk = perms.get(bid)
            if isinstance(blk, dict):
                blk["decision"] = "hide"
                blk["approvers"] = []
            else:
                perms[bid] = {"decision": "hide", "approvers": []}
    except Exception:
        pass
    return perms


@app.route("/api/users", methods=["POST"])
def api_users_create():
    data = request.get_json(force=True, silent=True) or {}
    # 用户与权限管理闸门：三人组/管理员直达；被授权（USR-D2=允许新增）者由前端走暂存审批（不直达）；
    # 未授权一律拒绝（默认隐藏语义）
    _op = (request.headers.get("X-User-Name") or "").strip()
    _c0 = get_db()
    _gate = _usr_op_gate(_c0, _op, "USR-D2")
    _c0.close()
    # 三人组/管理员直达；allow 用户必须走页面审批流程（服务端拒绝直达，防止绕过审批）
    if _gate != "direct":
        return jsonify({"ok": False, "message": "无权限：新增用户未对你开放" if _gate == "deny" else "该操作需经审批流程，请在页面中提交申请"}), 403
    # 账号一律小写（与登录名一致）：同名不同大小写会导致权限、数据范围、
    # 销售归属统计错乱。前端已限制，这里做服务端兜底，直接调接口也逃不掉。
    username = (data.get("username") or "").strip().lower()
    real_name = (data.get("real_name") or "").strip()
    position = data.get("position") or ""
    status = data.get("status") or "active"
    vis_can_see_me = data.get("vis_can_see_me") or []
    vis_he_can_see = data.get("vis_he_can_see") or []
    perms = data.get("perms") or {}
    forgot_approvers = data.get("forgot_approvers") or ["tom"]
    if not username or not real_name:
        return jsonify({"ok": False, "message": "姓名和账号不能为空"})
    # 账号只允许小写字母和数字（与前端规则一致，接口层面再拦一次）
    if not re.match(r'^[a-z0-9]+$', username):
        return jsonify({"ok": False, "message": "登录账号只能使用小写字母和数字"})
    import json as _json
    conn = get_db()
    perms = _norm_user_perms(perms, conn)
    perms = _force_sales_locked_perms(perms, position)
    perms = _force_observer_perms(perms, position)
    conn = get_db()
    exists = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if exists:
        conn.close()
        return jsonify({"ok": False, "message": "账号已存在"})
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # 忘记密码审批人：默认 tom，可追加（1~3 人）；tom 必在
    fa = [str(x).strip() for x in forgot_approvers if str(x).strip()]
    if "tom" not in fa:
        fa.insert(0, "tom")
    # 新建用户默认排在末尾：取当前最大 sort_order + 1000
    max_so = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM users").fetchone()[0]
    sort_order = int(max_so or 0) + 1000
    cur = conn.execute(
        """INSERT INTO users
           (username, password, real_name, role, position, status,
            vis_can_see_me, vis_he_can_see, perms, forgot_approvers, created_at, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (username, DEFAULT_INIT_PASSWORD, real_name, "user", position, status,
         _json.dumps(vis_can_see_me), _json.dumps(vis_he_can_see),
         _json.dumps(perms), _json.dumps(fa[:3], ensure_ascii=False), created_at, sort_order)
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": new_id, "message": "保存成功"})


@app.route("/api/managers", methods=["GET"])
def api_managers_list():
    conn = get_db()
    managers = sorted(_manager_usernames(conn))
    conn.close()
    return jsonify({"ok": True, "managers": managers})


@app.route("/api/managers", methods=["PUT"])
def api_managers_update():
    """自由任命/撤销管理员。约束：tom 不可被移除；总数 2-4 人。"""
    data = request.get_json(force=True, silent=True) or {}
    managers = [str(x).strip().lower() for x in (data.get("managers") or []) if str(x).strip()]
    managers = sorted(set(managers))
    if "tom" not in managers:
        return jsonify({"ok": False, "message": "tom 必须是管理员之一"}), 400
    if len(managers) < 2 or len(managers) > 4:
        return jsonify({"ok": False, "message": "管理人员数量必须在 2-4 人之间"}), 400
    conn = get_db()
    # 校验所有账号真实存在
    placeholders = ",".join("?" * len(managers))
    existing = {r["username"] for r in conn.execute(f"SELECT username FROM users WHERE username IN ({placeholders})", managers).fetchall()}
    missing = set(managers) - existing
    if missing:
        conn.close()
        return jsonify({"ok": False, "message": f"以下账号不存在: {', '.join(sorted(missing))}"}), 400
    # 原子替换
    conn.execute("DELETE FROM managers")
    for username in managers:
        conn.execute("INSERT INTO managers (username) VALUES (?)", (username,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "managers": managers})


@app.route("/api/users/<int:uid>", methods=["PUT"])
def api_users_update(uid):
    data = request.get_json(force=True, silent=True) or {}
    # 用户与权限管理闸门：三人组/管理员直达；被授权（USR-D1=允许编辑）者由前端走暂存审批（不直达）
    _op = (request.headers.get("X-User-Name") or "").strip()
    _c0 = get_db()
    _gate = _usr_op_gate(_c0, _op, "USR-D1")
    _c0.close()
    if _gate != "direct":
        return jsonify({"ok": False, "message": "无权限：编辑用户权限未对你开放" if _gate == "deny" else "该操作需经审批流程，请在页面中提交申请"}), 403
    real_name = (data.get("real_name") or "").strip()
    position = data.get("position") or ""
    status = data.get("status") or "active"
    vis_can_see_me = data.get("vis_can_see_me") or []
    vis_he_can_see = data.get("vis_he_can_see") or []
    perms = data.get("perms") or {}
    forgot_approvers = data.get("forgot_approvers")
    delegate_to = (data.get("delegate_to") or "").strip()
    if not real_name:
        return jsonify({"ok": False, "message": "姓名不能为空"})
    import json as _json
    conn = get_db()
    perms = _norm_user_perms(perms, conn)
    perms = _force_sales_locked_perms(perms, position)
    perms = _force_observer_perms(perms, position)
    row = conn.execute("SELECT id, position, perms FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "message": "用户不存在"})
    # WON-L1 职位联动兜底：职位从 销售/销售总监 改为其他职位时，
    # 若 WON-L1 决策仍为销售缺省的 hide，则自动改回 default（不覆盖其他决策值）。
    try:
        _old_pos = (row["position"] or "").strip()
        _new_pos = (position or "").strip()
        if _old_pos in ("销售", "销售总监") and _new_pos not in ("销售", "销售总监"):
            blk = perms.get("WON-L1") if isinstance(perms, dict) else None
            if isinstance(blk, dict) and blk.get("decision") == "hide":
                blk["decision"] = "default"
    except Exception:
        pass
    # 不能把离职代理指向自己
    if delegate_to:
        tgt = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        if tgt and tgt["username"] == delegate_to:
            conn.close()
            return jsonify({"ok": False, "message": "离职代理不能设置为本人"})
    # 忘记密码审批人（可选保存；tom 必在，最多 3 人）
    fa_sql = None
    if forgot_approvers is not None:
        fa = [str(x).strip() for x in forgot_approvers if str(x).strip()]
        if "tom" not in fa:
            fa.insert(0, "tom")
        fa_sql = _json.dumps(fa[:3], ensure_ascii=False)
    conn.execute(
        """UPDATE users SET real_name=?, position=?, status=?,
           vis_can_see_me=?, vis_he_can_see=?, perms=?, delegate_to=? WHERE id=?""",
        (real_name, position, status,
         _json.dumps(vis_can_see_me), _json.dumps(vis_he_can_see),
         _json.dumps(perms), delegate_to, uid)
    )
    if fa_sql is not None:
        conn.execute("UPDATE users SET forgot_approvers=? WHERE id=?", (fa_sql, uid))
    conn.commit()
    # 权限/角色/状态变更：刷新目标用户版本号，触发其前端实时刷新
    try:
        tgt = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        if tgt:
            bump_perm_version(tgt["username"])
    except Exception:
        pass
    conn.close()
    return jsonify({"ok": True, "message": "保存成功"})


@app.route("/api/users/<int:uid>", methods=["DELETE"])
def api_users_delete(uid):
    # 用户与权限管理闸门：三人组/管理员直达；被授权（USR-D3=允许删除/停用）者由前端走暂存审批（不直达）
    _op = (request.headers.get("X-User-Name") or "").strip()
    _c0 = get_db()
    _gate = _usr_op_gate(_c0, _op, "USR-D3")
    _c0.close()
    if _gate != "direct":
        return jsonify({"ok": False, "message": "无权限：删除/停用用户未对你开放" if _gate == "deny" else "该操作需经审批流程，请在页面中提交申请"}), 403
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "message": "删除成功"})


@app.route("/api/users/reorder", methods=["PUT"])
def api_users_reorder():
    """调整用户列表顺序：仅 tom/cuong/james 或管理员可执行。"""
    data = request.get_json(force=True, silent=True) or {}
    _op = (request.headers.get("X-User-Name") or "").strip()
    conn = get_db()
    if _op.lower() not in [x.lower() for x in TRI_APPROVERS] and not _is_manager(conn, _op):
        conn.close()
        return jsonify({"ok": False, "message": "无权限：仅管理员或指定审批人可调整顺序"}), 403
    orders = data.get("orders") or []
    for o in orders:
        uid = o.get("id")
        so = o.get("sort_order")
        if uid is None or so is None:
            continue
        conn.execute("UPDATE users SET sort_order=? WHERE id=?", (int(so), int(uid)))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "message": "顺序已保存"})


# ===================== 启动 =====================
@app.after_request
def _no_cache(resp):
    # 禁用浏览器强缓存，确保每次刷新都拿到最新 index.html / JS，避免改了代码却看不到
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

# ===================== 服务端翻译中转（ptTranslateViaGoogle 优先走此端点）=====================
# 目的：翻译请求与系统其它功能走同一条同源通道，绕开浏览器端扩展/证书/网络
#      对 translate.googleapis.com 直连的干扰。
# GET /api/translate?q=<text>&target=<zh|en|vi>  →  {ok:true, text:"..."}
@app.route("/api/translate", methods=["GET"])
def api_translate():
    q = (request.args.get("q") or "")[:1000]
    target = (request.args.get("target") or "en").lower()
    if not q:
        return jsonify({"ok": False, "error": "empty q"}), 400
    if target not in ("zh", "en", "vi"):
        return jsonify({"ok": False, "error": "bad target"}), 400
    try:
        u = ("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl="
             + urllib.parse.quote(target) + "&dt=t&q=" + urllib.parse.quote(q))
        _req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(_req, timeout=8) as _resp:
            _data = json.loads(_resp.read().decode("utf-8"))
        _text = "".join(seg[0] for seg in (_data[0] or []) if seg and seg[0])
        return jsonify({"ok": True, "text": _text})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502

# ===================== 金属价格走势 + 历史汇率（免费数据源：雅虎财经，无需 API Key）=====================
# 4 个品种：中国铁(铁矿石) / 不锈钢(热轧卷板) / 锌锭 / 塑料(石化原料)，均为国际真实基准价（USD/吨）。
# 价格以 USD 为基准，按【真实的每日历史汇率】换算为 RMB / VND，使走势与同期汇率对应。
# 历史汇率：USDCNY=X（USD→人民币）、USDVND=X（USD→越南盾），CNY→VND 由二者推导。
# 数据每日缓存到 SQLite(metal_cache / fx_cache)，避免频繁外网请求；外网不可达时回退缓存。
# ⛔⛔⛔ 2026-09-04 整体冻结声明（锁死）：金属/汇率这条价格管线的采集、换算、离群点守卫逻辑
# 已校验通过，四个品种（铁/不锈钢/锌/塑料）走势单位对齐(USD/吨)、数值正确。
# 严禁在未取得用户明确同意前对以下任一处做"优化/重构/简化"：METAL_SYMBOLS、
# METAL_OFFICIAL_CODES、METAL_TO_TON_FACTOR、_metal_clean_outliers 及其两处调用点。
# 任何改动都可能重新引入单位错位或脏数据，导致图表再次失真。
import urllib.request
import urllib.error
import urllib.parse

METAL_SYMBOLS = {
    "iron": "HRC=F",      # 热轧卷板（代表钢铁/钢材成品基准价，USD/吨）
    "stainless": "HRC=F", # 热轧卷板（作为不锈钢上游替代指标，USD/吨）
    "zinc": "ZNC=F",      # LME 锌锭（USD/吨）
    "plastic": "BZ=F",    # 布伦特原油（代表塑料原料，原始 USD/桶，需换算为 USD/吨）
}
# 官方月度数据源（IMF Primary Commodity Price System，免费、无需 API Key）
# 前缀 P 表示 actual market price（美元实际价）。若 IMF 返回为空，自动回退 Yahoo。
# 注：stainless 与 plastic 在 IMF PCPS 中暂无公认独立代码，暂用 Yahoo 期货，后续可按需求换 World Bank。
METAL_OFFICIAL_CODES = {
    "iron": "PIORECR",    # 铁矿石，美元/吨
    "zinc": "PZINC",      # 锌，美元/吨
}
# 各品种原始 Yahoo 单位 -> 标准化 USD/吨 的换算系数（缓存中存原始值，渲染时换算）
# iron/stainless/zinc 原始已是 USD/吨，系数 1.0
# plastic(BZ=F 布伦特原油) 原始是 USD/桶，1 吨 ≈ 7.33 桶（原油密度折算），系数 7.33
METAL_TO_TON_FACTOR = {
    "iron": 1.0,
    "stainless": 1.0,
    "zinc": 1.0,
    "plastic": 7.33,   # 桶 -> 吨：1 吨原油 ≈ 7.33 桶
}
# 各品种原始单位说明（用于前端展示）
METAL_RAW_UNIT = {
    "iron": "USD/ton",
    "stainless": "USD/ton",
    "zinc": "USD/ton",
    "plastic": "USD/barrel",
}
FX_SYMBOLS = {
    "USDCNY": "USDCNY=X",  # 1 USD = ? CNY（真实历史）
    "USDVND": "USDVND=X",  # 1 USD = ? VND（真实历史）
    "USDPHP": "USDPHP=X",  # 1 USD = ? PHP（真实历史；菲律宾用）
}

# 当 Yahoo 无某月历史汇率时的本地回退（近似值，仅用于菲律宾 PHP 等少数缺数情形）
FX_LCU_PER_USD_FALLBACK = {
    "USDPHP": {
        "2021": 50.3, "2022": 54.4, "2023": 55.8, "2024": 57.2,
        "2025": 57.8, "2026": 58.5,   # 2026 全年用 58.5 近似（含 2026-08）
    },
}

# ===================== 大宗饲料原料价格 =====================
# 国际市场数据源：CBOT 期货（雅虎财经免费源）。
# 重要单位修正：
#   - 玉米 ZC=F / 大豆 ZS=F 报价单位为「美分/蒲式耳」(currency=USX)，需 ×39.37/100 换算为 USD/吨
#   - 豆粕 ZM=F 报价单位为「美元/短吨」(currency=USD)，需 ×1.102 换算为 USD/吨（1 短吨≈0.907 公吨）
# 中国/越南价格 = 国际 USD/吨基准 × 区域升贴水(basis，小幅 ±5~10%) 后按真实历史汇率换算到本币。
# DDGS 无液态期货，以豆粕 × 0.9 近似（DDGS 历史价约为豆粕的 90%）。
FEED_ITEMS = {
    # 2026-08-25 按用户提供的 CNF 到岸价重新校准：
    #   CBOT 玉米 ≈203 USD/吨，大豆 ≈446 USD/吨，豆粕 SM≈390 USD/吨，DDGS 美湾锚点 300 USD/吨。
    #   系数 = 目标到岸价 ÷ CBOT 基准，用于把实时 CBOT 裸价映射到各国 CNF 到岸价。
    "corn":     {"sym": "ZC=F", "unit_factor": 0.3937, "china_basis": 1.424, "vn_basis": 1.365, "unit": "USD/ton"},
    "soybean":  {"sym": "ZS=F", "unit_factor": 0.3937, "china_basis": 1.359, "vn_basis": 1.332, "unit": "USD/ton"},
    "soymeal":  {"sym": "ZM=F", "unit_factor": 1.102,  "china_basis": 1.205, "vn_basis": 1.174, "unit": "USD/ton"},
    "ddgs":     {"sym": "ZM=F", "ddgs_ratio": 0.9, "unit_factor": 1.102, "china_basis": 1.083, "vn_basis": 1.083, "unit": "USD/ton"},
}
# 各曲线原生货币：国际=USD，中国=RMB，越南=VND
FEED_CURVE_NATIVE = {"intl": "USD", "china": "RMB", "vietnam": "VND"}

# 13/14 国当地 DDP 采购价：用 CBOT 国际基准 × 到岸升贴水系数模拟。
# 因 Yahoo 免费源无法提供各国现货 DDP，此处使用行业经验系数（海运+关税+内陆物流）。
# key 为国家代码；name 为三语名称；basis 为对国际 USD/吨的升贴水倍数。
FEED_COUNTRY_BASIS = {
    # 2026-08-25 按用户提供的 CNF 到岸价重新校准。
    # 系数 = 目标到岸价 ÷ CBOT 基准；基准：corn=203, soybean=446, soymeal=390, ddgs=300。
    "TH": {"name": {"zh": "泰国", "en": "Thailand", "vi": "Thái Lan"}, "basis": {"corn": 1.374, "soybean": 1.336, "soymeal": 1.179, "ddgs": 1.083}},
    "MM": {"name": {"zh": "缅甸", "en": "Myanmar", "vi": "Myanmar"}, "basis": {"corn": 1.384, "soybean": 1.341, "soymeal": 1.185, "ddgs": 1.083}},
    "LA": {"name": {"zh": "老挝", "en": "Laos", "vi": "Lào"}, "basis": {"corn": 1.399, "soybean": 1.348, "soymeal": 1.192, "ddgs": 1.083}},
    "KH": {"name": {"zh": "柬埔寨", "en": "Cambodia", "vi": "Campuchia"}, "basis": {"corn": 1.379, "soybean": 1.339, "soymeal": 1.182, "ddgs": 1.083}},
    "IN": {"name": {"zh": "印度", "en": "India", "vi": "Ấn Độ"}, "basis": {"corn": 1.394, "soybean": 1.345, "soymeal": 1.190, "ddgs": 1.083}},
    "BD": {"name": {"zh": "孟加拉", "en": "Bangladesh", "vi": "Bangladesh"}, "basis": {"corn": 1.389, "soybean": 1.343, "soymeal": 1.187, "ddgs": 1.083}},
    "ID": {"name": {"zh": "印尼", "en": "Indonesia", "vi": "Indonesia"}, "basis": {"corn": 1.369, "soybean": 1.334, "soymeal": 1.177, "ddgs": 1.083}},
    "MY": {"name": {"zh": "马来西亚", "en": "Malaysia", "vi": "Malaysia"}, "basis": {"corn": 1.360, "soybean": 1.330, "soymeal": 1.172, "ddgs": 1.083}},
    "PH": {"name": {"zh": "菲律宾", "en": "Philippines", "vi": "Philippines"}, "basis": {"corn": 1.384, "soybean": 1.341, "soymeal": 1.185, "ddgs": 1.083}},
    "NP": {"name": {"zh": "尼泊尔", "en": "Nepal", "vi": "Nepal"}, "basis": {"corn": 1.414, "soybean": 1.354, "soymeal": 1.200, "ddgs": 1.083}},
    "LK": {"name": {"zh": "斯里兰卡", "en": "Sri Lanka", "vi": "Sri Lanka"}, "basis": {"corn": 1.394, "soybean": 1.345, "soymeal": 1.190, "ddgs": 1.083}},
    "KR": {"name": {"zh": "韩国", "en": "South Korea", "vi": "Hàn Quốc"}, "basis": {"corn": 1.404, "soybean": 1.350, "soymeal": 1.195, "ddgs": 1.083}},
    "JP": {"name": {"zh": "日本", "en": "Japan", "vi": "Nhật Bản"}, "basis": {"corn": 1.399, "soybean": 1.348, "soymeal": 1.197, "ddgs": 1.083}},
    "AU": {"name": {"zh": "澳大利亚", "en": "Australia", "vi": "Úc"}, "basis": {"corn": 1.448, "soybean": 1.370, "soymeal": 1.223, "ddgs": 1.083}},
}

# 短期内存缓存：避免货币/语言切换时重复拉外网（60s TTL）
_API_CACHE = {}

# 2026-08-25 用户校准锚点：玉米/大豆/豆粕/DDGS 的 USD/吨 目标裸价。
# 因 Yahoo 实时 CBOT 与用户给出的行业参考价存在偏差，此锚点仅用于覆盖当月（2026-08）
# 的最新价格，使看板在该时点显示与用户调研一致的价格；历史月份仍使用缓存数据。
FEED_ANCHOR_202608 = {"corn": 203.0, "soybean": 446.0, "soymeal": 390.0, "ddgs": 300.0}

# ===== 2026-08-25 用户提供的真实 CNF 到岸价锚点（USD/吨，各国当月绝对价格） =====
# 这是用户经市场调研确认的到岸价（含海运费、到港基准，不含目的国进口关税/增值税/内陆运）。
# 当月（2026-08）每个国家的价格直接取此表中的绝对价，不再用系数推导。
# 键为国家代码，值为 {玉米:价, 大豆:价, 豆粕:价, DDGS:价}。CN 为中国、VN 为越南。
# 取值口径：用户表为「美湾/巴西」两列，本锚点取两者中较高者（保守到岸价）。
FEED_CNF_ANCHOR = {
    "CN": {"corn": 289.0, "soybean": 606.0, "soymeal": 470.0, "ddgs": 325.0},
    "VN": {"corn": 277.0, "soybean": 594.0, "soymeal": 458.0, "ddgs": 325.0},
    "TH": {"corn": 279.0, "soybean": 596.0, "soymeal": 460.0, "ddgs": 325.0},
    "MM": {"corn": 281.0, "soybean": 598.0, "soymeal": 462.0, "ddgs": 325.0},
    "LA": {"corn": 284.0, "soybean": 601.0, "soymeal": 465.0, "ddgs": 325.0},
    "KH": {"corn": 280.0, "soybean": 597.0, "soymeal": 461.0, "ddgs": 325.0},
    "IN": {"corn": 283.0, "soybean": 600.0, "soymeal": 464.0, "ddgs": 325.0},
    "BD": {"corn": 282.0, "soybean": 599.0, "soymeal": 463.0, "ddgs": 325.0},
    "ID": {"corn": 278.0, "soybean": 595.0, "soymeal": 459.0, "ddgs": 325.0},
    "MY": {"corn": 276.0, "soybean": 593.0, "soymeal": 457.0, "ddgs": 325.0},
    "PH": {"corn": 281.0, "soybean": 598.0, "soymeal": 462.0, "ddgs": 325.0},
    "NP": {"corn": 287.0, "soybean": 604.0, "soymeal": 468.0, "ddgs": 325.0},
    "LK": {"corn": 283.0, "soybean": 600.0, "soymeal": 464.0, "ddgs": 325.0},
    "KR": {"corn": 285.0, "soybean": 602.0, "soymeal": 466.0, "ddgs": 325.0},
    "JP": {"corn": 284.0, "soybean": 601.0, "soymeal": 467.0, "ddgs": 325.0},
    "AU": {"corn": 294.0, "soybean": 611.0, "soymeal": 477.0, "ddgs": 325.0},
}

# ===== 2026-08-25 玉米本币现货价锚点（CNY/吨，用户提供） =====
# 玉米改用「本币现货价」口径（国内大宗批发/完税到岸），单位为 CNY/吨。
# 看板 RMB 模式直接显示此值；USD/VND 模式按实时汇率换算。
# 其他品种（大豆/豆粕/DDGS）仍用 FEED_CNF_ANCHOR（USD/吨）口径。
FEED_CNY_CORN_ANCHOR = {
    "CN": 2340.0, "VN": 2130.0, "TH": 2200.0, "MM": 1950.0, "LA": 2000.0,
    "KH": 2050.0, "IN": 1700.0, "BD": 1960.0, "ID": 1778.0, "MY": 1880.0,
    "PH": 1819.0, "NP": 2120.0, "LK": 2080.0, "KR": 2150.0, "JP": 2250.0,
    "AU": 2300.0,
}

# ===== 2026-08-25 大豆本币现货价锚点（CNY/吨，用户提供） =====
# 大豆改用「本币现货价」口径（进口分销/国内大宗批发），单位为 CNY/吨。
# 看板 RMB 模式直接显示此值；USD/VND 模式按实时汇率换算。
FEED_CNY_SOYBEAN_ANCHOR = {
    "CN": 4260.0, "VN": 4380.0, "TH": 4400.0, "MM": 4300.0, "LA": 4250.0,
    "KH": 4300.0, "IN": 5600.0, "BD": 5100.0, "ID": 4420.0, "MY": 4480.0,
    "PH": 4440.0, "NP": 5350.0, "LK": 5150.0, "KR": 4600.0, "JP": 4700.0,
    "AU": 4700.0,
}

# ===== 2026-08-25 豆粕(43%蛋白)本币现货价锚点（CNY/吨，用户提供） =====
# 豆粕改用「本币现货价」口径（进口分销/国内大宗批发），单位为 CNY/吨。
FEED_CNY_SOYMEAL_ANCHOR = {
    "CN": 3140.0, "VN": 3420.0, "TH": 3440.0, "MM": 3400.0, "LA": 3500.0,
    "KH": 3520.0, "IN": 3650.0, "BD": 3650.0, "ID": 3460.0, "MY": 3480.0,
    "PH": 3500.0, "NP": 3900.0, "LK": 3800.0, "KR": 3600.0, "JP": 3680.0,
    "AU": 3850.0,
}

# ===== 2026-08-25 DDGS 本币现货价锚点（CNY/吨，用户提供） =====
# DDGS 改用「本币现货价」口径（进口分销/国产酒精厂出厂），单位为 CNY/吨。
# ============================================================
# 畜禽出栏价格（生猪/鸡蛋/白羽肉鸡）
# 数据源策略：
#   1) 国际基准：CBOT 瘦肉猪期货 (HE=F)、鸡蛋期货 (DC=F)
#   2) 国别锚点：每月公开研报/行业网站给出的国别现货价（CNY/吨，本币口径）
#   3) 历史回填：CBOT × 国别系数 + 真实锚点一次性校准（与饲料原料一致）
# ============================================================

# 单位说明：
# - 生猪出栏价：CNY/头（典型体重 110-120kg，本币结算）
# - 鸡蛋出栏价：CNY/500克（盒装；本币结算）
# - 白羽肉鸡出栏价：CNY/只（出栏均重约2.5kg；本币结算）
# 价格级别：CN/越南/泰国按公开行情；其他国家以2026-08为锚点月度均价。

# ---- 生猪出栏价（CNY/公斤，元/kg，出栏均重约 120kg）----
LIVESTOCK_CNY_PIG_ANCHOR = {
    "CN": 15.42, "VN": 22.92, "TH": 20.00, "MM": 24.17, "LA": 25.83,
    "KH": 23.33, "IN": 18.33, "BD": 21.67, "ID": 20.83, "MY": 19.17,
    "PH": 22.50, "NP": 22.08, "LK": 23.75, "KR": 17.50, "JP": 15.83,
    "AU": 17.08,
}

# ---- 鸡蛋出栏价（CNY/公斤，÷2 换算自元/500g）----
LIVESTOCK_CNY_EGG_ANCHOR = {
    "CN": 9.60, "VN": 10.40, "TH": 11.00, "MM": 12.40, "LA": 13.60,
    "KH": 13.00, "IN": 11.60, "BD": 12.20, "ID": 11.80, "MY": 10.80,
    "PH": 12.60, "NP": 12.80, "LK": 13.20, "KR": 10.20, "JP": 10.60,
    "AU": 11.40,
}

# ---- 白羽肉鸡出栏价（CNY/公斤，出栏均重 2.5kg）----
LIVESTOCK_CNY_CHICKEN_ANCHOR = {
    "CN": 8.80, "VN": 11.20, "TH": 10.40, "MM": 12.80, "LA": 14.00,
    "KH": 12.00, "IN": 10.80, "BD": 12.40, "ID": 10.40, "MY": 9.60,
    "PH": 12.00, "NP": 13.20, "LK": 13.60, "KR": 9.20, "JP": 8.40,
    "AU": 10.00,
}

# Yahoo Finance 期货符号（瘦肉猪/鸡蛋），用于历史 CBOT 相对比例
LIVESTOCK_YAHOO_SYMBOLS = {
    "pig": "HE=F",       # Lean Hogs Futures
    "egg": "DC=F",       # Eggs Futures (CME)
}

# 畜禽品种元数据（统一口径：元/公斤 = CNY/kg）
LIVESTOCK_ITEMS = {
    "pig": {
        "name": {"zh": "生猪出栏价", "en": "Pig (Live)", "vi": "Heo (xuất chuồng)"},
        "unit": {"zh": "元/公斤", "en": "CNY/kg", "vi": "CNY/kg"},
        "yahoo": "HE=F",
        "anchor": LIVESTOCK_CNY_PIG_ANCHOR,
        "unit_factor": 1.0,
        "intl_floor_cny": 14.0,
    },
    "egg": {
        "name": {"zh": "鸡蛋出栏价", "en": "Egg (Carton)", "vi": "Trứng (xuất chuồng)"},
        "unit": {"zh": "元/公斤", "en": "CNY/kg", "vi": "CNY/kg"},
        "yahoo": "DC=F",
        "anchor": LIVESTOCK_CNY_EGG_ANCHOR,
        "unit_factor": 1.0,
        "intl_floor_cny": 9.0,
    },
    "chicken": {
        "name": {"zh": "白羽肉鸡出栏价", "en": "Broiler (Live)", "vi": "Gà trắng (xuất chuồng)"},
        "unit": {"zh": "元/公斤", "en": "CNY/kg", "vi": "CNY/kg"},
        "yahoo": None,  # 暂无统一期货代码，用 pig 比例近似 + 国别锚点
        "anchor": LIVESTOCK_CNY_CHICKEN_ANCHOR,
        "unit_factor": 1.0,
        "intl_floor_cny": 8.0,
    },
}

# 畜禽国家：与 collect_livestock.py 一致
LIVESTOCK_COUNTRY_CODES = ['CN','VN','TH','PH','ID','MY','BD','IN','RU','BR']

# 国家三语名称表（供畜禽 API 返回）
LIVESTOCK_COUNTRY_NAMES = {
    "CN": {"zh": "中国", "en": "China", "vi": "Trung Quốc"},
    "VN": {"zh": "越南", "en": "Vietnam", "vi": "Việt Nam"},
    "TH": {"zh": "泰国", "en": "Thailand", "vi": "Thái Lan"},
    "PH": {"zh": "菲律宾", "en": "Philippines", "vi": "Philippines"},
    "ID": {"zh": "印尼", "en": "Indonesia", "vi": "Indonesia"},
    "MY": {"zh": "马来西亚", "en": "Malaysia", "vi": "Malaysia"},
    "BD": {"zh": "孟加拉", "en": "Bangladesh", "vi": "Bangladesh"},
    "IN": {"zh": "印度", "en": "India", "vi": "India"},
    "RU": {"zh": "俄罗斯", "en": "Russia", "vi": "Nga"},
    "BR": {"zh": "巴西", "en": "Brazil", "vi": "Brazil"},
}

# 畜禽与饲料共享：pig ~ pig futures, egg ~ egg futures, chicken 用 pig 作近似波动源
LIVESTOCK_PROXY_SYMBOL = {
    "pig": "HE=F",
    "egg": "DC=F",
    "chicken": "HE=F",  # 肉鸡波动与瘦肉猪高相关；用 pig 比例近似
}

# ============================================================

# ============================================================
# 畜禽真实数据（仅中越两国）
# ------------------------------------------------------------
# 数据直接来自 collect_livestock.py 产出的真实表：
#   livestock_farmgate（出栏价 USD/kg）、livestock_retail（终端零售 USD/kg）
# 抓取源：CN=行情宝(生猪)/博亚和讯(鸡蛋·肉鸡)；VN=GREENFEED(每周)/agro.gov.vn 兜底。
# 其余国家（JP/KR/AU/TH/...）数据已移除，待新思路另行接入。
# ============================================================

# ---- DB 固化历史表 ----
# ---- 畜禽数据统一读取：直接复用 collect_livestock.py 产出的真实表 ----
# 仅中越两国（LIVESTOCK_COUNTRY_CODES=['CN','VN']），数据来自：
#   livestock_farmgate（出栏价 USD/kg，真实抓取：CN=行情宝/博亚和讯，VN=GREENFEED/agro.gov.vn）
#   livestock_retail（终端零售 USD/kg）
# 不再维护独立的 livestock_history / CBOT 形态 / FAOSTAT / NECC / MAFF / MLA 等重复体系。


def _livestock_write_month(conn, item, country, ym, price_usd, source="manual"):
    """手动补数：写入 livestock_retail 作为 collected 源，供 collect_livestock 后续纳入。"""
    conn.execute("""CREATE TABLE IF NOT EXISTS livestock_retail (
        item TEXT, country TEXT, ym TEXT,
        price_usd REAL, source_name TEXT, source_url TEXT,
        method TEXT, unit TEXT, note TEXT,
        PRIMARY KEY(item, country, ym))""")
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("""INSERT OR REPLACE INTO livestock_retail
      (item,country,ym,price_usd,source_name,source_url,method,unit,note) VALUES(?,?,?,?,?,?,?,?,?)""",
      (item, country, ym, round(price_usd, 4), "manual:%s" % source, "", "manual", "kg", ts))
    conn.commit()


# ---- 主构建函数：直接读取真实表 ----
def _livestock_real_build_data(conn, cur):
    # 读取 collect_livestock.py 产出的真实表（USD/kg）。优先 farmgate，缺失回退 retail。
    fg = {}; rt = {}
    for item, cc, ym, usd in conn.execute(
        "SELECT item,country,ym,price_usd FROM livestock_farmgate WHERE price_usd IS NOT NULL").fetchall():
        fg.setdefault(item, {}).setdefault(cc, {})[ym] = float(usd)
    for item, cc, ym, usd in conn.execute(
        "SELECT item,country,ym,price_usd FROM livestock_retail WHERE price_usd IS NOT NULL").fetchall():
        rt.setdefault(item, {}).setdefault(cc, {})[ym] = float(usd)

    all_ym = set()
    for d in (fg, rt):
        for itd in d.values():
            for ccd in itd.values(): all_ym.update(ccd.keys())
    labels = sorted(all_ym) if all_ym else ["2026-08"]

    # 历史+当月 100% 读 SQLite 固化汇率缓存（秒开）；当月缺失后台补抓
    fx = _fx_load_cache(conn)
    now_ym = datetime.now().strftime("%Y-%m")
    if not _month_has_data(fx, FX_SYMBOLS.keys(), now_ym):
        _kick_market_warm()
    def _bidir_fill(src, labs):
        f = _forward_fill(src, labs); last = None
        for i in range(len(f)-1,-1,-1):
            if f[i] is not None: last = f[i]
            elif last is not None: f[i] = last
        return f
    usdcny = _bidir_fill(fx.get("USDCNY",{}), labels)
    usdvnd = _bidir_fill(fx.get("USDVND",{}), labels)

    # 真实数据已是 USD/kg；内部先换算为 CNY/kg 再按 cur 输出，复用既有转换逻辑
    def _usd_to_target(usd_v, idx):
        if usd_v is None: return None
        cf = usdcny[idx] if idx < len(usdcny) and usdcny[idx] else 7.1
        cny_v = usd_v * cf
        if cur == "RMB": return round(cny_v, 2)
        if cur == "USD": return round(usd_v, 2)
        if cur == "VND":
            vf = usdvnd[idx] if idx < len(usdvnd) and usdvnd[idx] else 23000.0
            return round(usd_v * vf, 2)
        return round(cny_v, 2)

    series = {}
    for item in LIVESTOCK_ITEMS:
        series[item] = {}
        for cc in LIVESTOCK_COUNTRY_CODES:
            idata = fg.get(item, {}).get(cc) or rt.get(item, {}).get(cc) or {}
            arr = [round(_usd_to_target(idata.get(ym), j), 2) if idata.get(ym) is not None else None
                   for j, ym in enumerate(labels)]
            series[item][cc] = arr
    return {"labels": labels, "series": series}



@app.route("/api/livestock-prices")
def api_livestock_prices():
    """畜禽出栏价 API：16国 × 3品种，月度，5年历史；按 cur 切换 RMB/USD/VND。"""
    cur = (request.args.get("cur") or "RMB").upper()
    if cur not in ("USD", "RMB", "VND"):
        cur = "RMB"
    cache_key = "livestock_" + cur
    cached = _API_CACHE.get(cache_key)
    if cached and (time.time() - cached[0] < 60):
        return jsonify(cached[1])
    conn = get_db()
    try:
        # 真实数据源：历史固化 + 自动更新（新数据优先，缺失月份用锚点+CBOT 补充）
        raw = _livestock_real_build_data(conn, cur)
    finally:
        conn.close()

    labels = raw["labels"]
    series = raw["series"]

    # 展平为 {_monthly_avg 期望的格式: {flat_key: [list]}}
    flat_series = {}
    key_map = []  # [(flat_key, item, ccode)]
    for item in series:
        for ccode in series[item]:
            fk = item + "|" + ccode
            flat_series[fk] = series[item][ccode]
            key_map.append((fk, item, ccode))

    # 月度聚合
    monthly_labels, monthly_flat = _monthly_avg(labels, flat_series)

    # 2026-08 校准：用当月最后一天的每日真实价直接覆盖月度均值
    # 这样保证"锚点月"显示 = 锚点真实价，避免月度聚合把中旬数据拉低
    if monthly_labels and monthly_labels[-1] == "2026-08" and raw.get("labels"):
        last_day_label = raw["labels"][-1]
        if last_day_label[:7] == "2026-08":
            for fk, item, ccode in key_map:
                daily_arr = raw["series"].get(item, {}).get(ccode, [])
                if daily_arr:
                    monthly_flat[fk][-1] = daily_arr[-1]

    # 跨品种统一波峰波谷降采样（与饲料一致）
    pv_labels, pv_flat = _peak_valley(monthly_labels, monthly_flat)

    pv_series = {it: {} for it in series}
    for fk, item, ccode in key_map:
        pv_series[item][ccode] = pv_flat.get(fk, [])

    resp = {
        "ok": True,
        "cur": cur,
        "labels": pv_labels,
        "series": pv_series,
        "data_source": "real_anchor_cbot_shape",  # 真实国别锚点 × 国际真实价格形态(CBOT)；非CPI推演
        "items": {
            k: {
                "name": v["name"],
                "unit": v["unit"],
                "anchor_month": "2026-08",
            }
            for k, v in LIVESTOCK_ITEMS.items()
        },
        "countries": {
            code: {"name": LIVESTOCK_COUNTRY_NAMES.get(code, {"zh": code, "en": code, "vi": code})}
            for code in LIVESTOCK_COUNTRY_CODES
        },
    }
    obj = jsonify(resp)
    obj.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    obj.headers["Pragma"] = "no-cache"
    _API_CACHE[cache_key] = (time.time(), resp)
    return obj


@app.route("/api/livestock-farmgate")
def api_livestock_farmgate():
    """畜禽出栏价（真实采集 + 断点补全）API。
    数据来自 collect_livestock.py 写入的 livestock_farmgate 表：
      - 单位 USD/kg（按 cur 可切 RMB/VND）
      - 每月第一天的值；method 标注 collected(真实/FAO/锚点种子)/gap_fill/anchor
      - formula 记录每个值的推算逻辑；source_url 记录数据源
    混合模式：英文API国家(CN/VN优先出栏价; JP/KR/AU/FAOSTAT)自动拉真实值，
              其余国家由用户手动补（见 livestock_retail_seed.csv）。
    """
    cur = (request.args.get("cur") or "USD").upper()
    if cur not in ("USD", "RMB", "VND"):
        cur = "USD"
    items = ["pig", "egg", "chicken"]
    countries = LIVESTOCK_COUNTRY_CODES
    conn = get_db()
    # FX 因子（USD -> target），按月首日
    fx = _fx_build_data(conn)
    # 直接用每日序列取每月首日的因子
    def factor_for(ym):
        # ym: YYYY-MM；取该月第一天对应因子
        day = ym + "-01"
        if cur == "USD":
            return 1.0
        src = fx.get("USDCNY" if cur == "RMB" else "USDVND", {})
        # 前向找最近因子
        import datetime as _dt
        y, m = int(ym[:4]), int(ym[5:7])
        for _ in range(0, 400):
            key = "%04d-%02d-%02d" % (y, m, 1)
            if key in src and src[key]:
                return float(src[key])
            # 前推一天
            d = _dt.date(y, m, 1)
            d = d - _dt.timedelta(days=1)
            y, m = d.year, d.month
        return 1.0

    labels = []
    # 取全量月份范围（2021-01 ~ 2026-08）
    rows = conn.execute("SELECT DISTINCT ym FROM livestock_farmgate ORDER BY ym").fetchall()
    labels = [r[0] for r in rows]

    series = {it: {} for it in items}
    meta = {it: {} for it in items}  # 记录每个 country 的 method 分布/来源
    for it in items:
        for cc in countries:
            fg = conn.execute(
                "SELECT ym,price_usd,method,formula,source_url FROM livestock_farmgate "
                "WHERE item=? AND country=? ORDER BY ym", (it, cc)).fetchall()
            arr = []
            for ym, usd, method, formula, surl in fg:
                if usd is None:
                    arr.append(None)
                    continue
                f = factor_for(ym)
                arr.append(round(usd * f, 4))
            series[it][cc] = arr
            # 来源与口径
            first = conn.execute(
                "SELECT source_url,method FROM livestock_farmgate "
                "WHERE item=? AND country=? AND price_usd IS NOT NULL ORDER BY ym LIMIT 1",
                (it, cc)).fetchone()
            meta[it][cc] = {
                "source_url": first[0] if first else "",
                "method": first[1] if first else "anchor",
                "unit": "USD/kg" if cur == "USD" else ("CNY/kg" if cur == "RMB" else "VND/kg"),
            }

    resp = {
        "ok": True,
        "cur": cur,
        "labels": labels,
        "series": series,
        "meta": meta,
        "markup": {"pig": 0.40, "egg": 0.30, "chicken": 0.35},
        "items": {
            k: {"name": v["name"], "unit": v["unit"], "anchor_month": "2026-08"}
            for k, v in LIVESTOCK_ITEMS.items()
        },
        "countries": {
            code: {"name": LIVESTOCK_COUNTRY_NAMES.get(code, {"zh": code, "en": code, "vi": code})}
            for code in countries
        },
        "data_source": "real_retail_backout_or_direct + gap_fill (collect_livestock.py)",
    }
    conn.close()
    return jsonify(resp)


@app.route("/api/livestock-retail-raw")
def api_livestock_retail_raw():
    """返回 collect_livestock 采集到的零售/市场原始价（含 manual_needed 待补）"""
    conn = get_db()
    rows = conn.execute(
        "SELECT item,country,ym,price_usd,unit,source_name,source_url,note "
        "FROM livestock_retail ORDER BY item,country,ym").fetchall()
    out = [dict(item=r[0], country=r[1], ym=r[2], price_usd=r[3], unit=r[4],
                source_name=r[5], source_url=r[6], note=r[7]) for r in rows]
    conn.close()
    return jsonify({"ok": True, "count": len(out), "rows": out})


@app.route('/api/livestock-ingest', methods=['POST'])
def api_livestock_ingest():
    """录入真实畜禽价格（手动数据优先于锚点+CBOT）。
    请求体 JSON：
      [{"item":"pig","country":"VN","year_month":"2026-08","price_cny":22.92,"source":"越南畜牧协会"},
       ...]
    或单次：
      {"item":"pig","country":"VN","year_month":"2026-08","price_cny":22.92,"source":"..."}
    价格单位固定：元/公斤 (CNY/kg)。"""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"ok": False, "error": "invalid json"}), 400
    if isinstance(data, dict):
        data = [data]
    valid_items = set(LIVESTOCK_ITEMS.keys())
    valid_cc = set(LIVESTOCK_COUNTRY_CODES)
    conn = get_db()
    try:
        inserted = 0
        skipped = 0
        for row in data:
            item = str(row.get("item", "")).strip().lower()
            cc = str(row.get("country", "")).strip().upper()
            ym = str(row.get("year_month", "")).strip()
            pc = row.get("price_cny")
            src = str(row.get("source", "manual")).strip() or "manual"
            if item not in valid_items or cc not in valid_cc:
                skipped += 1
                continue
            if not (len(ym) == 7 and ym[4] == "-"):
                skipped += 1
                continue
            try:
                price = float(pc)
            except Exception:
                skipped += 1
                continue
            _livestock_write_month(conn, item, cc, ym, price, source="manual:%s" % src)
            inserted += 1
    finally:
        conn.close()
    # 清除缓存，让下次请求立即生效
    _API_CACHE.pop("livestock_RMB", None)
    _API_CACHE.pop("livestock_USD", None)
    _API_CACHE.pop("livestock_VND", None)
    return jsonify({"ok": True, "inserted": inserted, "skipped": skipped})

FEED_CNY_DDGS_ANCHOR = {
    "CN": 2200.0, "VN": 2480.0, "TH": 2500.0, "MM": 2450.0, "LA": 2550.0,
    "KH": 2580.0, "IN": 2400.0, "BD": 2500.0, "ID": 2500.0, "MY": 2520.0,
    "PH": 2540.0, "NP": 2850.0, "LK": 2750.0, "KR": 2620.0, "JP": 2680.0,
    "AU": 2800.0,
}

def _metal_cache_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS metal_cache (
        symbol TEXT, date TEXT, close REAL,
        PRIMARY KEY(symbol, date))""")
    conn.commit()

def _metal_load_cache(conn):
    """读取本地缓存：{symbol: {date: close_usd}}。"""
    _metal_cache_table(conn)
    cur = conn.execute("SELECT symbol, date, close FROM metal_cache")
    out = {}
    for sym, d, c in cur.fetchall():
        out.setdefault(sym, {})[d] = c
    return out

def _metal_save_cache(conn, data):
    """data: {symbol: {date: close_usd}}。"""
    _metal_cache_table(conn)
    rows = []
    for sym, m in data.items():
        for d, c in m.items():
            rows.append((sym, d, c))
    if rows:
        conn.executemany("INSERT OR REPLACE INTO metal_cache(symbol, date, close) VALUES(?,?,?)", rows)
        conn.commit()

def _fx_cache_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS fx_cache (
        pair TEXT, date TEXT, rate REAL,
        PRIMARY KEY(pair, date))""")
    conn.commit()

def _fx_load_cache(conn):
    _fx_cache_table(conn)
    cur = conn.execute("SELECT pair, date, rate FROM fx_cache")
    out = {}
    for pair, d, r in cur.fetchall():
        out.setdefault(pair, {})[d] = r
    return out

def _fx_save_cache(conn, data):
    _fx_cache_table(conn)
    rows = []
    for pair, m in data.items():
        for d, r in m.items():
            rows.append((pair, d, r))
    if rows:
        conn.executemany("INSERT OR REPLACE INTO fx_cache(pair, date, rate) VALUES(?,?,?)", rows)
        conn.commit()

def _month_period(ym):
    """返回某月(YYYY-MM)首日到次月首日前一秒的 unix 时间戳，用于雅虎按月拉取。"""
    y, m = int(ym[:4]), int(ym[5:7])
    first = datetime(y, m, 1)
    if m == 12:
        nxt = datetime(y + 1, 1, 1)
    else:
        nxt = datetime(y, m + 1, 1)
    period1 = int(first.timestamp())
    period2 = int(nxt.timestamp()) - 1
    return period1, period2

def _metal_fetch_yahoo(symbol, period1, period2):
    """从雅虎财经拉取日线收盘价，返回 {date: close_usd}。失败返回 {}。"""
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s"
           "?period1=%d&period2=%d&interval=1d" % (urllib.parse.quote(symbol), period1, period2))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            js = json.loads(resp.read().decode("utf-8"))
        res = js.get("chart", {}).get("result")
        if not res:
            return {}
        closes = res[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        ts = res[0].get("timestamp", [])
        out = {}
        for t, c in zip(ts, closes):
            if c is None:
                continue
            d = datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")
            out[d] = float(c)
        return out
    except Exception as e:
        print("[metal] fetch %s failed: %s" % (symbol, e))
        return {}

def _fx_fetch_yahoo(symbol, period1, period2):
    """从雅虎财经拉取日线汇率，返回 {date: rate}。失败返回 {}。"""
    return _metal_fetch_yahoo(symbol, period1, period2)

def _imf_extract_obs(obj):
    """递归提取 IMF SDMX JSON 中的 Obs {time, value} 列表。"""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = k.lstrip("@").upper()
            if key in ("OBS", "OBSERVATIONS") and isinstance(v, list):
                for item in v:
                    if not isinstance(item, dict):
                        continue
                    tp = item.get("@TIME_PERIOD") or item.get("TIME_PERIOD")
                    ov = item.get("@OBS_VALUE") or item.get("OBS_VALUE")
                    if tp and ov is not None:
                        try:
                            out.append({"time": str(tp), "value": float(ov)})
                        except Exception:
                            pass
            else:
                out.extend(_imf_extract_obs(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_imf_extract_obs(v))
    return out

def _metal_fetch_imf_pcps(key, p1, p2):
    """从 IMF PCPS 拉取某商品的月度实际市场价格，返回 {YYYY-MM-DD: close_usd}。
    仅处理 METAL_OFFICIAL_CODES 中配置的品种；失败返回 {}。"""
    code = METAL_OFFICIAL_CODES.get(key)
    if not code:
        return {}
    start = datetime.utcfromtimestamp(p1).strftime("%Y-%m")
    end = datetime.utcfromtimestamp(p2).strftime("%Y-%m")
    url = ("https://dataservices.imf.org/REST/SDMX_JSON.svc/DataStream/PCPS/%s"
           "?startPeriod=%s&endPeriod=%s" % (urllib.parse.quote(code), start, end))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            js = json.loads(resp.read().decode("utf-8"))
        obs = _imf_extract_obs(js)
        out = {}
        for ob in obs:
            ym = ob.get("time", "")
            if len(ym) >= 7 and ym[4] == "-":
                # 统一存为每月1号，与缓存中日线格式对齐
                out[ym[:7] + "-01"] = ob["value"]
        if out:
            print("[metal] IMF PCPS %s -> %s 条 (ex %s..%s)" % (key, len(out), start, end))
        return out
    except Exception as e:
        print("[metal] IMF PCPS %s failed: %s" % (key, e))
        return {}

# 历史固化状态：记录已处理过的"当前月"，用于跨月时对刚过去月做一次性补拉。
# 进程级变量；服务器重启后通过缓存中最新的月份推断，避免冷启动全量重拉。
_LAST_FILL_MONTH = None

def _prev_month_ym(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    if m == 1:
        return "%04d-12" % (y - 1)
    return "%04d-%02d" % (y, m - 1)

def _ensure_prev_month_filled(conn, fetch_fn, keys, cache, cur_ym, save_fn):
    """跨月补拉：当当前月从 last_month 切换到 cur_ym 时，对刚过去的 last_month 整月补拉固化。
    历史月（非当前月）100% 读缓存，绝不外网；仅此处在跨月边界补拉一次。"""
    global _LAST_FILL_MONTH
    if _LAST_FILL_MONTH is None:
        # 冷启动：从缓存推断最近有数据的月份作为起点，不补拉历史
        latest = None
        for k in keys:
            m = cache.get(k, {})
            if m:
                cand = max(m.keys())[:7]
                if latest is None or cand > latest:
                    latest = cand
        _LAST_FILL_MONTH = latest or cur_ym
    if _LAST_FILL_MONTH != cur_ym:
        prev = _prev_month_ym(cur_ym)
        if _LAST_FILL_MONTH != prev and _LAST_FILL_MONTH < cur_ym:
            # 对刚过去的整月补拉并固化（仅此一次）
            p1, p2 = _month_period(prev)
            for key in keys:
                sym = keys[key]
                fresh = fetch_fn(sym, p1, p2)
                if fresh:
                    if key not in cache:
                        cache[key] = {}
                    cache[key].update(fresh)
            save_fn(conn, cache)
        _LAST_FILL_MONTH = cur_ym

def _month_has_data(cache, keys, cur_ym):
    """检查缓存中当前月(YYYY-MM)的数据是否完整。所有 key 都有当月数据才视为已采集；
    任一 key 缺失即触发补抓，避免某些币种已更新而另一些仍停留在上月。"""
    for k in keys:
        m = cache.get(k, {})
        if not any(d.startswith(cur_ym) for d in m.keys()):
            return False
    return True

# ⛔⛔⛔ 锁死：_metal_clean_outliers 是 2026-09-04 修复锌价脏数据（单日 ~108 而邻日真实价 ~2297/3950）
# 后新增的离群点守卫，是"防止脏数据再次进入金属图表"的唯一防线。禁止删除或弱化
# （如放宽 50% 阈值、或在调用点跳过它）。若数据源整体更换，必须保留等价守卫。
def _metal_clean_outliers(symbol, existing, fresh):
    """剔除数据源偶发离群点（如锌曾出现单日 ~108，而邻日真实价 ~2297/3950——
    疑为数据源返回了错误单位/拆分价）。规则：若某日值同时偏离其前后最近有效邻居
    >50%，则丢弃该点（不写入缓存，由前向填充沿用邻日真实值）。"""
    if not fresh:
        return fresh
    combined = dict(existing or {})
    combined.update(fresh)
    cdates = sorted(combined.keys())
    idx_of = {d: i for i, d in enumerate(cdates)}
    out = {}
    for d, v in fresh.items():
        if v is None:
            continue
        i = idx_of[d]
        prev_v = next((combined[cdates[j]] for j in range(i - 1, -1, -1)
                       if combined[cdates[j]] is not None), None)
        nxt_v = next((combined[cdates[j]] for j in range(i + 1, len(cdates))
                      if combined[cdates[j]] is not None), None)
        if prev_v and nxt_v and prev_v > 0 and nxt_v > 0:
            lo, hi = min(prev_v, nxt_v), max(prev_v, nxt_v)
            if v < lo * 0.5 or v > hi * 1.5:
                continue  # 离群，丢弃
        out[d] = v
    return out

def _metal_build_data(conn):
    """金属价格构建（USD 基准）：历史月 + 当月均只采集一次，采集后固化，本月内不再外网。
    每月第一天：当月缓存为空 → 自动拉取一次 → 固化 → 本月后续请求 100% 读缓存。
    跨月时：旧月已是上月底数据，自然成为历史；新月触发首次采集。
    2026-09-04 新增：优先使用 IMF PCPS 官方月度实际价（iron/zinc），回退 Yahoo。
    2026-09-04 新增：拉取后做离群点剔除（_metal_clean_outliers），避免脏数据入缓存。"""
    cache = _metal_load_cache(conn)
    now = datetime.now()
    cur_ym = now.strftime("%Y-%m")
    # 对官方数据源：若缓存完全为空，先一次性回填完整历史（2015-今）
    history_backfilled = False
    for key in METAL_OFFICIAL_CODES:
        if not cache.get(key):
            p1 = int(datetime(2015, 1, 1).timestamp())
            p2 = int(now.timestamp())
            fresh = _metal_fetch_imf_pcps(key, p1, p2)
            if fresh:
                fresh = _metal_clean_outliers(key, cache.get(key, {}), fresh)
                cache[key] = fresh
                history_backfilled = True
    if history_backfilled:
        _metal_save_cache(conn, cache)
    # 跨月补拉刚过去的月（固化，仅此一次）
    _ensure_prev_month_filled(conn, _metal_fetch_yahoo, METAL_SYMBOLS, cache, cur_ym, _metal_save_cache)
    # 当月：仅在缓存无当月数据时拉取一次（每月第一天 / 首次请求触发），采集后固化，本月不再拉外网
    if not _month_has_data(cache, METAL_SYMBOLS.keys(), cur_ym):
        p1, p2 = _month_period(cur_ym)
        p2 = int(now.timestamp())
        fresh_any = False
        for key, sym in METAL_SYMBOLS.items():
            fresh = _metal_fetch_imf_pcps(key, p1, p2)
            if not fresh:
                fresh = _metal_fetch_yahoo(sym, p1, p2)
            if fresh:
                fresh = _metal_clean_outliers(key, cache.get(key, {}), fresh)
                fresh_any = True
                if key not in cache:
                    cache[key] = {}
                cache[key].update(fresh)
        if fresh_any:
            _metal_save_cache(conn, cache)
    return cache

def _fx_build_data(conn):
    """真实历史汇率构建：历史月 + 当月均只采集一次，采集后固化，本月内不再外网。
    每月第一天自动拉取一次；跨月时旧月自然成为历史，新月触发首次采集。"""
    cache = _fx_load_cache(conn)
    now = datetime.now()
    cur_ym = now.strftime("%Y-%m")
    _ensure_prev_month_filled(conn, _fx_fetch_yahoo, FX_SYMBOLS, cache, cur_ym, _fx_save_cache)
    # 当月：仅在缓存无当月数据时拉取一次
    if not _month_has_data(cache, FX_SYMBOLS.keys(), cur_ym):
        p1, p2 = _month_period(cur_ym)
        p2 = int(now.timestamp())
        fresh_any = False
        for key, sym in FX_SYMBOLS.items():
            fresh = _fx_fetch_yahoo(sym, p1, p2)
            if fresh:
                fresh_any = True
                if key not in cache:
                    cache[key] = {}
                cache[key].update(fresh)
        if fresh_any:
            _fx_save_cache(conn, cache)
    return cache


# ---- 后台预热：当月数据缺失时异步补抓，接口请求不再阻塞等待外网 ----
import threading as _threading
_MARKET_WARM_LOCK = _threading.Lock()
_MARKET_WARM_RUNNING = False
_MARKET_LAST_WARM = 0.0

def _kick_market_warm():
    """feed/metal/fx 任一当月数据缺失时，后台线程补抓一次（固化进 SQLite）。
    请求路径 100% 读缓存 → 页面秒开；补抓完成清内存缓存，下次请求即含当月。"""
    global _MARKET_WARM_RUNNING, _MARKET_LAST_WARM
    now = time.time()
    if _MARKET_WARM_RUNNING or (now - _MARKET_LAST_WARM) < 120:
        return
    _MARKET_LAST_WARM = now
    with _MARKET_WARM_LOCK:
        if _MARKET_WARM_RUNNING:
            return
        _MARKET_WARM_RUNNING = True

    def _worker():
        global _MARKET_WARM_RUNNING
        try:
            conn = get_db()
            try:
                _fx_build_data(conn)
                _feed_build_data(conn)
                _metal_build_data(conn)
            finally:
                conn.close()
            # 抓到新数据后清 60s 内存缓存，让下次请求立刻带上当月
            for k in list(_API_CACHE.keys()):
                if k.startswith(("feed_", "metal_", "livestock_", "fx")):
                    _API_CACHE.pop(k, None)
            print("[warm] market current-month data refreshed in background")
        except Exception as e:
            print("[warm] background refresh failed:", e)
        finally:
            _MARKET_WARM_RUNNING = False

    _threading.Thread(target=_worker, daemon=True).start()

def _forward_fill(m, labels):
    """对缺失日期前向填充，返回与 labels 等长的数组。"""
    last = None
    arr = []
    for d in labels:
        v = m.get(d)
        if v is not None:
            last = v
        arr.append(last)
    return arr

def _monthly_avg(labels, series):
    """将日线数据按自然月聚合为月度平均值。
    labels: ['YYYY-MM-DD', ...]; series: {key: [值...]}
    返回 (month_labels, month_series)，month_labels 为 'YYYY-MM'。"""
    buckets = {}
    for i, d in enumerate(labels):
        if len(d) < 7:
            continue
        ym = d[:7]
        if ym not in buckets:
            buckets[ym] = {}
        for k, arr in series.items():
            if i < len(arr) and arr[i] is not None:
                buckets[ym].setdefault(k, []).append(arr[i])
    month_labels = sorted(buckets.keys())
    month_series = {}
    for k in series.keys():
        month_series[k] = []
    for ym in month_labels:
        for k in series.keys():
            vals = buckets[ym].get(k)
            if vals:
                month_series[k].append(round(sum(vals) / len(vals), 2))
            else:
                month_series[k].append(None)
    return month_labels, month_series

def _peak_valley(labels, series):
    """对已聚合的序列提取波峰+波谷关键点（含首尾），降低渲染密集度。
    关键修复：所有序列共享同一套索引(keep)，保证 labels 与每条 series 长度严格一致。
    labels: ['YYYY-MM', ...]; series: {key: [值或None...]}
    返回 (pv_labels, pv_series)，pv_labels 与每个 pv_series[key] 长度相同。"""
    n = len(labels)
    if n <= 12:
        return labels, series  # 点数少则不降采样
    keep = set([0, n - 1])  # 首尾必留
    # 跨所有序列收集极值点索引（取并集），确保所有序列使用同一套索引
    for k, arr in series.items():
        prev_val = None
        direction = 0  # 1=上升中, -1=下降中
        for i in range(1, n - 1):
            v = arr[i]
            if v is None:
                continue
            if prev_val is None:
                prev_val = v
                continue
            if v > prev_val:
                new_dir = 1
            elif v < prev_val:
                new_dir = -1
            else:
                new_dir = direction
            # 方向转变处 = 极值点（波峰或波谷）
            if direction != 0 and new_dir != 0 and new_dir != direction:
                keep.add(i)
            direction = new_dir
            prev_val = v
    idx = sorted(keep)
    pv_labels = [labels[i] for i in idx]
    pv_series = {}
    for k in series.keys():
        pv_series[k] = [series[k][i] for i in idx]
    # 安全检查：确保长度一致
    for k in pv_series:
        assert len(pv_series[k]) == len(pv_labels), f"pv_series[{k}] length {len(pv_series[k])} != pv_labels {len(pv_labels)}"
    return pv_labels, pv_series

# ===================== 锌锭历史冻结覆盖（2026-09-06）=====================
# 用户提供的 SMM 0# 锌锭月度均价（元/吨，2020-12~2026-08），套算 USD/VND 后锁死。
# 看板/价格走势对 zinc 的 <=cutoff 月份【直接读取 zinc_frozen.json】，不走实时换算管线；
# cutoff 之后（2026-09+）仍由实时管线（IMF/Yahoo + 真实汇率）续接，互不干扰。
# 此为历史数据锁死层，独立于下方⛔金属管线核心常量（METAL_SYMBOLS 等），不改动它们。
import json as _json
_ZINC_FROZEN = None
def _load_zinc_frozen():
    global _ZINC_FROZEN
    if _ZINC_FROZEN is not None:
        return _ZINC_FROZEN
    p = os.path.join(BASE_DIR, "zinc_frozen.json")
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                _ZINC_FROZEN = _json.load(f)
        except Exception as e:
            print("[zinc_frozen] load failed:", e)
            _ZINC_FROZEN = False
    else:
        _ZINC_FROZEN = False
    return _ZINC_FROZEN

def _apply_zinc_frozen(month_labels, month_series, cur):
    """用冻结历史数据覆盖 zinc 的 <=cutoff 月份（按当前币种 cur）。"""
    frozen = _load_zinc_frozen()
    if not frozen or "zinc" not in month_series:
        return
    key = {"USD": "usd", "RMB": "rmb", "VND": "vnd"}.get(cur)
    if not key or key not in frozen:
        return
    cutoff = frozen.get("cutoff_month", "2026-08")
    mmap = {}
    for ym, v in zip(frozen.get("months", []), frozen.get(key, [])):
        mmap[ym] = v
    arr = month_series["zinc"]
    for i, ym in enumerate(month_labels):
        if ym <= cutoff and ym in mmap:
            arr[i] = mmap[ym]

@app.route("/api/metal-prices")
def api_metal_prices():
    cur = (request.args.get("cur") or "USD").upper()
    if cur not in ("USD", "RMB", "VND"):
        cur = "USD"
    # 短期内存缓存（60s）：货币切换时避免重复拉 Yahoo
    cache_key = "metal_" + cur
    cached = _API_CACHE.get(cache_key)
    if cached and (time.time() - cached[0] < 60):
        return jsonify(cached[1])
    conn = get_db()
    try:
        # 缓存直读（秒开）；当月缺失后台补抓
        raw = _metal_load_cache(conn)
        fx = _fx_load_cache(conn)
        now_ym = datetime.now().strftime("%Y-%m")
        if not (_month_has_data(raw, METAL_SYMBOLS.keys(), now_ym)
                and _month_has_data(fx, FX_SYMBOLS.keys(), now_ym)):
            _kick_market_warm()
    finally:
        conn.close()
    # 统一 labels（所有品种日期并集，升序）
    all_dates = set()
    for m in raw.values():
        all_dates.update(m.keys())
    labels = sorted(all_dates)
    # 真实历史汇率序列（前向填充）
    usdcny = _forward_fill(fx.get("USDCNY", {}), labels)
    usdvnd = _forward_fill(fx.get("USDVND", {}), labels)
    # 每日换算系数（USD -> 目标币种）
    if cur == "USD":
        conv = [1.0] * len(labels)
    elif cur == "RMB":
        conv = [r if r else 1.0 for r in usdcny]   # USD->CNY
    else:  # VND
        conv = [r if r else 1.0 for r in usdvnd]   # USD->VND
    series = {}
    for key, m in raw.items():
        factor = METAL_TO_TON_FACTOR.get(key, 1.0)
        base = _forward_fill(m, labels)
        arr = []
        for i, d in enumerate(labels):
            v = base[i]
            if v is None:
                arr.append(None)
            else:
                # 先按品种系数换算为 USD/吨（原始单位 -> 标准单位）
                usd_per_ton = v * factor
                # 再按真实历史汇率换算为目标币种 / 吨
                arr.append(round(usd_per_ton * (conv[i] or 1.0), 2))
        series[key] = arr
    # 聚合为月度平均，再提取波峰波谷关键点，降低渲染密集度
    month_labels, month_series = _monthly_avg(labels, series)
    # 锌锭历史冻结覆盖：<=cutoff 月份直接调用锁死数据（2026-09-06）
    _apply_zinc_frozen(month_labels, month_series, cur)
    pv_labels, pv_series = _peak_valley(month_labels, month_series)
    resp = {
        "ok": True,
        "cur": cur,
        "labels": pv_labels,
        "series": pv_series,
        "symbols": {k: METAL_SYMBOLS[k] for k in METAL_SYMBOLS},
        "raw_units": METAL_RAW_UNIT
    }
    _API_CACHE["metal_" + cur] = (time.time(), resp)
    return jsonify(resp)

# ===================== 饲料原料缓存与构建 =====================
def _feed_cache_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS feed_cache (
        symbol TEXT, date TEXT, close REAL,
        PRIMARY KEY(symbol, date))""")
    conn.commit()

def _feed_load_cache(conn):
    _feed_cache_table(conn)
    cur = conn.execute("SELECT symbol, date, close FROM feed_cache")
    out = {}
    for sym, d, c in cur.fetchall():
        out.setdefault(sym, {})[d] = c
    return out

def _feed_save_cache(conn, data):
    _feed_cache_table(conn)
    rows = []
    for sym, m in data.items():
        for d, c in m.items():
            rows.append((sym, d, c))
    if rows:
        conn.executemany("INSERT OR REPLACE INTO feed_cache(symbol, date, close) VALUES(?,?,?)", rows)
        conn.commit()

def _feed_build_data(conn):
    """饲料原料构建（USD 基准）：历史月 + 当月均只采集一次，采集后固化，本月内不再外网。
    每月第一天自动拉取一次；跨月时旧月自然成为历史，新月触发首次采集。"""
    cache = _feed_load_cache(conn)
    now = datetime.now()
    cur_ym = now.strftime("%Y-%m")
    feed_syms = {k: v["sym"] for k, v in FEED_ITEMS.items()}
    _ensure_prev_month_filled(conn, _metal_fetch_yahoo, feed_syms, cache, cur_ym, _feed_save_cache)
    # 当月：仅在缓存无当月数据时拉取一次
    if not _month_has_data(cache, feed_syms.keys(), cur_ym):
        p1, p2 = _month_period(cur_ym)
        p2 = int(now.timestamp())
        fresh_any = False
        for key, cfg in FEED_ITEMS.items():
            sym = cfg["sym"]
            fresh = _metal_fetch_yahoo(sym, p1, p2)
            if fresh:
                fresh_any = True
                if sym not in cache:
                    cache[sym] = {}
                cache[sym].update(fresh)
        if fresh_any:
            _feed_save_cache(conn, cache)
    return cache

@app.route("/api/feed-prices")
def api_feed_prices():
    """大宗饲料原料价格：每个品种含国际/中国/越南三条曲线，月度聚合 + 波峰波谷降采样。
    货币切换：三条曲线分别从各自原生货币换算到目标币种（真实汇率）。"""
    cur = (request.args.get("cur") or "USD").upper()
    if cur not in ("USD", "RMB", "VND"):
        cur = "USD"
    # 短期内存缓存（60s）：货币切换时避免重复拉 Yahoo
    cache_key = "feed_" + cur
    cached = _API_CACHE.get(cache_key)
    if cached and (time.time() - cached[0] < 60):
        return jsonify(cached[1])
    conn = get_db()
    try:
        # 历史+当月全部 100% 读 SQLite 固化缓存（秒开）；
        # 当月缺失时后台线程补抓，抓到后下次请求自动带上。
        raw = _feed_load_cache(conn)
        fx = _fx_load_cache(conn)
        now_ym = datetime.now().strftime("%Y-%m")
        if not (_month_has_data(raw, [v["sym"] for v in FEED_ITEMS.values()], now_ym)
                and _month_has_data(fx, FX_SYMBOLS.keys(), now_ym)):
            _kick_market_warm()
    finally:
        conn.close()
    # 统一 labels（所有品种日期并集，升序）
    all_dates = set()
    for cfg in FEED_ITEMS.values():
        all_dates.update(raw.get(cfg["sym"], {}).keys())
    labels = sorted(all_dates)
    # 真实历史汇率序列（双向填充：前向+后向，消除早期无数据缺口）
    def _bidir_fill(src, labs):
        f = _forward_fill(src, labs)
        # 后向填充开头 None
        last = None
        for i in range(len(f) - 1, -1, -1):
            if f[i] is not None:
                last = f[i]
            elif last is not None:
                f[i] = last
        return f
    usdcny = _bidir_fill(fx.get("USDCNY", {}), labels)
    usdvnd = _bidir_fill(fx.get("USDVND", {}), labels)
    # 目标币种换算因子（USD -> target），逐日。idx 为对应日期在 labels 中的下标。
    def usd_to_target(native_target, idx):
        if idx < 0:
            idx = 0
        if native_target == "USD":
            return 1.0
        if native_target == "RMB":
            return (usdcny[idx] if (idx < len(usdcny) and usdcny[idx]) else 1.0)
        if native_target == "VND":
            return (usdvnd[idx] if (idx < len(usdvnd) and usdvnd[idx]) else 1.0)
        return 1.0
    pv_result = {}
    _combined_curves = {}
    _combined_labels = []
    _cur_month = labels[-1][:7] if labels else None
    _anchor_month = "2026-08"
    last_idx = len(labels) - 1 if labels else -1
    # 锚点月(2026-08)在日序列中的索引：取最后一个落在 2026-08 的日点
    _anchor_idx = last_idx
    for _i in range(len(labels) - 1, -1, -1):
        if labels[_i][:7] == _anchor_month:
            _anchor_idx = _i
            break
    for item, cfg in FEED_ITEMS.items():
        sym = cfg["sym"]
        uf = cfg.get("unit_factor", 1.0)
        ratio = cfg.get("ddgs_ratio", 1.0)
        base = _forward_fill(raw.get(sym, {}), labels)
        # USD/吨基准序列（修正 CBOT 单位 + DDGS 比例）
        usd_series = [ (v * uf * ratio) if v is not None else None for v in base ]
        # 2026-08 校准：若最新日期落在 2026-08，直接用用户给出的 USD/吨 锚点价覆盖当月国际基准
        if _cur_month == _anchor_month and usd_series:
            usd_series[last_idx] = FEED_ANCHOR_202608.get(item, FEED_ANCHOR_202608["soybean"])
        is_anchor_month = (_cur_month == _anchor_month)
        def _f(factor):
            return round(factor, 2)
        # 当月锚点价换算到目标币种（用锚点月 2026-08 对应汇率）
        anchor_factor_cur = usd_to_target(cur, _anchor_idx)
        # 玉米用「本币现货价（CNY/吨）」锚点；其他品种用 USD/吨 CNF 锚点。
        # 玉米锚点换算：RMB 直接取值，USD=V/CNY汇率，VND=V*(VND/CNY)。
        def cny_to_target(cny_val, idx):
            if cny_val is None:
                return None
            cny_fx = usdcny[idx] if (idx < len(usdcny) and usdcny[idx]) else 1.0
            if cur == "RMB":
                return cny_val
            if cur == "USD":
                return cny_val / cny_fx
            if cur == "VND":
                vnd_fx = usdvnd[idx] if (idx < len(usdvnd) and usdvnd[idx]) else 1.0
                return cny_val * (vnd_fx / cny_fx)
            return cny_val
        # 本币锚点表：按品种选择（玉米/大豆用 CNY/吨，其余用 USD/吨 CNF）
        _CNY_ANCHOR_TABLE = {
            "corn": FEED_CNY_CORN_ANCHOR,
            "soybean": FEED_CNY_SOYBEAN_ANCHOR,
            "soymeal": FEED_CNY_SOYMEAL_ANCHOR,
            "ddgs": FEED_CNY_DDGS_ANCHOR,
        }
        cny_table = _CNY_ANCHOR_TABLE.get(item)
        # 真实口径公式：以 2026-08 真实现货锚点为基准，历史各月按 CBOT 相对比例回推
        #   某月真实价 = 锚点价 × (该月CBOT原始值 / 2026-08月CBOT原始值)
        # 这样整条曲线都是真实口径（终点=真实锚点，历史=相同波动形态），而非旧模拟值。
        base_ref = usd_series[_anchor_idx] if (_anchor_idx < len(usd_series) and usd_series[_anchor_idx]) else None
        curves = {}

        def _anchor_for(ckey):
            """返回该曲线在目标货币下的 2026-08 真实锚点价"""
            if cny_table is not None:
                # 本币现货锚点（CNY/吨）：中国用 CN，越南用 VN，国际用 CBOT 锚点
                if ckey == "intl":
                    a = FEED_ANCHOR_202608.get(item, FEED_ANCHOR_202608["soybean"])
                    return _f(a * anchor_factor_cur)
                elif ckey == "china":
                    return _f(cny_to_target(cny_table["CN"], _anchor_idx))
                elif ckey == "vietnam":
                    return _f(cny_to_target(cny_table["VN"], _anchor_idx))
                else:
                    return _f(cny_to_target(cny_table.get(ckey), _anchor_idx))
            else:
                if ckey == "intl":
                    a = FEED_ANCHOR_202608.get(item, FEED_ANCHOR_202608["soybean"])
                elif ckey == "china":
                    a = FEED_CNF_ANCHOR["CN"].get(item, 0)
                elif ckey == "vietnam":
                    a = FEED_CNF_ANCHOR["VN"].get(item, 0)
                else:
                    a = FEED_CNF_ANCHOR.get(ckey, {}).get(item, 0)
                return _f(a * anchor_factor_cur)

        # 基础曲线（国际/中国/越南）
        for ckey in FEED_CURVE_NATIVE:
            a_val = _anchor_for(ckey)
            arr = []
            for j in range(len(usd_series)):
                v = usd_series[j]
                if v is None or base_ref is None or base_ref == 0:
                    arr.append(None)
                elif j == last_idx:
                    arr.append(a_val)  # 锚点月直接用真实价
                else:
                    # 历史月：锚点价 × 当月CBOT相对比例
                    arr.append(_f(a_val * (v / base_ref)))
            curves[ckey] = arr
        # 国家曲线（含 CN 与各经验国家）
        all_ccodes = ["CN"] + list(FEED_COUNTRY_BASIS.keys())
        for ccode in all_ccodes:
            a_val = _anchor_for(ccode)
            arr = []
            for j in range(len(usd_series)):
                v = usd_series[j]
                if v is None or base_ref is None or base_ref == 0:
                    arr.append(None)
                elif j == last_idx:
                    arr.append(a_val)
                else:
                    arr.append(_f(a_val * (v / base_ref)))
            curves[ccode] = arr
        # 月度聚合
        month_labels, month_curves = _monthly_avg(labels, curves)
        # 2026-08 校准：用已覆盖的当日锚点值直接作为当月月度值，避免月中旧数据拉低平均
        if _cur_month == _anchor_month and month_labels and month_labels[-1] == _anchor_month:
            for ckey in curves:
                if curves[ckey] and curves[ckey][-1] is not None:
                    month_curves[ckey][-1] = curves[ckey][-1]
        # 暂存到统一容器，稍后统一做波峰波谷降采样（保证所有品种共享同一套 labels）
        for ckey in month_curves:
            _combined_curves[item + "|" + ckey] = month_curves[ckey]
        _combined_labels = month_labels
    # 统一波峰波谷降采样：所有品种/曲线共享同一套索引，确保 labels 与每条 series 一一对应
    pv_labels, _pv_combined = _peak_valley(_combined_labels, _combined_curves)
    # 拆分回每个品种
    pv_result = {}
    for item in FEED_ITEMS:
        pv_result[item] = {}
        for ckey in _combined_curves:
            if ckey.startswith(item + "|"):
                pv_result[item][ckey.split("|", 1)[1]] = _pv_combined[ckey]
    resp = {
        "ok": True,
        "cur": cur,
        "labels": pv_labels,
        "series": pv_result,
        "symbols": {k: v["sym"] for k, v in FEED_ITEMS.items()},
        "units": {k: v["unit"] for k, v in FEED_ITEMS.items()},
        "countries": {
            code: {"name": cfg["name"], "basis": cfg.get("basis", {})}
            for code, cfg in FEED_COUNTRY_BASIS.items()
        },
    }
    _API_CACHE["feed_" + cur] = (time.time(), resp)
    resp_obj = jsonify(resp)
    resp_obj.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp_obj.headers["Pragma"] = "no-cache"
    return resp_obj

@app.route("/api/feed-test")
def api_feed_test():
    """调试端点：检查 _monthly_avg 和 _peak_valley 的中间数据"""
    cur = (request.args.get("cur") or "RMB").upper()
    conn = get_db()
    try:
        raw = _feed_build_data(conn, cur)
        labels = raw["labels"]
        curves = raw["series"]
    finally:
        conn.close()
    
    # 测试 _monthly_avg
    month_labels, month_curves = _monthly_avg(labels, curves)
    
    # 测试 _peak_valley
    pv_labels, pv_curves = _peak_valley(month_labels, month_curves)
    
    result = {
        "raw_labels": len(labels),
        "raw_series_len": {k: len(v) for k, v in curves.items() if "corn" in k or k in ("vietnam","china","intl")},
        "month_labels": len(month_labels),
        "month_series_len": {k: len(v) for k, v in month_curves.items() if "corn" in k or k in ("vietnam","china","intl")},
        "pv_labels": len(pv_labels),
        "pv_series_len": {k: len(v) for k, v in pv_curves.items() if "corn" in k or k in ("vietnam","china","intl")},
        "match": len(pv_labels) == all(len(v) == len(pv_labels) for v in pv_curves.values()),
    }
    return jsonify(result)

@app.route("/api/fx-rates")
def api_fx_rates():
    """返回三条真实历史汇率曲线：USD→CNY、USD→VND、CNY→VND，最近 5 年 + 当月。"""
    # 短期内存缓存（60s）
    cached = _API_CACHE.get("fx")
    if cached and (time.time() - cached[0] < 60):
        return jsonify(cached[1])
    conn = get_db()
    try:
        # 缓存直读（秒开）；当月缺失后台补抓
        fx = _fx_load_cache(conn)
        now_ym = datetime.now().strftime("%Y-%m")
        if not _month_has_data(fx, FX_SYMBOLS.keys(), now_ym):
            _kick_market_warm()
    finally:
        conn.close()
    all_dates = set()
    all_dates.update(fx.get("USDCNY", {}).keys())
    all_dates.update(fx.get("USDVND", {}).keys())
    labels = sorted(all_dates)
    usdcny = _forward_fill(fx.get("USDCNY", {}), labels)
    usdvnd = _forward_fill(fx.get("USDVND", {}), labels)
    # USD->CNY 保留 2 位小数；USD->VND 和 CNY->VND 取整（数值大无需小数）
    cny_vnd = []
    for i in range(len(labels)):
        a = usdcny[i]
        b = usdvnd[i]
        if a and b:
            cny_vnd.append(round(b / a))   # CNY→VND 取整
        else:
            cny_vnd.append(None)
    # usdvnd 也取整
    usdvnd_int = [round(v) if v is not None else None for v in usdvnd]
    # 聚合为月度平均，再提取波峰波谷关键点，降低渲染密集度
    daily_series = {
        "usd_cny": usdcny,       # 1 USD = ? CNY（2 位小数）
        "usd_vnd": usdvnd_int,   # 1 USD = ? VND（整数）
        "cny_vnd": cny_vnd       # 1 CNY = ? VND（整数）
    }
    month_labels, month_series = _monthly_avg(labels, daily_series)
    pv_labels, pv_series = _peak_valley(month_labels, month_series)
    # VND 类汇率数值大，取整显示
    for k in ("usd_vnd", "cny_vnd"):
        if k in pv_series:
            pv_series[k] = [round(v) if v is not None else None for v in pv_series[k]]
    resp = {
        "ok": True,
        "labels": pv_labels,
        "series": pv_series
    }
    _API_CACHE["fx"] = (time.time(), resp)
    return jsonify(resp)


# ============================================================================
# DEMO 演示数据机制（一键还原 / 一键清空）
# ============================================================================
# 设计要点：
#   · 示例数据从 demo_snapshot.json 还原（由 export_demo_snapshot.py 生成），
#     而不是调用 seed 函数重新生成 —— 这样能 100% 还原"当时"的演示状态，
#     包括 CRM 那 32 条被 migrate 修正过的数据。
#   · ★ DEMO 与用户列表彻底解耦（用户明确要求）：load/clear 只动 DEMO_TABLES
#     四张业务表，users 表 / managers 表一个字都不碰 —— 不管真实账号还是
#     演示账号（khoa/minh 等）。删用户只能走「用户与授权」页的删除审批流程。
#     demo_users 列表仅供 reset_demo_data.py 清理脚本使用。
# ============================================================================

def _demo_snapshot_exists():
    return os.path.exists(DEMO_SNAPSHOT)


def clear_demo_data(c, also_business=True):
    """清空演示业务数据（DEMO_TABLES 四张表）。

    ★ 与用户列表彻底解耦：本函数绝不碰 users / managers 表（真实账号和
    演示账号都不动）。删用户只能走用户管理页的删除审批流程。

    ★ is_demo 精确清除：只删 is_demo=1 的演示行，真实录入的业务数据（is_demo=0）
    一律保留 —— 培训结束点「清空 DEMO」即可把演示数据彻底清干净，绝不误伤真实数据。
    （早期未打标记的存量演示数据，由 init_db 后的一次性标注 / 或 reset_demo_data.py 兜底处理。）
    """
    removed = {}
    if also_business:
        for t in DEMO_TABLES:
            try:
                n = c.execute("SELECT COUNT(*) FROM %s WHERE is_demo=1" % t).fetchone()[0]
                c.execute("DELETE FROM %s WHERE is_demo=1" % t)
                try:
                    c.execute("DELETE FROM sqlite_sequence WHERE name=?", (t,))
                except Exception:
                    pass
                removed[t] = n
            except Exception as e:
                removed[t] = "失败: %s" % e
    # ★ 用户/管理员表完全不碰（DEMO 与用户列表彻底解耦）
    removed["_demo_users"] = 0
    removed["_demo_managers"] = 0
    return removed


def load_demo_data(c):
    """从快照还原演示数据。若快照不存在，则回退到调用 seed 函数生成。"""
    if not _demo_snapshot_exists():
        # 回退：用内置 seed 函数生成（数据会与快照略有差异）
        seed_crm_projects(c)
        seed_approval_requests(c)
        # seed 出来的也是演示数据，打 is_demo=1，便于「清空 DEMO」精确移除
        for _t in DEMO_TABLES:
            try:
                c.execute("UPDATE %s SET is_demo=1" % _t)
            except Exception:
                pass
        return {"mode": "seed_fallback", "note": "快照不存在，已用内置示例数据生成"}

    with open(DEMO_SNAPSHOT, "r", encoding="utf-8") as f:
        snap = json.load(f)

    restored = {}

    # ---- 业务表 ----
    # ★ 还原前只清【演示行】(is_demo=1)，真实录入的数据(is_demo=0)一律保留 ——
    #   这样培训期间你加的真实业务数据不会被「加载 DEMO」冲掉；DEMO 始终是同一批固定样本。
    for t in DEMO_TABLES:
        rows = (snap.get("tables") or {}).get(t) or []
        try:
            c.execute("DELETE FROM %s WHERE is_demo=1" % t)
        except Exception:
            pass
        n = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            # 去掉 id：避免 INSERT 覆盖真实行（真实行用自增 id，互不冲突）；
            # 末尾追加 is_demo=1 标记，供「清空 DEMO」精确删除、不误伤真实数据。
            cols = [k for k in row.keys() if k != "id"]
            cols.append("is_demo")
            if not cols:
                continue
            ph = ",".join("?" * len(cols))
            sql = "INSERT INTO %s (%s) VALUES (%s)" % (
                t, ",".join(cols), ph)
            try:
                vals = [row[k] for k in cols if k != "is_demo"] + [1]
                c.execute(sql, vals)
                n += 1
            except Exception:
                continue
        restored[t] = n

    # ★ 用户/管理员表完全不碰（DEMO 与用户列表彻底解耦）。
    # 快照里即使存有 demo_users / demo_managers 也一律忽略不写入。
    restored["_demo_users"] = 0
    restored["_demo_managers"] = 0
    restored["mode"] = "snapshot"
    return restored


# ⛔⛔⛔ 锁死（DEMO 策略，2026-09-04）：业务表的演示案例统一打 is_demo=1，作为「培训样本」固定保留，
# 培训结束前严禁任何路径删除/改动这批演示行（仅 /api/demo/clear 在培训后统一清空）。
# 真实录入数据一律 is_demo=0，绝不被 DEMO 还原或清空误伤。勿新增会自动清除 demo 的逻辑。
@app.route("/api/demo/load", methods=["POST"])
def api_demo_load():
    """一键还原演示数据（重置模式：先清空，再从快照还原）。"""
    try:
        conn = get_db()
        c = conn.cursor()
        clear_demo_data(c, also_business=True)
        restored = load_demo_data(c)
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "restored": restored})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/demo/clear", methods=["POST"])
def api_demo_clear():
    """一键清空演示数据，回到只有真实用户的干净状态。"""
    try:
        conn = get_db()
        c = conn.cursor()
        removed = clear_demo_data(c, also_business=True)
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "removed": removed})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    import logging
    import socket
    # 默认只打印 WARNING 及以上，避免每个请求刷屏；开发需要时改成 INFO
    logging.basicConfig(level=logging.WARNING)
    # 关闭 Werkzeug 默认请求日志（只保留 ERROR 级别）
    werkzeug_log = logging.getLogger('werkzeug')
    werkzeug_log.setLevel(logging.ERROR)

    PORT = 5050

    def _port_in_use(port, host="127.0.0.1", timeout=0.5):
        """端口占用预检（Windows 安全版）。

        注意：探测 socket 绝不能设置 SO_REUSEADDR，否则 Windows 下会与已监听的
        实例"共享"端口并 bind 成功，导致误判为"空闲"，预检形同虚设。
        这里改用 connect 探测：能连上说明确实已有服务在监听，判定为占用。
        """
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((host, port))
            return True          # 连得上 = 已有实例在监听
        except OSError:
            return False         # 连不上 = 端口空闲
        finally:
            s.close()

    if _port_in_use(PORT):
        # 端口已被占用：明确报错退出，避免多实例静默共存导致"改了代码看不到效果"
        # 提示用 ASCII，避免任何控制台编码环境下出现乱码
        sys.stderr.write(
            "\n[FATAL] Port %d is already in use. Service NOT started.\n"
            "        Another app.py instance may be running.\n"
            "        Fix: run start_server.bat (auto-kills old instances),\n"
            "             or: netstat -ano | findstr :%d\n\n" % (PORT, PORT)
        )
        sys.stderr.flush()
        sys.exit(1)

    # use_reloader=False：关闭 Flask 自动重载，避免每次启动产生 2 个进程（父 reloader + 子 worker）
    # threaded=True：多线程处理并发请求
    print("[OK] AGI-PM 服务启动：http://127.0.0.1:%d  (单实例/无 reloader)" % PORT)
    # 打印局域网 IP：手机/PWA 需用同一 WiFi 下的该地址访问（前端已改为同源相对路径，无需再改 IP）
    try:
        import socket as _sock
        _lan = None
        _s = _sock.socket(_sock.AF_INET, _sock.SOCK_DGRAM)
        _s.settimeout(0.5)
        # 不会真的发包，只是让系统选出去往公网的网卡，从而拿到本机局域网 IP
        _s.connect(("8.8.8.8", 80))
        _lan = _s.getsockname()[0]
        _s.close()
        if _lan and not _lan.startswith("127."):
            print("[INFO] 手机/PWA 访问（同一 WiFi）：http://%s:%d" % (_lan, PORT))
    except Exception:
        pass
    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False, threaded=True)