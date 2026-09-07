# AGI-PM 安卓 APP（M8）

把已上线的网页版 CRM 打包成安卓 APP。本质是"网页壳"（WebView），
好处是网页改了内容 APP 不用重新打包。

---

## 一、已生成的文件

| 文件 | 说明 |
|---|---|
| `apk/AGI-PM-v1.0-debug.apk` | **安装包**，直接发到手机安装 |
| `logo_agi.svg` | AGI 徽标源文件（与网页登录页一致） |
| `make_app_icons.py` | 图标生成脚本（改 logo 后重跑） |

---

## 二、核心特性

### 1. 系统级强制横屏 ✅

这是 APP 相对网页的最大优势。

- 网页版：只能"提示旋转"或 CSS 旋转，**无法真正锁定**
- 安卓 APP：`AndroidManifest.xml` 里配置 `sensorLandscape`，**系统级锁定**

手机无论怎么转，APP 始终横屏显示。

### 2. 沉浸式全屏

隐藏状态栏，表格可视区域最大化，横屏下能多显示一行。

### 3. Logo 使用网页同款

登录页那个 **AGI 五角星徽标**（AGI 三色字母 + 5 颗蓝星）已经做成 APP 图标，
支持 Android 8+ 自适应图标。

### 4. 附件上传/下载打通

- 上传：`<input type="file">` → 调系统文件选择器 → 存到 R2（`agi-pm-files`）
- 下载：走系统下载器，通知栏可看进度

### 5. 返回键逻辑

- 网页能后退 → 后退
- 已到首页 → 2 秒内再按一次才退出（防误触）

---

## 三、安装到手机

### 方法 A：USB 线传（最稳）

1. 手机开启"开发者选项"→"USB 调试"
2. 用数据线连电脑
3. 电脑上执行：
   ```bash
   adb install -r android\apk\AGI-PM-v1.0-debug.apk
   ```

### 方法 B：发文件到手机

1. 把 `AGI-PM-v1.0-debug.apk` 通过微信/QQ/邮件发到自己手机
2. 手机点开安装
3. 若提示"未知来源"，按提示允许（这是正常的安全提示，因为是自己签名的包）

> 安装后桌面上会出现 **AGI-PM** 图标（AGI 五角星徽标），点开就是横屏的 CRM 系统。

---

## 四、重新打包

修改了网页内容 → **不需要重新打包**，APP 打开就是最新的。

只有改了这些才需要重新打包：
- APP 网址
- 图标 / LOGO
- 横屏等原生设置

重新打包命令：

```bash
cd android
.\gradlew.bat assembleDebug
```

产物在 `app\build\outputs\apk\debug\app-debug.apk`

---

## 五、发布正式版（可选）

现在打的是 **debug 包**（调试签名），适合自己用和发给同事。

若要上架应用商店，需要打 **release 包**并配置正式签名，步骤：

1. 生成签名密钥（`.jks`）
2. 在 `app/build.gradle.kts` 里配置 `signingConfigs`
3. 执行 `.\gradlew.bat assembleRelease`

需要时告诉我，我帮你配置。

---

## 六、环境说明

| 项目 | 版本 |
|---|---|
| Android Studio | 已安装 |
| JDK | 21（Android Studio 自带 jbr） |
| compileSdk | 35（Android 15） |
| minSdk | 24（Android 7.0，覆盖 99% 在用设备） |
| Gradle | 8.9 |
| APP ID | `com.agipm.app`（发布后不可更改） |

---

## 七、常见问题

**Q：打开后白屏？**
A：检查手机网络。APP 需要联网访问 `agi-gs.pages.dev`。

**Q：提示"无法安装"？**
A：先卸载手机上的旧版本（如果之前装过），或开启"允许未知来源"。

**Q：横屏还是竖屏？**
A：`sensorLandscape` 是横屏。个别定制 ROM 可能忽略此设置，代码里已加兜底强制。

**Q：想改回竖屏？**
A：把 `AndroidManifest.xml` 里的 `sensorLandscape` 改成 `portrait`，重新打包。
