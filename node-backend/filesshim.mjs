// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件（R2 兼容层）逻辑已锁定，未经用户明确同意禁止修改。
// ============================================================
// R2 兼容适配层（本地磁盘版）
// 实现 Cloudflare R2 的 put / get / delete / list / head 接口，
// 用服务器本地磁盘目录替代 R2 桶。后续若要更耐久，可换成腾讯云 COS
// （接口形态一致，只改本文件实现）。
// ============================================================
import fs from "fs";
import path from "path";
import { Readable } from "stream";

function makeFiles(rootDir) {
  fs.mkdirSync(rootDir, { recursive: true });

  // 把 R2 key（允许含 /）映射到本地路径，并防穿越
  function keyToPath(key) {
    const parts = String(key).split("/").filter(Boolean).map((p) =>
      p.replace(/[\\/:*?"<>|]/g, "_")
    );
    return path.join(rootDir, ...parts);
  }

  function bufOf(data) {
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (data instanceof Uint8Array) return Buffer.from(data);
    if (Buffer.isBuffer(data)) return data;
    return Buffer.from(String(data));
  }

  function metaPath(p) {
    return p + ".meta.json";
  }

  return {
    async put(key, data, opts = {}) {
      const p = keyToPath(key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, bufOf(data));
      const contentType =
        (opts && opts.httpMetadata && opts.httpMetadata.contentType) ||
        "application/octet-stream";
      fs.writeFileSync(metaPath(p), JSON.stringify({ contentType }));
      return { success: true };
    },

    async get(key) {
      const p = keyToPath(key);
      if (!fs.existsSync(p)) return null;
      const buf = fs.readFileSync(p);
      const meta = fs.existsSync(metaPath(p))
        ? JSON.parse(fs.readFileSync(metaPath(p), "utf8"))
        : { contentType: "application/octet-stream" };
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(buf));
          c.close();
        },
      });
      return {
        body,
        httpMetadata: meta,
        contentType: meta.contentType,
        async arrayBuffer() {
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
        async text() {
          return buf.toString("utf8");
        },
        async json() {
          return JSON.parse(buf.toString("utf8"));
        },
      };
    },

    async delete(key) {
      const p = keyToPath(key);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      if (fs.existsSync(metaPath(p))) fs.unlinkSync(metaPath(p));
    },

    async head(key) {
      const p = keyToPath(key);
      if (!fs.existsSync(p)) return null;
      const st = fs.statSync(p);
      return { size: st.size, contentType: "application/octet-stream" };
    },

    // list({prefix, cursor, limit}) → { objects:[{key}], truncated, cursor }
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const out = [];
      const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            walk(full);
          } else if (!ent.name.endsWith(".meta.json")) {
            const rel = path
              .relative(rootDir, full)
              .split(path.sep)
              .join("/");
            if (rel.startsWith(prefix)) out.push({ key: rel, size: fs.statSync(full).size });
          }
        }
      };
      walk(rootDir);
      const sliced = out.slice(0, limit);
      return {
        objects: sliced,
        truncated: out.length > limit,
        cursor: out.length > limit ? String(limit) : undefined,
      };
    },
  };
}

export { makeFiles };
