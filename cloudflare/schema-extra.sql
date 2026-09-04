-- M3 需要的附加表：存放系统级键值信息（如权限版本号）
-- 导入：wrangler d1 execute agi-pm-db --remote --file=schema-extra.sql
CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
