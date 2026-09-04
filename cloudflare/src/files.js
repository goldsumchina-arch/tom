// ============================================================
// 附件上传 / 下载模块（M7）· Cloudflare R2
// 文件存到你的 agi-pm-files 文件柜，不再存在本地 uploads 文件夹
// ============================================================

const ALLOWED_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".gif",
                     ".doc", ".docx", ".xls", ".xlsx", ".zip", ".rar"];

// R2 中的存储前缀，便于以后分类管理
const PREFIX_WON = "won/";
const PREFIX_CRM = "crm/";
const PREFIX_LOST = "lost/";

function errj(msg, status) {
  return { __err: msg, __status: status };
}

/** 只保留安全字符，避免路径穿越和乱码 */
function safeName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extOf(name) {
  const i = String(name || "").lastIndexOf(".");
  return i < 0 ? "" : String(name).slice(i).toLowerCase();
}

/** 从 multipart/form-data 中解析出文件 */
async function parseFile(request) {
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("multipart/form-data")) return null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (!f || typeof f === "string") return null;
    return f;
  } catch (e) {
    return null;
  }
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
         " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

export async function handleFiles(request, env, url, pathname) {
  // ============ POST /api/won-projects/<id>/attachments  上传 ============
  let m = /^\/api\/won-projects\/(\d+)\/attachments$/.exec(pathname);
  if (m && request.method === "POST") {
    const pid = parseInt(m[1], 10);
    const f = await parseFile(request);
    if (!f) return errj("no file", 400);
    if (!f.name) return errj("empty filename", 400);

    const ext = extOf(f.name);
    if (!ALLOWED_EXT.includes(ext)) return errj("ext not allowed", 400);

    const row = await env.DB.prepare(
      "SELECT id, attachments FROM won_projects WHERE id=?"
    ).bind(pid).first();
    if (!row) return errj("not found", 404);

    const buffer = await f.arrayBuffer();

    // PDF 校验文件头（防止改名伪造）
    if (ext === ".pdf") {
      const head = new Uint8Array(buffer.slice(0, 5));
      const sig = String.fromCharCode(...head);
      if (sig !== "%PDF-") return errj("invalid pdf", 400);
    }

    const key = PREFIX_WON + Date.now() + "_" + safeName(f.name);
    await env.FILES.put(key, buffer, {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });

    let atts = [];
    try { atts = row.attachments ? JSON.parse(row.attachments) : []; } catch (e) { atts = []; }
    atts.push({
      filename: key,
      original: f.name,
      ext: ext,
      uploaded_at: nowStamp(),
      url: "/api/files/" + key,
    });
    await env.DB.prepare(
      "UPDATE won_projects SET attachments=?, updated_at=datetime('now','localtime') WHERE id=?"
    ).bind(JSON.stringify(atts), pid).run();

    const nrow = await env.DB.prepare("SELECT * FROM won_projects WHERE id=?")
      .bind(pid).first();
    return { body: nrow, status: 200 };
  }

  // ============ DELETE /api/won-projects/<id>/attachments/<key> ============
  m = /^\/api\/won-projects\/(\d+)\/attachments\/(.+)$/.exec(pathname);
  if (m && request.method === "DELETE") {
    const pid = parseInt(m[1], 10);
    const key = decodeURIComponent(m[2]);
    const row = await env.DB.prepare("SELECT attachments FROM won_projects WHERE id=?")
      .bind(pid).first();
    if (!row) return errj("not found", 404);

    let atts = [];
    try { atts = row.attachments ? JSON.parse(row.attachments) : []; } catch (e) { atts = []; }
    atts = atts.filter((a) => a.filename !== key);
    await env.DB.prepare(
      "UPDATE won_projects SET attachments=?, updated_at=datetime('now','localtime') WHERE id=?"
    ).bind(JSON.stringify(atts), pid).run();

    try { await env.FILES.delete(key); } catch (e) { /* 文件不存在也无所谓 */ }

    const nrow = await env.DB.prepare("SELECT * FROM won_projects WHERE id=?")
      .bind(pid).first();
    return { body: nrow, status: 200 };
  }

  // ============ GET /api/files/<key...>  下载/预览 ============
  m = /^\/api\/files\/(.+)$/.exec(pathname);
  if (m && request.method === "GET") {
    const key = decodeURIComponent(m[1]);
    const obj = await env.FILES.get(key);
    if (!obj) return errj("file not found", 404);

    const headers = new Headers();
    headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
    // 用查询参数 ?dl=1 触发下载，否则内联预览（PDF 可在浏览器直接看）
    const dl = url.searchParams.get("dl");
    if (dl) {
      const base = key.split("/").pop();
      headers.set("Content-Disposition",
        'attachment; filename="' + encodeURIComponent(base) + '"');
    } else {
      headers.set("Content-Disposition", "inline");
    }
    headers.set("Cache-Control", "private, max-age=3600");
    return { __raw: new Response(obj.body, { status: 200, headers }) };
  }

  return null;
}
