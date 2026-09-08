-- 由 agi_pm.db 自动导出，用于 Cloudflare D1 建表
-- 标注 [缓存表] 的表不迁移到 D1（数据量大、可重新采集）

-- ============ 核心业务表（迁移到 D1） ============

-- 表: approval_requests | 行数: 27
CREATE TABLE approval_requests (
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
    , content TEXT DEFAULT '', title TEXT DEFAULT '', result_note TEXT DEFAULT '', persist TEXT DEFAULT 'persistent', target_id TEXT DEFAULT '', consumed INTEGER DEFAULT 0, payload TEXT DEFAULT '');

-- 表: crm_projects | 行数: 32
CREATE TABLE crm_projects (
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
        q7_rmb INTEGER DEFAULT 0, q7_usd INTEGER DEFAULT 0, q7_vnd INTEGER DEFAULT 0
    , status TEXT DEFAULT 'active', owner_user_id TEXT DEFAULT '');

-- 表: login_history | 行数: 143
CREATE TABLE login_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            login_time TEXT DEFAULT (datetime('now','localtime')),
            ip_address TEXT DEFAULT '',
            user_agent TEXT DEFAULT ''
        );

-- 表: lost_projects | 行数: 18
CREATE TABLE lost_projects (
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
    , owner_user_id TEXT DEFAULT '');

-- 表: managers | 行数: 4
CREATE TABLE managers (
            username TEXT PRIMARY KEY NOT NULL,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

-- 表: password_requests | 行数: 2
CREATE TABLE password_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            requested_at TEXT DEFAULT '',
            processed_at TEXT DEFAULT '',
            note TEXT DEFAULT ''
        );

-- 表: users | 行数: 22
CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            real_name TEXT DEFAULT '',
            role TEXT DEFAULT 'user',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT ''
        , position TEXT DEFAULT '', vis_can_see_me TEXT DEFAULT '[]', vis_he_can_see TEXT DEFAULT '[]', perms TEXT DEFAULT '{}', delegate_to TEXT DEFAULT '', forgot_approvers TEXT DEFAULT '[]', sort_order INTEGER DEFAULT 0);

-- 表: won_projects | 行数: 26
CREATE TABLE won_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    no INTEGER DEFAULT 0,

    -- 基础信息
    contract_no       TEXT,
    customer          TEXT,
    contract_date     TEXT,
    signing_parties   TEXT,
    contract_currency TEXT,
    rate_rmb_vnd     INTEGER DEFAULT 0,
    rate_usd_vnd     INTEGER DEFAULT 0,
    incoterm         TEXT,
    include_install  TEXT,
    payment_terms    TEXT,
    salesperson      TEXT,

    -- 设备费（三币种）
    equip_rmb        INTEGER DEFAULT 0,
    equip_usd        INTEGER DEFAULT 0,
    equip_vnd        INTEGER DEFAULT 0,

    -- 监理费（三币种）
    superv_rmb       INTEGER DEFAULT 0,
    superv_usd       INTEGER DEFAULT 0,
    superv_vnd       INTEGER DEFAULT 0,

    -- 运费 & 保险：预算（三币种）
    fb_budget_rmb    INTEGER DEFAULT 0,
    fb_budget_usd    INTEGER DEFAULT 0,
    fb_budget_vnd    INTEGER DEFAULT 0,
    -- 运费 & 保险：实际（三币种）
    fb_actual_rmb    INTEGER DEFAULT 0,
    fb_actual_usd    INTEGER DEFAULT 0,
    fb_actual_vnd    INTEGER DEFAULT 0,

    -- 清关 & 内陆：预算（三币种）
    cc_budget_rmb    INTEGER DEFAULT 0,
    cc_budget_usd    INTEGER DEFAULT 0,
    cc_budget_vnd    INTEGER DEFAULT 0,
    -- 清关 & 内陆：实际（三币种）
    cc_actual_rmb    INTEGER DEFAULT 0,
    cc_actual_usd    INTEGER DEFAULT 0,
    cc_actual_vnd    INTEGER DEFAULT 0,

    -- 设备合计（三币种）
    total_equip_rmb  INTEGER DEFAULT 0,
    total_equip_usd  INTEGER DEFAULT 0,
    total_equip_vnd  INTEGER DEFAULT 0,

    -- 安装费：预算（三币种）
    inst_budget_rmb  INTEGER DEFAULT 0,
    inst_budget_usd  INTEGER DEFAULT 0,
    inst_budget_vnd  INTEGER DEFAULT 0,
    -- 安装费：实际（三币种）
    inst_actual_rmb  INTEGER DEFAULT 0,
    inst_actual_usd  INTEGER DEFAULT 0,
    inst_actual_vnd  INTEGER DEFAULT 0,

    -- EI 合计（三币种）
    total_ei_rmb     INTEGER DEFAULT 0,
    total_ei_usd     INTEGER DEFAULT 0,
    total_ei_vnd     INTEGER DEFAULT 0,

    -- 增值税 & 关税（三币种）
    vat_rmb          INTEGER DEFAULT 0,
    vat_usd          INTEGER DEFAULT 0,
    vat_vnd          INTEGER DEFAULT 0,

    -- 客户付款
    cust_pay_count   INTEGER DEFAULT 0,
    cust_paid_rmb    INTEGER DEFAULT 0,
    cust_paid_usd    INTEGER DEFAULT 0,
    cust_paid_vnd    INTEGER DEFAULT 0,
    cust_unpaid_rmb  INTEGER DEFAULT 0,
    cust_unpaid_usd  INTEGER DEFAULT 0,
    cust_unpaid_vnd  INTEGER DEFAULT 0,
    cust_view_detail  TEXT,
    cust_remark      TEXT,

    -- GS 佣金
    gs_comm_pct      REAL DEFAULT 0,
    gs_comm_rmb      INTEGER DEFAULT 0,
    gs_comm_usd      INTEGER DEFAULT 0,
    gs_comm_vnd      INTEGER DEFAULT 0,
    gs_pay_count     INTEGER DEFAULT 0,
    gs_paid_rmb      INTEGER DEFAULT 0,
    gs_paid_usd      INTEGER DEFAULT 0,
    gs_paid_vnd      INTEGER DEFAULT 0,
    gs_unpaid_rmb    INTEGER DEFAULT 0,
    gs_unpaid_usd    INTEGER DEFAULT 0,
    gs_unpaid_vnd    INTEGER DEFAULT 0,
    gs_view_detail   TEXT,
    gs_remark        TEXT,

    -- AGI 应付
    agi_payable_rmb  INTEGER DEFAULT 0,
    agi_payable_usd  INTEGER DEFAULT 0,
    agi_payable_vnd  INTEGER DEFAULT 0,
    agi_pay_count    INTEGER DEFAULT 0,
    agi_paid_rmb     INTEGER DEFAULT 0,
    agi_paid_usd     INTEGER DEFAULT 0,
    agi_paid_vnd     INTEGER DEFAULT 0,
    agi_unpaid_rmb   INTEGER DEFAULT 0,
    agi_unpaid_usd   INTEGER DEFAULT 0,
    agi_unpaid_vnd   INTEGER DEFAULT 0,
    agi_view_detail  TEXT,
    agi_remark       TEXT,

    -- 文档 & 补充协议
    doc_equip        TEXT,
    doc_install      TEXT,
    doc_both         TEXT,
    doc_addendum_cnt INTEGER DEFAULT 0,
    doc_view_addendum TEXT,
    doc_remark       TEXT
