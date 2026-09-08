# AGI-PM 暗门（隐藏入口）清单

> 🔒 **本文件已锁定。未经作者明确书面同意，禁止修改、删除、重命名或提交到任何公开代码仓库。**
>
> 本文件记录系统内所有「隐藏入口 / 彩蛋 / 暗门」的触发方式。
> **任何 UI 改动（尤其是顶部导航栏、Logo、用户头像、导航按钮）之前，必须先对照本清单，
> 确认不会破坏下列入口。**

- 记录日期：2026-09-08
- 代码基准（行号以此为准）：
  - `node-backend/dist/index.html` —— 部署版前端（含全部暗门逻辑）
  - `android/app/src/main/java/com/agipm/app/MainActivity.kt` —— 安卓壳
- ⚠️ 安全提示：`node-backend/` **未被 git 跟踪**，因此暗门逻辑目前**没有**暴露在公开仓库。
  本文件**严禁**提交到公开的 `goldsumchina-arch/tom` 仓库。

---

## 一、暗门清单（共 4 个主入口 + 2 个附属机制）

### ① 个人佣金 —— AGI Logo 连点 5 次 + 按住 3 秒

| 项目 | 内容 |
|---|---|
| 载体元素 | `.tb-logo`（顶部导航左侧 Logo，含 SVG 图标 + `AGI` + `-CRM` 文字） |
| DOM 位置 | `node-backend/dist/index.html` 第 **2913–2936** 行（`<div class="tb-logo">`） |
| 触发手势 | 连点 **5 次**（两次间隔 ≤ 3 秒）→ 之后任意一次**按住 3 秒** |
| 效果 | 显示 `#tbCommission` 标签（加 `commission-revealed` class），进入个人佣金页 |
| 代码位置 | 第 **13731–13781** 行：`initCommissionEasterEgg()`（13737 起）；`TAP_WINDOW=3000`（13740）、`HOLD_MS=3000`（13741）、判定 `tapCount>=5`（13770） |
| 相关 CSS | 第 **1616–1617** 行：`#tbCommission` 默认 `display:none`，解锁后 `display:inline-block` |
| **破坏后果** | **隐藏/缩小/删除 Logo → 此入口永久失效** |

### ② 私密空间（Vault）—— 橙色 "T" 头像连点 5 次 + 长按 3 秒

| 项目 | 内容 |
|---|---|
| 载体元素 | `.tb-user-avatar`（顶栏右侧橙色圆形头像，文字为 `T`，`id=tbUserAvatar`） |
| DOM 位置 | 第 **2959** 行 |
| 触发手势 | 连点 **5 次**（间隔 ≤ 1.5 秒）→ 再**长按 3 秒** |
| 生效条件 | 仅 `tom`（`_vaultAllowed()` 校验，非 tom 直接放弃手势） |
| 效果 | `openVaultPin()` 弹出 4 位 PIN 输入框 |
| 代码位置 | 第 **29920–29971** 行；`clickCount>=5`（29960）、`openVaultPin()`（29970） |
| **破坏后果** | **隐藏/删除 T 头像 → 此入口永久失效** |

### ③ 清理残留 / 云端用量报告 —— 同一个 "T" 头像直接长按 5 秒

| 项目 | 内容 |
|---|---|
| 载体元素 | 同 ② `.tb-user-avatar` |
| 触发手势 | **未**点满 5 次时，**直接长按 5 秒** |
| 效果 | `openD1Choose()` 弹出「清理残留文件 / 查看使用量」二选一选框（不直接执行删除，防误触） |
| 代码位置 | 第 **29974–29981** 行；`openD1Choose()`（29980） |
| **破坏后果** | **隐藏/删除 T 头像 → 此入口永久失效** |

### ④ 当月更新情况 —— 顶部「Dashboard / 看板」按钮长按 3 秒

| 项目 | 内容 |
|---|---|
| 载体元素 | 顶部导航第一个按钮 `<button class="tb-item active" data-view="dashboard">Dashboard</button>` |
| DOM 位置 | 第 **2938** 行（绑定 `onpointerdown="onDashNavPressStart(event)"` 等） |
| 触发手势 | **长按 3 秒** |
| 效果 | 打开「当月更新情况」模态框 |
| 代码位置 | 第 **22729–22745** 行：`onDashNavPressStart`（22731）、`onDashNavPressEnd`（22741）、`onDashNavPressCancel`（22745） |
| **破坏后果** | **把导航移到底部栏 / 删除该按钮 → 此入口失效**（若必须移，需把长按逻辑一并迁移到新按钮） |

