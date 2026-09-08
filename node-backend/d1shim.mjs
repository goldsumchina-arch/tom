// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件（D1 兼容层）逻辑已锁定，未经用户明确同意禁止修改。
// ============================================================
// D1 兼容适配层
// 把 Cloudflare D1 的接口（prepare().bind().first()/all()/run() 与 batch()）
// 映射到 better-sqlite3，使原 Worker 业务代码（src/*.js）无需改动即可运行。
// ============================================================
import Database from "better-sqlite3";

function makeStmt(db, sql) {
  const stmt = db.prepare(sql);

  // 无 .bind() 直接调用时，args 为空
  async function exec(method, args) {
    if (method === "first") {
      const r = stmt.get(...args);
      return r === undefined ? null : r;
    }
    if (method === "all") {
      const rows = stmt.all(...args);
      return { results: rows, success: true, meta: {} };
    }
    // run
    const info = stmt.run(...args);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }

  const api = {
    bind(...args) {
      return {
        async first() { return exec("first", args); },
        async all() { return exec("all", args); },
        async run() { return exec("run", args); },
      };
    },
    async first() { return exec("first", []); },
    async all() { return exec("all", []); },
    async run() { return exec("run", []); },
  };
  return api;
}

export function makeD1(dbOrPath) {
  const db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    _raw: db,
    prepare(sql) {
      return makeStmt(db, sql);
    },
    // D1 batch：执行一组已 bind 的语句，放进一个事务里
    async batch(statements) {
      const tx = db.transaction((sts) => {
        for (const s of sts) {
          if (s && typeof s.run === "function") s.run();
        }
      });
      tx(statements);
      return { success: true };
    },
  };
}
