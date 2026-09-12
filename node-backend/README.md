# AGI-PM 迁移版后端（腾讯云轻量应用服务器 2C4G / 香港）

把原后端业务逻辑（认证、CRM/签约/失败/审批、用户权限、附件、备注补翻、
价格快照、私密空间等）原样跑在 **腾讯云 Node + SQLite** 上，前端与 API 同一进程托管。
不再有单日写额度上限，也不再受第三方平台访问不稳的影响。

## 核心设计
- 业务代码：位于 `node-backend/src/`（已从 node-backend/src 迁入，单一源、不复制），`server.mjs` 通过 `import worker from "./src/index.js"` 引用。
- `d1shim.mjs`：把 D1 的 `prepare().bind().first/all/run` + `batch()` 映射到 better-sqlite3。
- `filesshim.mjs`：把 R2 的 `put/get/delete/list/head` 映射到本地磁盘（可换 COS）。
- `server.mjs`：Express 托管 `node-backend/dist`（同源版前端），并把每个请求转成 Web `Request`
  交给原 `worker.fetch(request, env, ctx)` 处理，再把 `Response` 回写 Express。
- 不注入外部平台配置 → 用量统计取不到 → 原 `quotaBlocks` 永远放行（无每日读额度限制）。
- 不给 `env.AI` → `/api/translate` 自动回退 Google(clients5)/MyMemory/Libre（香港出网顺畅）。

## 最简部署（推荐，一行命令）
把**整个仓库**传到服务器（git clone 或 scp -r），然后：
```bash
cd <仓库>/node-backend
sudo bash install.sh
```
脚本会自动装 Node 20、装依赖、生成 `.env`、用 pm2 守护，并提示去控制台放通 3000 端口。
配套文件：
- `agi-pm.service`：systemd 单元（想要开机自启/崩溃自拉，可用 `systemctl` 替代 pm2）。
- `nginx-agi-pm.conf`：nginx 反代模板（套域名 + HTTPS/certbot 用）。

## 部署到腾讯云香港轻量 2C4G（手动分步）
1. 系统选 Ubuntu/TencentOS，安装 Node 20（install.sh 已自动做，手动见下）：
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt-get install -y nodejs
   ```
2. 传代码：把**整个仓库**传到服务器（`git clone` 最省事；需包含 `node-backend/src` 业务代码
   与 `node-backend/dist` 同源前端，两者都在仓库内）。
3. 安装依赖（better-sqlite3 会拉预编译二进制，无需本地编译）：
   ```bash
   cd node-backend
   npm install
   cp .env.example .env   # 按需改 VAULT_PIN
   ```
4. 导入现有数据（见下）。
5. 启动（生产建议 pm2 守护）：
   ```bash
   node server.mjs
   # 或：npm i -g pm2 && pm2 start server.mjs --name agi-pm
   ```
6. 放通端口：轻量应用服务器防火墙放通 `3000`；要 HTTPS 就套 nginx + certbot（或腾讯 SSL）
   反代到 `127.0.0.1:3000`。

## 数据迁移（历史库 → 现 SQLite）
两种方式，二选一：
- **A. 全新启动（最简单）**：什么都不导，Tencent 上的 SQLite 为空库，首次启动自动建表。
  旧数据保留在旧平台不动。适合"换服务器=开新生产环境"。
- **B. 搬旧数据**：从旧库导出 SQL 后灌入 SQLite：
  ```bash
  # 在服务器灌入（先确保 node server.mjs 已跑过一次、已建表）
  sqlite3 node-backend/data/agi.db < /tmp/agi_dump.sql
  ```
> 缓存表（feed_cache/fx_cache/livestock_* 等）数据量大且可重新采集，可不导，
> 上线后由价格刷新逻辑重新拉取。

## 前端同源
`node-backend/dist/` 是**同源版**前端（由仓库根目录 `index.html` / `vault.html` 构建而来）：
`index.html` 的 `CLOUD_API`/`CLOUD_ONLY` 与 `vault.html` 的 `API_BASE` 均已清空，
浏览器直连本服务器域名即同源，无需跨域、不再转发任何外部平台。
同源改动只留在 `node-backend/dist/`（或回改根目录源文件后重建）。

## 验证
`npm install && node server.mjs` 后访问 `http://<服务器IP>:3000/api/health`，
应返回各表行数；`/api/perm-version?username=tom` 应正常。

## 备注
- 本仓库编写环境的 shell 无 node，未在本机运行验证；请在腾讯服务器安装依赖后实测。
- 翻译依赖外网（Google/MyMemory/Libre），香港节点访问正常；如需更稳定可接翻译 API Key。