### ⑤ 附属机制：佣金页退出彩蛋

- 位置：第 **10565–10580** 行
- 规则：黄色按钮退出；右键弹三语确认；**1 秒内连击 5 次**直接退出；**闲置 5 分钟整页模糊 → 再 3 分钟自动退出**
- 常量：`COMM_CLICK_TIMES = 5`（10578）、`COMM_CLICK_WINDOW = 1000`（10577）

### ⑥ 附属机制：安卓返回键 + 网页回退桥

- `MainActivity.kt`：
  - `HOME_URL` / `FALLBACK_URL`（第 **58–62** 行）
  - 返回栈状态变量 `webCanGoBack`、`lastBackPressedTime`（第 **115–126** 行）
  - `setupBackPress()`（第 **528–551** 行）：单击 → 网页回退；双击（2 秒内）→ 退出
  - `handleNativeBack()`（第 **556–568** 行）：`webView.goBack()` 兜底
  - `onKeyDown()`（第 **719–723** 行）：统一交 `OnBackPressedDispatcher`
  - `AndroidBridge.setBackState()`（第 **765–769** 行）：网页可回退状态同步
- 网页侧：`window.__handleBack` 包装（第 **31879–31883** 行），回退后立即同步状态给原生

---

## 二、运行时硬保护（自 V2026.09.08.04 起生效）

APP 在每次页面加载完成后，会向页面注入一段样式表
（`android/app/src/main/res/raw/mobile_css.css`，由 `MainActivity.injectMobileCss()` 注入）。

该样式表**开头**就是对三个暗门载体的强制保护：

```css
.tb-logo,
.tb-user-avatar,
.tb-item[data-view="dashboard"] {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  z-index: 1001 !important;
}
```

作用：只要这段还在，**任何后续样式都无法隐藏这三个入口**，因此四个暗门不会因 UI 调整而丢失。

同时 APP 会在注入后**自动校验**三个载体是否存在，结果写入日志：
- `HIDDEN-ENTRY GUARD: OK` → 三者都在
- `HIDDEN-ENTRY GUARD: FAILED` → 有载体丢失，必须立即回滚

> 注意：`index.html` 本体**仍然零改动**，所有样式都来自 APK 注入，回滚 = 装回旧 APK。

## 三、保护红线（改 UI 时绝对不能碰）

1. **不隐藏、不删除、不缩小 `.tb-logo`**（顶部 AGI-CRM Logo）→ 否则暗门 ① 死
2. **不隐藏、不删除 `.tb-user-avatar`**（橙色 T 头像）→ 否则暗门 ②③ 死
3. **不删除顶部 `Dashboard` 按钮**；若改为底部导航，必须**先迁移长按 3 秒逻辑** → 否则暗门 ④ 死
4. **不要在全局禁用长按**（如 `user-select:none` / `-webkit-touch-callout:none` / 屏蔽长按菜单）→ 与 ②③④ 的长按手势直接冲突
5. 注入 CSS 时，**选择器必须绕开** `.tb-logo`、`.tb-user-avatar`、`.tb-item[data-view="dashboard"]`

## 四、改动流程（每次必做）

1. 动手前：`git commit` 留还原点；服务器文件先 `cp xxx xxx.bak-时间戳`
2. 对照本清单，确认本次改动不触碰上述红线
3. 改完后，按下节「验收清单」**逐条实测**
4. 任一条不通过 → 立即回滚

## 五、验收清单（每次改 UI 后必须在手机上逐条验证）

- [ ] ① Logo 连点 5 次 + 按住 3 秒 → 出现「个人佣金」入口
- [ ] ② T 头像连点 5 次 + 长按 3 秒 → 弹出 PIN 输入框（仅 tom）
- [ ] ③ T 头像直接长按 5 秒 → 弹出「清理 / 查看使用量」选择框
- [ ] ④ 顶部 Dashboard 长按 3 秒 → 打开「当月更新情况」模态框
- [ ] ⑤ 佣金页连击 5 次可退出、闲置会自动模糊退出
- [ ] ⑥ 返回键：单击回退上一页、双击退出 APP

---

> 🔒 **锁定状态说明**
> - 本文件已设为**只读属性**（解除：`attrib -R HIDDEN_ENTRIES.md`）
> - 已加入 `.git/info/exclude`，**即使执行 `git add .` 也不会被提交**
> - 副本存放于 OneDrive：`agi-pm-backup\docs\HIDDEN_ENTRIES.md`
