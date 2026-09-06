# AGI-PM 上云操作手册

> 这是给初学者写的**手把手步骤**。每一条命令都可以直接复制粘贴。
> 遇到看不懂的名词，先看最下面的「名词对照表」。

---

## 🗺️ 整体路线图（9 个里程碑，每完成一个都能看到效果）

| 阶段 | 目标 | 完成后你能看到什么 |
|---|---|---|
| **M1** | 环境跑通，部署第一个云端程序 | 手机浏览器打开网址，看到欢迎页 ✅ |
| **M2** | 建 D1 云数据库，导入 8 张核心表 | 云上有了你的用户和业务数据 |
| **M3** | 登录接口上云（密码无感加密升级） | 能登录了，且密码变安全 |
| **M4** | CRM 潜在项目模块上云 | 潜在项目增删改查走云端 |
| **M5** | 签约项目（WON）上云 | 合同、佣金、付款 |
| **M6** | 失败项目（LOST）+ 审批流上云 | 完整业务闭环 |
| **M7** | 附件上传改到 R2（agi-pm-files） | 合同 PDF 存云端，换电脑不丢 |
| **M8** | 安卓 APP（Android Studio 打包 APK） | 手机桌面有图标，像真 APP |
| **M9** | 价格模块用定时任务 + R2 替代 | 不再依赖你电脑开机抓数据 |

**原则**：每个阶段独立可用，出问题随时退回上一阶段。现有 Python 系统全程保留不动，直到全部验证完毕。

---

## 📋 准备工作清单

- [ ] Cloudflare 账号（你已有，登录名 `tomalso911@qq.com`）
- [ ] R2 文件柜 `agi-pm-files`（你已建好）
- [ ] Node.js（你电脑上已有 v22.22.2）

---

## 🚀 M1 阶段：让第一个程序跑上云

### 第 1 步：进入开发环境

**双击项目根目录下的 `cloudflare-dev.bat`**

会弹出一个黑色命令行窗口，显示类似：

```
============================================
  AGI-PM Cloudflare 开发环境
============================================

  当前目录: C:\gs-project\cloudflare

v22.22.2
  npm  : 10.9.7
  wrangler: (尚未安装，见 README)
```

> ⚠️ 以后所有命令都在这个黑窗口里输入，**不要用普通的 PowerShell**。
> 因为 Node.js 没装进系统 PATH，只有这个窗口帮你配好了。

### 第 2 步：安装 Wrangler（Cloudflare 的命令行工具）

在黑窗口里粘贴，回车：

```bash
npm install -g wrangler
```

- 会下载约 1-3 分钟，屏幕滚动是正常的
- 完成后验证：

```bash
wrangler -v
```

看到类似 `⛅ wrangler 3.x.x` 就成功了。

### 第 3 步：登录 Cloudflare 账号

```bash
wrangler login
```

- 会**自动打开浏览器**，让你登录 Cloudflare 账号并点「Allow」授权
- 授权后黑窗口显示 `Successfully logged in` 即可

> 💡 如果浏览器没自动弹出，黑窗口会显示一个网址，手动复制到浏览器打开。

### 第 4 步：发布到 Cloudflare

```bash
wrangler deploy
```

第一次会问你「是否创建新的 Worker 项目」，输入 `y` 回车。

成功后会显示类似：

```
Total Upload:    xx KiB / gzip: xx KiB
Uploaded agi-pm-api (x.xx sec)
Published agi-pm-api (x.xx sec)
  https://agi-pm-api.xxxxxx.workers.dev
Current Deployment ID: xxxxxxxx
```

### 第 5 步：验证（有成就感的一步 🎉）

1. 复制那个 `https://agi-pm-api.xxxxxx.workers.dev` 网址
2. **在电脑浏览器打开** → 应该看到紫色渐变欢迎页
3. **在手机浏览器打开同一个网址** → 同样能看到（这就是你未来的 APP 入口！）

> 📱 把这个网址存到手机书签，M8 阶段会用到。

再试试接口：

```
https://agi-pm-api.xxxxxx.workers.dev/api/health
```

应该返回：

```json
{
  "ok": true,
  "stage": "M1",
  "message": "云端后端运行正常",
  "services": {
    "r2_files": true,
    "d1_database": false
  }
}
```

`r2_files: true` 说明**你的 agi-pm-files 文件柜已经连通了**；
`d1_database: false` 是正常的，M2 阶段会变成 true。

---

## 🔧 常用命令速查

| 命令 | 作用 |
|---|---|
| `wrangler dev` | 在本地模拟运行（改代码自动刷新，调试用） |
| `wrangler deploy` | 发布上线 |
| `wrangler tail` | 实时查看线上日志（排错神器，Ctrl+C 退出） |
| `wrangler whoami` | 查看当前登录的账号 |

> `wrangler dev` 会在本地开一个 `http://localhost:8787`，改代码存盘就自动生效，
> **不会**影响线上。调好了再 `deploy`。

---

## 📁 目录说明

```
cloudflare/
├── wrangler.toml    ← 配置文件：项目名、接了哪些服务
├── package.json     ← 项目说明：可用 npm run dev / deploy
├── schema.sql       ← 你现有数据库的表结构（M2 建表要用）
└── src/
    └── index.js     ← 后端主程序（所有接口都写在这里）
```

---

## 📖 名词对照表

| 名词 | 解释 |
|---|---|
| **Worker** | 跑在 Cloudflare 全球机房里的一段小程序，替代你现在的 `app.py` |
| **Wrangler** | 管理 Worker 的命令行工具，相当于 Python 的 `pip` |
| **D1** | Cloudflare 的云端 SQLite 数据库，替代 `agi_pm.db` |
| **R2** | 云端文件柜，就是 `agi-pm-files`，放合同/报价单 PDF |
| **binding（绑定）** | 把 R2/D1 "接" 到代码里，之后用 `env.FILES`、`env.DB` 操作 |
| **deploy** | 发布，把你电脑上的代码传到 Cloudflare 上线 |
| **npm** | Node.js 的软件安装工具 |

---

## ❓ 遇到问题怎么办

**Q：`wrangler: command not found`**
A：你没在 `cloudflare-dev.bat` 打开的窗口里操作，关掉重来。

**Q：deploy 报错说 `agi-pm-api` 名字被占用**
A：改 `wrangler.toml` 第一行的 `name`，比如改成 `agi-pm-api-tomal`，保存后重新 deploy。

**Q：登录后还是提示未授权**
A：执行 `wrangler whoami` 确认账号是不是 `tomalso911@qq.com`。不对就 `wrangler logout` 再重新 `wrangler login`。

**Q：手机上打不开网址**
A：先确认电脑能打开。如果电脑能手机不能，可能是网络限制，M8 打包 APK 后走 WebView 会改善。

---

## ⏭️ M1 完成后

把第 5 步的网址发给我，我们进入 **M2：建 D1 数据库并导入你的业务数据**。