, attachments TEXT DEFAULT '[]', supp_summary TEXT DEFAULT '[]', created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '', warranty_rmb INTEGER DEFAULT 0, warranty_usd INTEGER DEFAULT 0, warranty_vnd INTEGER DEFAULT 0, warranty_start TEXT DEFAULT '', warranty_end TEXT DEFAULT '', owner_user_id TEXT DEFAULT '');


-- ============ 缓存表（不迁移） ============

-- 表: feed_cache | 行数: 4263  [缓存表·不迁移]
CREATE TABLE feed_cache (
        symbol TEXT, date TEXT, close REAL,
        PRIMARY KEY(symbol, date));

-- 表: fx_cache | 行数: 2634  [缓存表·不迁移]
CREATE TABLE fx_cache (
        pair TEXT, date TEXT, rate REAL,
        PRIMARY KEY(pair, date));

-- 表: livestock_farmgate | 行数: 1839  [缓存表·不迁移]
CREATE TABLE livestock_farmgate (
        item TEXT, country TEXT, ym TEXT,
        price_usd REAL, method TEXT, formula TEXT, source_url TEXT,
        UNIQUE(item,country,ym));

-- 表: livestock_history | 行数: 3264  [缓存表·不迁移]
CREATE TABLE livestock_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item TEXT NOT NULL,
            country TEXT NOT NULL,
            year_month TEXT NOT NULL,
            price_cny REAL,
            source TEXT DEFAULT 'anchor_cbot',
            created_at TEXT NOT NULL,
            UNIQUE(item, country, year_month)
        );

-- 表: livestock_meta | 行数: 8  [缓存表·不迁移]
CREATE TABLE livestock_meta (
        key TEXT PRIMARY KEY, value TEXT);

-- 表: livestock_price_cache | 行数: 810  [缓存表·不迁移]
CREATE TABLE livestock_price_cache (
            item TEXT NOT NULL,
            country TEXT NOT NULL,
            date TEXT NOT NULL,
            price REAL NOT NULL,
            currency TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            PRIMARY KEY (item, country, date)
        );

-- 表: livestock_retail | 行数: 958  [缓存表·不迁移]
CREATE TABLE livestock_retail (
        item TEXT, country TEXT, ym TEXT,
        price_usd REAL, unit TEXT, source_name TEXT, source_url TEXT, note TEXT,
        UNIQUE(item,country,ym));

-- 表: livestock_update_log | 行数: 3876  [缓存表·不迁移]
CREATE TABLE livestock_update_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            update_time TEXT NOT NULL,
            item TEXT, country TEXT, year_month TEXT,
            status TEXT, detail TEXT
        );

-- 表: metal_cache | 行数: 5388  [缓存表·不迁移]
CREATE TABLE metal_cache (
        symbol TEXT, date TEXT, close REAL,
        PRIMARY KEY(symbol, date));
