// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件（腾讯云用量/磁盘数据）逻辑已锁定，未经用户明确同意禁止修改。该模块是“用量监控”面板的正确数据源，禁止改动。
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";

const execAsync = promisify(exec);
const SESSION_TTL_HOURS = 168; // 与 cloudflare/src/index.js 保持一致

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function readFile(path) {
  try { return fs.readFileSync(path, "utf8"); } catch { return ""; }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------- CPU ---------- */
function cpuSnapshot() {
  const cpus = os.cpus();
  let total = 0, idle = 0;
  cpus.forEach((c) => {
    const t = c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
    total += t;
    idle += c.times.idle;
  });
  return { total, idle, cores: cpus.length };
}

async function getCpuUsage() {
  const s0 = cpuSnapshot();
  await sleep(600);
  const s1 = cpuSnapshot();
  const totalDiff = s1.total - s0.total;
  const idleDiff = s1.idle - s0.idle;
  const percent = totalDiff > 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDiff / totalDiff))) : 0;
  return { percent: Number(percent.toFixed(3)), cores: s1.cores };
}

/* ---------- Memory ---------- */
function getMemoryUsage() {
  const text = readFile("/proc/meminfo");
  const map = {};
  text.split("\n").forEach((line) => {
    const m = line.match(/^(\w+):\s*(\d+)/);
    if (m) map[m[1]] = parseInt(m[2], 10) * 1024; // kB -> bytes
  });
  const total = map.MemTotal || os.totalmem();
  const available = map.MemAvailable || (map.MemFree + map.Buffers + map.Cached) || os.freemem();
  const used = Math.max(0, total - available);
  return {
    total,
    used,
    free: available,
    percent: total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0,
  };
}

/* ---------- System disk ---------- */
async function getDiskUsage() {
  try {
    const { stdout } = await execAsync("df -B1 -P /");
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) throw new Error("df output empty");
    const parts = lines[1].trim().split(/\s+/);
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const free = parseInt(parts[3], 10);
    const pct = parseFloat(parts[4].replace("%", ""));
    return { total, used, free, percent: isNaN(pct) ? 0 : pct };
  } catch (e) {
    return { total: 0, used: 0, free: 0, percent: 0, error: String(e.message || e) };
  }
}

/* ---------- Disk IO ---------- */
async function getDiskDevice() {
  try {
    const { stdout } = await execAsync("lsblk -dn -o NAME,TYPE | awk '$2==\"disk\"{print $1; exit}'");
    return stdout.trim() || "vda";
  } catch {
    return "vda";
  }
}

function getDiskIoStats(dev) {
  const text = readFile("/proc/diskstats");
  const lines = text.split("\n");
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[2] === dev) {
      return {
        readSectors: parseInt(parts[5], 10) || 0,
        writeSectors: parseInt(parts[9], 10) || 0,
      };
    }
  }
  return { readSectors: 0, writeSectors: 0 };
}

function getSectorSize(dev) {
  const text = readFile(`/sys/block/${dev}/queue/hw_sector_size`);
  const n = parseInt(text.trim(), 10);
  return isNaN(n) ? 512 : n;
}

async function getDiskIoRate(dev) {
  if (!dev) dev = await getDiskDevice();
  const sector = getSectorSize(dev);
  const s0 = getDiskIoStats(dev);
  await sleep(1000);
  const s1 = getDiskIoStats(dev);
  const readBytes = Math.max(0, (s1.readSectors - s0.readSectors) * sector);
  const writeBytes = Math.max(0, (s1.writeSectors - s0.writeSectors) * sector);
  return {
    readKBps: Number((readBytes / 1024).toFixed(3)),
    writeKBps: Number((writeBytes / 1024).toFixed(3)),
  };
}

/* ---------- Network ---------- */
function getNetworkSnapshot() {
  const text = readFile("/proc/net/dev");
  const lines = text.split("\n").slice(2);
  for (const line of lines) {
    const [name, data] = line.trim().split(":");
    if (!name || name === "lo") continue;
    const vals = data.trim().split(/\s+/).map(Number);
    return { iface: name.trim(), rx: vals[0] || 0, tx: vals[8] || 0 };
  }
  return { iface: "", rx: 0, tx: 0 };
}

async function getNetworkRate() {
  const s0 = getNetworkSnapshot();
  await sleep(1000);
  const s1 = getNetworkSnapshot();
  const rxBps = s1.rx - s0.rx;
  const txBps = s1.tx - s0.tx;
  return {
    iface: s1.iface || s0.iface,
    inMbps: Number((Math.max(0, rxBps) * 8 / 1e6).toFixed(6)),
    outMbps: Number((Math.max(0, txBps) * 8 / 1e6).toFixed(6)),
  };
}

/* ---------- Tencent traffic package ---------- */
async function getTencentTrafficPackage() {
  const secretId = env("TENCENT_SECRET_ID");
  const secretKey = env("TENCENT_SECRET_KEY");
  const region = env("TENCENT_REGION", "ap-hongkong");
  const instanceId = env("TENCENT_INSTANCE_ID", "lhins-8ohhzlgv");
  if (!secretId || !secretKey) {
    return null;
  }
  try {
    const tencentcloud = await import("tencentcloud-sdk-nodejs");
    const common = tencentcloud.common;
    const LighthouseClient = tencentcloud.lighthouse.v20200324.Client;
    const client = new LighthouseClient({
      credential: new common.Credential(secretId, secretKey),
      region,
      profile: { signMethod: "TC3-HMAC-SHA256" },
    });
    const resp = await client.DescribeInstancesTrafficPackages({ InstanceIds: [instanceId] });
    const set = (resp && resp.TrafficPackageSet) || [];
    for (const item of set) {
      if (item.InstanceId === instanceId) {
        const pkgs = item.TrafficPackageSet || [];
        const pkg = pkgs[0] || {};
        return {
          total: Number(pkg.Total || 0),
          used: Number(pkg.Used || 0),
          remaining: Number(pkg.Remaining || 0),
          unit: pkg.Unit || "GB",
          resetTime: pkg.NextResetTime || "",
        };
      }
    }
    return null;
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/* ---------- Public API ---------- */
export async function getSystemMetrics() {
  const [cpu, memory, disk, diskIo, network] = await Promise.all([
    getCpuUsage(),
    getMemoryUsage(),
    getDiskUsage(),
    getDiskIoRate(),
    getNetworkRate(),
  ]);
  return { cpu, memory, disk, diskIo, network };
}

export { getDiskUsage };

export async function getTencentUsage() {
  const [metrics, traffic] = await Promise.all([
    getSystemMetrics(),
    getTencentTrafficPackage(),
  ]);
  return { metrics, traffic, updatedAt: new Date().toISOString() };
}

function expiresLocalStr() {
  const d = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function authenticateRequest(req, db) {
  let token = "";
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) token = auth.slice(7).trim();
  if (!token) {
    const m = (req.headers.cookie || "").match(/session=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return null;
  try {
    const row = db.prepare("SELECT username, expires_at FROM sessions WHERE token = ?").get(token);
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at + "Z").getTime() < Date.now()) return null;
    // ★ 滑动续期：每次有效请求都延后过期时间
    try {
      db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(expiresLocalStr(), token);
    } catch (e) { /* 续期失败不影响本次请求 */ }
    return row.username;
  } catch {
    return null;
  }
}
