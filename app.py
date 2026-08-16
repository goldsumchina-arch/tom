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
import json
import sqlite3
import time
import re
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# ===================== 配置 =====================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = BASE_DIR
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "agi_pm.db")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__)
CORS(app)

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
                    if k in ("cust_view_detail", "gs_view_detail"):
                        d[k] = v
                    else:
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
        contract_date TEXT DEFAULT '',
        signing_parties TEXT DEFAULT '',
        contract_currency TEXT DEFAULT '',
        rate_rmb_vnd TEXT DEFAULT '',
        rate_usd_vnd TEXT DEFAULT '',
        incoterm TEXT DEFAULT '',
        include_install TEXT DEFAULT '',
        payment_terms TEXT DEFAULT '',
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

        attachments TEXT DEFAULT '[]',
        supp_summary TEXT DEFAULT '[]'
    );
    """)

    # ★ 迁移：为已有数据库添加新列（如果不存在）
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

    conn.commit()
    conn.close()

init_db()

# ===================== 工具 =====================
def safe_name(s):
    s = os.path.basename(s or "")
    s = re.sub(r"[^A-Za-z0-9_.-]", "_", s) if False else s.replace("\\", "_").replace("/", "_")
    return s or "file"

ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".xls", ".xlsx", ".doc", ".docx", ".txt"}

# ===================== API：项目 CRUD =====================
@app.route("/api/won-projects", methods=["GET"])
def list_projects():
    conn = get_db()
    rows = conn.execute("SELECT * FROM won_projects ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([row_to_dict(r) for r in rows])

@app.route("/api/won-projects", methods=["POST"])
def create_project():
    data = request.get_json(silent=True) or {}
    fields = [
        "contract_no","customer","contract_date","signing_parties","contract_currency",
        "rate_rmb_vnd","rate_usd_vnd","incoterm","include_install","payment_terms","salesperson",
        "equip_rmb","equip_usd","equip_vnd","superv_rmb","superv_usd","superv_vnd",
        "fb_budget_rmb","fb_budget_usd","fb_budget_vnd","fb_actual_rmb","fb_actual_usd","fb_actual_vnd",
        "cc_budget_rmb","cc_budget_usd","cc_budget_vnd","cc_actual_rmb","cc_actual_usd","cc_actual_vnd",
        "total_equip_rmb","total_equip_usd","total_equip_vnd",
        "inst_budget_rmb","inst_budget_usd","inst_budget_vnd","inst_actual_rmb","inst_actual_usd","inst_actual_vnd",
        "total_ei_rmb","total_ei_usd","total_ei_vnd",
        # ★ 新增：增值税&关税&其他费用调节平衡输入
        "vat_rmb","vat_usd","vat_vnd",
        "cust_pay_count","cust_paid_rmb","cust_paid_usd","cust_paid_vnd",
        "cust_unpaid_rmb","cust_unpaid_usd","cust_unpaid_vnd","cust_remark",
        "gs_comm_pct","gs_comm_rmb","gs_comm_usd","gs_comm_vnd",
        "gs_pay_count","gs_paid_rmb","gs_paid_usd","gs_paid_vnd",
        "gs_unpaid_rmb","gs_unpaid_usd","gs_unpaid_vnd","gs_remark",
        "agi_payable_rmb","agi_payable_usd","agi_payable_vnd"
    ]
    cols = []
    vals = []
    for f in fields:
        if f in data:
            cols.append(f)
            v = data[f]
            if f.startswith(("equip_","superv_","fb_","cc_","inst_","total_","cust_","gs_","agi_","vat_")) and f not in ("cust_remark","gs_remark","gs_comm_pct"):
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
    row = conn.execute("SELECT * FROM won_projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error":"not found"}), 404
    return jsonify(row_to_dict(row))

@app.route("/api/won-projects/<int:pid>", methods=["PUT"])
def update_project(pid):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT id FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    fields = [
        "contract_no","customer","contract_date","signing_parties","contract_currency",
        "rate_rmb_vnd","rate_usd_vnd","incoterm","include_install","payment_terms","salesperson",
        "equip_rmb","equip_usd","equip_vnd","superv_rmb","superv_usd","superv_vnd",
        "fb_budget_rmb","fb_budget_usd","fb_budget_vnd","fb_actual_rmb","fb_actual_usd","fb_actual_vnd",
        "cc_budget_rmb","cc_budget_usd","cc_budget_vnd","cc_actual_rmb","cc_actual_usd","cc_actual_vnd",
        "total_equip_rmb","total_equip_usd","total_equip_vnd",
        "inst_budget_rmb","inst_budget_usd","inst_budget_vnd","inst_actual_rmb","inst_actual_usd","inst_actual_vnd",
        "total_ei_rmb","total_ei_usd","total_ei_vnd",
        # ★ 新增：增值税&关税&其他费用调节平衡输入
        "vat_rmb","vat_usd","vat_vnd",
        "cust_pay_count","cust_paid_rmb","cust_paid_usd","cust_paid_vnd",
        "cust_unpaid_rmb","cust_unpaid_usd","cust_unpaid_vnd","cust_remark",
        "gs_comm_pct","gs_comm_rmb","gs_comm_usd","gs_comm_vnd",
        "gs_pay_count","gs_paid_rmb","gs_paid_usd","gs_paid_vnd",
        "gs_unpaid_rmb","gs_unpaid_usd","gs_unpaid_vnd","gs_remark",
        "agi_payable_rmb","agi_payable_usd","agi_payable_vnd"
    ]
    sets = []
    vals = []
    for f in fields:
        if f in data:
            sets.append(f"{f}=?")
            v = data[f]
            if f.startswith(("equip_","superv_","fb_","cc_","inst_","total_","cust_","gs_","agi_","vat_")) and f not in ("cust_remark","gs_remark","gs_comm_pct"):
                try:
                    v = int(v or 0)
                except:
                    v = 0
            vals.append(v)
    for k in ("attachments","supp_summary","cust_view_detail","gs_view_detail"):
        if k in data:
            sets.append(f"{k}=?")
            vals.append(json.dumps(data[k], ensure_ascii=False) if isinstance(data[k], (list,dict)) else (data[k] or "[]"))
    if sets:
        sets.append("updated_at=datetime('now','localtime')")
        vals.append(pid)
        conn.execute(f"UPDATE won_projects SET {', '.join(sets)} WHERE id=?", vals)
    row = conn.execute("SELECT * FROM won_projects WHERE id=?", (pid,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify(row_to_dict(row))

@app.route("/api/won-projects/<int:pid>", methods=["DELETE"])
def delete_project(pid):
    conn = get_db()
    row = conn.execute("SELECT attachments FROM won_projects WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error":"not found"}),404
    try:
        atts = json.loads(row["attachments"]) if row["attachments"] else []
    except:
        atts = []
    for a in atts:
        try:
            os.remove(os.path.join(UPLOAD_DIR, a.get("filename")))
        except:
            pass
    conn.execute("DELETE FROM won_projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"ok":True})

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

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    filename = os.path.basename(filename)
    return send_from_directory(UPLOAD_DIR, filename)

# ===================== API：补充协议摘要 =====================
@app.route("/api/won-projects/<int:pid>/supp-summary", methods=["PUT"])
def update_supp_summary(pid):
    data = request.get_json(silent=True) or {}
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
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/health")
def health():
    return jsonify({"ok": True, "db": DB_PATH, "upload_dir": UPLOAD_DIR})

# ===================== 启动 =====================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)