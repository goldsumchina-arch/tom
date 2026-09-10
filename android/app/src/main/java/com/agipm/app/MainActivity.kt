package com.agipm.app

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.content.ContentValues
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * AGI-PM 安卓主界面
 *
 * 本质是一个"网页壳"：把已上线的网页版 CRM 装进 APP。
 * 好处是网页改了内容 APP 不用重新打包，坏处是必须联网。
 *
 * 关键特性：
 *   1. 系统级强制横屏（Manifest 里配置 sensorLandscape）
 *   2. 沉浸式全屏：状态栏/导航栏默认隐藏，边缘滑动可临时唤出（自动退回）
 *   3. 网页内的返回逻辑优先于退出 APP
 *   4. 支持上传/下载附件（打通 R2 文件柜）
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "AGIPM"

        // ★ 系统网址：腾讯云生产前端（HTTPS 域名，经 nginx 反代 + gzip 压缩，约 589KB）
        //   域名由服务器上的 duckdns_keepalive.sh 每 25 天自动续期保活，无需人工维护。
        private const val HOME_URL = "https://agi-goldsum-crm.duckdns.org"

        // ★ 备用网址：域名解析或 HTTPS 异常时，直连服务器 IP + 端口兜底
        //   （约 1.9MB 未压缩，比主地址慢，仅作为冗余备份）
        private const val FALLBACK_URL = "http://124.156.134.135:3000"

        // 网页版本号：每次更新网页后调大这个数字，
        // APP 启动时会比对本地记录，发现版本变了就自动清缓存重新加载。
        // 这样用户不需要手动下拉刷新，也不需要重装 APP。
        // v1.16：修复手机登录失败 —— 账号大小写不再敏感（手机键盘首字母会大写，
        // 输入 tom 变成 Tom 就登不进去）。升到 16 后，老用户打开 APP 自动清缓存拿新页面。
        //
        // ★ 这是【网页内容版本】，与 app/build.gradle.kts 的 versionName 末段无关。
        //   versionName 末段是"当天第几次更改"（每天从 01 起算），
        //   而这里是累计的网页版本，只在网页（index.html 等）有更新时 +1。
        //   作用：APP 启动发现这个数字变了 → 自动清 WebView 缓存 → 拉到最新网页，
        //   用户无需手动下拉刷新或重装 APP。
        //
        // v39：修复长按「看板」3 秒的「当月更新情况」弹窗显示乱码 ——
        //       /api/dashboard-update-status 未加入 CLOUD_ONLY 转发名单，
        //       Pages 静态站返回 HTML 错误页导致解析失败（同时补上 login-history）。
        //
        // v40：三语跟随专项修复 ——
        //       ① 图表标题防回退（快速切语言不再变中文）
        //       ② 全部项目概况 标题/副标题/货币
        //       ③ 导出PDF / 关闭 三语
        //       ④ 付款智能报告跟随主界面语言
        //       ⑤ 复制项目 取消/确认 三语
        //       ⑥ 明细弹窗 关闭 三语
        //       ⑦ 删除确认红字随语言即时刷新
        //       ⑧ 首行↑/末行↓ 置灰禁用 + 移动后表头不再被顶走
        //       （每次网页有改动都必须 +1，否则手机端不会清缓存拉新页面）
        // v41：概况弹窗区块标题（签约方/销售分析/佣金统计/AGI-GS统计）三语跟随 +
        //       明细弹窗整体重渲染 + 付款报告可见性判断加固
        // v51：看板聚合接口白名单 + 路由修复（2026-09-06）
        // v52：恢复三语备注锁死逻辑（V2026.09.08.16）
        // v53：离线只读缓存扩大到用户权限范围内全部数据（V2026.09.08.17）
        // v54：修复 WebResourceResponse MIME 携带 charset 导致显示源码的 bug（V2026.09.08.18）
        // v55：修复离线会话注入（putSession 从未调用 → 断网进不去）（V2026.09.08.19）
        // v95：离线会话改为「原生自动捕获」——在线时拦截 /api/session、/api/me 的响应，
        //      直接把 token+user 写进离线缓存，不再依赖网页调用 AndroidBridge.saveSession。
        //      彻底根治"断网进不去"反复出现；并让线上版本实时刷新（proxy 强制 no-cache）。
        // v96：① 首页版本号自动跟随服务器（从 index.html 的 loginVer 提取缓存）。
        //      ② 首次/每次联网登录后执行完整数据同步，完成后弹三语橙色居中提示。
        // ★ 本次改动只涉及 APK 侧（注入脚本 / 原生代码），index.html 未做任何修改，
        //   因此这里【必须保持 96】。一旦递增，启动时就会触发 clearCache 强制重新
        //   下载 1.6MB 的 index.html，表现为"点开 APP 白屏好几秒"。
        //   仅当 index.html 等网页内容真正变更时才递增。
        private const val WEB_VERSION = 97

        private const val PREFS_NAME = "agipm_prefs"
        private const val KEY_LAST_WEB_VERSION = "last_web_version"

        // 主站点 host（用于判断 /api 请求是否属于本系统，原生代理只接管自有接口）
        private const val HOME_HOST = "agi-goldsum-crm.duckdns.org"
        private const val FALLBACK_HOST = "124.156.134.135"
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorLayout: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var retryButton: Button
    private lateinit var swipeRefresh: SwipeRefreshLayout

    // 离线只读缓存管理器（加密存储凭据 + 列表记录 + 会话 token）
    private lateinit var cacheManager: CacheManager
    // 当前界面语言（由网页推送），用于离线提示三语文案
    private var curLang: String = "zh"

    // 本次启动已后台刷新过的站点缓存 key（每个 key 只刷一次，避免重复流量）
    private val siteRefreshKeys = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<String, Boolean>())

    // 启动页（覆盖在 WebView 之上，首屏渲染完成前遮住白屏）
    private var splashView: View? = null

    /** 显示品牌启动页（AGI-PM 橙色底 + Logo + 加载中） */
    private fun showSplash() {
        if (splashView != null) return
        try {
            val lay = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                setBackgroundColor(android.graphics.Color.parseColor("#F5872E"))
            }
            val logo = android.widget.TextView(this).apply {
                text = "AGI-PM"
                setTextColor(android.graphics.Color.WHITE)
                textSize = 36f
                gravity = android.view.Gravity.CENTER
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            val bar = android.widget.ProgressBar(this).apply {
                isIndeterminate = true
            }
            val tip = android.widget.TextView(this).apply {
                text = when (curLang) {
                    "en" -> "Loading…"
                    "vi" -> "Đang tải…"
                    else -> "正在加载…"
                }
                setTextColor(android.graphics.Color.WHITE)
                textSize = 14f
                gravity = android.view.Gravity.CENTER
                setPadding(0, 28, 0, 0)
            }
            lay.addView(logo)
            lay.addView(bar, android.widget.LinearLayout.LayoutParams(-2, -2).apply { topMargin = 24 })
            lay.addView(tip)
            addContentView(
                lay,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
            splashView = lay
            // 保险：极端情况下 onPageFinished 不触发时，10 秒后强制撤掉，
            // 避免启动页永久遮挡导致 App 看起来"卡死"。
            backHandler.postDelayed({ hideSplash() }, 10000)
        } catch (e: Exception) {
            Log.w(TAG, "showSplash failed", e)
        }
    }

    /** 首屏渲染完成后隐藏启动页 */
    private fun hideSplash() {
        try {
            splashView?.let { v ->
                (v.parent as? android.view.ViewGroup)?.removeView(v)
                splashView = null
            }
        } catch (e: Exception) {
            splashView = null
        }
    }

    // 用于文件上传/下载
    private var filePathCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private val FILE_CHOOSER_REQUEST_CODE = 1001

    private var lastBackPressedTime = 0L

    // 主站点（pages.dev）加载失败后是否已切换到备用站点（workers.dev）
    private var usedFallback = false

    // 返回键处理：避免 evaluateJavascript 异步回调与超时兜底重复执行
    private val backHandler by lazy { Handler(Looper.getMainLooper()) }
    private var backSettled = false

    // 完整离线数据同步的节流戳（30s 内不重复同步）
    private var lastFullSyncTs = 0L

    // 调试/QA 广播（仅 adb 手动触发，用于沙箱内验证离线登录与同步提示链路）：
    //   adb shell am broadcast -a com.agipm.app.DEBUG_SEED   // 写入调试会话并注入离线登录态
    //   adb shell am broadcast -a com.agipm.app.DEBUG_TOAST  // 立即弹出三语同步提示
    private val qaReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context?, i: android.content.Intent?) {
            when (i?.action) {
                "com.agipm.app.DEBUG_SEED" -> {
                    cacheManager.putSession("debug-token-000", "{\"username\":\"tom\",\"ok\":true}")
                    runOnUiThread { maybeOfflineSession() }
                }
                "com.agipm.app.DEBUG_TOAST" -> showSyncToast()
                // DEBUG_PRINT 已随 APP 打印功能一并移除
            }
        }
    }

    // 网页推送的"有内部可返回层级"标志（由 AndroidBridge.setBackState 同步写入）
    @Volatile
    private var webCanGoBack = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 离线只读缓存管理器（加密存储）
        cacheManager = CacheManager(this)

        // 竖屏 / 横屏自由切换：跟随传感器（即便 Manifest 被某些 ROM 忽略，这里再兜一次）
        requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR

        // 沉浸式全屏：状态栏/导航栏隐藏，内容铺满整个屏幕
        setupFullScreen()

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        errorLayout = findViewById(R.id.errorLayout)
        errorText = findViewById(R.id.errorText)
        retryButton = findViewById(R.id.retryButton)
        swipeRefresh = findViewById(R.id.swipeRefresh)

        // 全屏（edge-to-edge）后系统不再自动为键盘腾出空间（adjustResize 失效），
        // 这里手动监听 IME insets：键盘弹出时给 WebView 底部加等高 padding，
        // 保证登录框/输入框不被键盘盖住；键盘收起后 padding 归零，恢复全屏。
        ViewCompat.setOnApplyWindowInsetsListener(swipeRefresh) { v, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(0, 0, 0, ime.bottom)
            insets
        }

        setupWebView()
        setupBackPress()
        setupSwipeRefresh()
        registerNetworkCallback()   // 断网恢复后自动重载

        // 注册调试/QA 广播（仅 adb 手动触发，正常使用无影响）
        try {
            val qaFilter = android.content.IntentFilter().apply {
                addAction("com.agipm.app.DEBUG_SEED")
                addAction("com.agipm.app.DEBUG_TOAST")
            }
            registerReceiver(qaReceiver, qaFilter, android.content.Context.RECEIVER_EXPORTED)
        } catch (e: Exception) {
            Log.w(TAG, "注册 QA 广播失败", e)
        }

        retryButton.setOnClickListener {
            errorLayout.visibility = View.GONE
            hardReload()
        }

        // 检查网页版本：若比上次记录的新，先清缓存再加载
        // 解决"网页已更新但 APP 仍显示旧内容"的问题
        if (shouldForceRefresh()) {
            Log.i(TAG, "网页版本更新 ($WEB_VERSION)，清除缓存后重新加载")
            try {
                webView.clearCache(true)
            } catch (e: Exception) {
                Log.w(TAG, "清缓存失败", e)
            }
            // 注意：只清 HTTP 缓存，不清 Cookie/localStorage，
            // 这样"记住登录"状态仍然保留，用户不需要重新登录
        }

        if (savedInstanceState == null) {
            loadUrl()
        } else {
            // 屏幕旋转等配置变化时不重新加载，直接恢复
            webView.restoreState(savedInstanceState)
        }
    }

    /**
     * 判断是否需要强制刷新网页。
     * 逻辑：本地记录的网页版本号 < 当前 APP 内置的 WEB_VERSION 时返回 true。
     */
    private fun shouldForceRefresh(): Boolean {
        return try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val last = prefs.getInt(KEY_LAST_WEB_VERSION, 0)
            if (last < WEB_VERSION) {
                prefs.edit().putInt(KEY_LAST_WEB_VERSION, WEB_VERSION).apply()
                // 网页版本变化：不仅清 WebView HTTP 缓存，连离线站点静态缓存
                // （index.html/JS/CSS）也一并清掉，否则老用户会一直吃旧的缓存站点、
                // 表现为"版本不更新"。数据类 API 缓存保留，不影响离线回放。
                try { cacheManager.clearSite() } catch (e: Exception) {
                    Log.w(TAG, "清站点缓存失败", e)
                }
                true
            } else {
                false
            }
        } catch (e: Exception) {
            Log.w(TAG, "读取网页版本失败", e)
            false
        }
    }

    private fun setupFullScreen() {
        // 刘海/挖孔：横屏时摄像头缺口位于左右短边。
        // NEVER = 内容不进入缺口区域（系统自动避开），
        // 避免 LOGO / 首尾标签被前置摄像头遮挡，也避开缺口附近的点击死区。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
            }
        }
        // 沉浸式全屏（用户要求“霸占全屏，信息条全部退下”）：
        //  - setDecorFitsSystemWindows(false)：内容铺满整屏，系统栏以浮层形式出现
        //  - 隐藏状态栏 + 导航栏；从屏幕边缘滑动可临时唤出，几秒不动自动退回
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()
    }

    private fun hideSystemBars() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        // 从边缘滑动时以“半透明浮层”临时显示系统栏（不挤压内容），松手后自动隐藏
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val s: WebSettings = webView.settings

        // JS 必须开，你的系统是单页应用，全靠 JS 渲染
        s.javaScriptEnabled = true

        // 注入 JS 桥：网页通过 window.AndroidBridge 调用原生能力（指纹快速登录）
        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")

        // 允许 localStorage / sessionStorage
        // localStorage 用于"记住登录"：APP 关闭再打开也能自动进入
        s.domStorageEnabled = true
        s.databaseEnabled = true

        // 显式指定数据库存储路径，确保 localStorage 真正持久化到磁盘。
        // 部分 ROM 上不指定路径会导致数据只存内存，杀进程后登录状态丢失。
        try {
            val dbDir = getDir("webview_db", Context.MODE_PRIVATE)
            if (dbDir.exists() || dbDir.mkdirs()) {
                s.databasePath = dbDir.absolutePath
            }
        } catch (e: Exception) {
            Log.w(TAG, "设置 WebView 数据库路径失败", e)
        }

        // ===== 视口：与手机浏览器保持一致 =====
        // useWideViewPort = 支持页面里的 <meta name="viewport">，
        // 这是让 APP 显示效果"和浏览器 100% 一样"的关键设置。
        s.useWideViewPort = true
        // 不要用 overview 模式强行缩放，否则会覆盖页面自己的 viewport 设置，
        // 导致 APP 与浏览器显示不一致。
        s.loadWithOverviewMode = false

        // ===== 缩放 =====
        // 保留双指缩放（看宽表格时有用）。
        // 双击缩放已在网页里用 CSS `touch-action: manipulation` 禁用，
        // 目的：消除 WebView 的 300ms 点击延迟（点了要等一下才反应的根因）。
        s.setSupportZoom(true)
        s.builtInZoomControls = true
        s.displayZoomControls = false   // 不显示缩放按钮，用双指手势

        // 文字缩放固定 100%：不受系统"字体大小 / 显示大小"设置影响。
        // 否则用户把系统字体调大后，网页文字被整体放大，
        // 顶栏标签更容易被挤出屏幕，表现为"画面比例失调"。
        s.textZoom = 100

        // 提高渲染性能
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

        // 文件访问（附件上传需要）
        s.allowFileAccess = true
        s.allowContentAccess = true

        // ===== User Agent =====
        // 保持 WebView 默认 UA（即标准 Chrome UA），不追加自定义后缀，
        // 确保网页拿到的环境和手机浏览器完全一致，
        // 避免任何基于 UA 的判断在 APP 里走到不同分支。
        // 若将来需要统计来源，可在此追加，但应与浏览器行为一致。
        // s.userAgentString = s.userAgentString  // 保持默认

        webView.webViewClient = object : WebViewClient() {

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
                progressBar.progress = 0
                // 尽早注入 JS 补丁的 stub 阶段：抢在页面内任何 _ovMakeChart 调用之前
                // 把 Chart.js 未就绪时的图表创建请求先排队，避免卡片被写成永久 loading。
                injectMobileJs()
                // 持久登录（类微信/淘宝）：只要本地有离线会话，主框架一开始加载就抢先注入登录态，
                // 抢在网页自身启动校验（/api/session）之前，无论联网与否都直接登录，不再弹登录页。
                if (cacheManager.hasSession()) {
                    maybeOfflineSession()
                }
                // 覆盖登录页写死的版本号（index.html 里 <span id="loginVer"> 是旧值），改成 APK 版本名
                overrideLoginVer()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                errorLayout.visibility = View.GONE
                // 首屏已就绪，撤掉启动页（延后一帧，避免与首帧绘制竞争出现闪白）
                swipeRefresh.postDelayed({ hideSplash() }, 150)
                // 页面加载完成，收起下拉刷新进度圈
                swipeRefresh.isRefreshing = false
                // 注入移动端增强样式（内含暗门载体强制保护）并校验三个暗门载体仍在
                injectMobileCss()
                // 再次注入 JS 补丁：Phase 2 会接管真正的 _ovMakeChart、补登录版本号、flush 排队图表
                injectMobileJs()
                // 覆盖登录页写死的版本号（保证页脚与 APK 版本同步）
                overrideLoginVer()
                // 离线只读：在线时自动登录（免密），离线且有缓存时直接注入会话进入已登录态
                // 有缓存会话：无论联网与否都直接注入登录态（满足"不管有没有网都直接登录"）；
                // 联网时顺便后台刷新离线缓存（循环更新）。无会话且联网：走记住密码自动登录。
                if (cacheManager.hasSession()) {
                    maybeOfflineSession()
                    // 联网时执行完整数据同步（后台刷新离线缓存），不弹提示避免打扰。
                    if (isNetworkAvailable()) syncOfflineData(showToast = false)
                } else if (isNetworkAvailable()) {
                    maybeAutoLogin()
                }
            }

            // 拦截三类请求（让 APK 在离线时也能完整加载站点）：
            //  1) /api/   —— 原生代理：在线时转发并加密缓存；离线时返回缓存（只读），
            //                编辑类请求(POST/PUT/DELETE)离线一律拦截提示"需联网"。
            //  2) /vendor/ —— 返回 APK 内置本地副本（Chart.js 等不依赖外网）。
            //  3) 同源 GET 静态资源（index.html / crm_table.js / lost_table.js / css / manifest…）
            //               —— 在线时原生代理并加密缓存；离线时直接喂本地缓存。
            //               这样断网后整页（含 CRM/LOST 三语备注框等所有功能）都能渲染，
            //               离线会话注入(maybeOfflineSession)也才有页面可挂载 → 单机版登录（只读）生效。
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val reqUrl = request?.url ?: return null
                val url = reqUrl.toString()
                val host = reqUrl.host ?: return null
                val rawPath = reqUrl.path ?: ""
                val path = if (rawPath.isEmpty()) "/" else rawPath
                val isHome = (host == HOME_HOST || host == FALLBACK_HOST)
                val method = request.method ?: "GET"

                if (path.startsWith("/api/") && isHome) return handleApi(request, url)
                if (path.startsWith("/vendor/")) return serveVendor(path)
                // 仅接管同源 GET 静态资源（主文档 + 外链脚本/样式/清单），其余放行给原生栈
                if (!isHome || method != "GET") return null
                return handleSite(request)
            }

            // 只在主框架加载失败时才显示错误页，子资源（图片/JS）失败不打断
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true) return

                val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    error?.description?.toString()
                } else null
                val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    error?.errorCode
                } else null
                val failing = request?.url?.toString().orEmpty()
                Log.w(TAG, "主框架加载失败: code=$code desc=$desc url=$failing")

                // ★ 主站点打不开 → 自动改用备用地址（部分运营商会拦截 pages.dev）
                if (!usedFallback && (failing.startsWith(HOME_URL) || failing.isEmpty())) {
                    usedFallback = true
                    Log.i(TAG, "改用备用地址: $FALLBACK_URL")
                    errorLayout.visibility = View.GONE
                    webView.loadUrl(FALLBACK_URL)
                    return
                }

                // ★ 离线兜底：主文档已交还 WebView 原生加载（换取首屏速度），
                //   断网时原生加载会失败，这里用 APK 内置快照渲染，保证离线仍可打开系统。
                val snap = readSiteSnapshot("/")
                if (snap != null) {
                    Log.i(TAG, "主文档加载失败，改用内置快照离线渲染")
                    errorLayout.visibility = View.GONE
                    webView.loadDataWithBaseURL(HOME_URL, snap, "text/html", "UTF-8", null)
                    return
                }
                val msg = getString(R.string.load_failed) +
                    (if (!desc.isNullOrBlank()) "\n$desc" else "")
                showError(msg)
            }

            // HTTP 层错误（如 5xx / 403）：以前会白屏不提示，这里给出可见的错误页
            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame == true) {
                    Log.w(TAG, "主框架 HTTP 错误: ${errorResponse?.statusCode}")
                    showError(getString(R.string.load_failed) +
                        "\nHTTP ${errorResponse?.statusCode}")
                }
            }

            // 外部链接（如打电话、地图）交给系统处理
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                return when {
                    // 【返回键状态通道】网页用自定义 scheme 同步告知"是否可内部返回"。
                    // 这是比 addJavascriptInterface 更可靠的同步通道：
                    // shouldOverrideUrlLoading 在导航瞬间同步回调，不受 JS 接口注入时机影响。
                    url.startsWith("agipm://backstate") -> {
                        val st = request.url.getQueryParameter("s")
                        webCanGoBack = (st == "1")
                        Log.d(TAG, "backstate via scheme -> $webCanGoBack")
                        true   // 拦截，不真正导航
                    }
                    url.startsWith("https://agi-gs.pages.dev") ||
                    url.startsWith("https://agi-gs.tomalso911.workers.dev") -> false
                    url.startsWith("tel:") || url.startsWith("mailto:") -> {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        } catch (e: Exception) {
                            Log.w(TAG, "无法处理链接: $url")
                        }
                        true
                    }
                    else -> {
                        // 其他外链用系统浏览器打开
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        } catch (e: Exception) {
                            Log.w(TAG, "无法打开外链: $url")
                        }
                        true
                    }
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {

            private var customView: View? = null
            private var customViewCallback: CustomViewCallback? = null

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                if (newProgress >= 100) progressBar.visibility = View.GONE
            }

            // 支持 HTML5 全屏（网页 requestFullscreen，私密空间预览 ⛶ 按钮需要）
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                view.setBackgroundColor(0xFF000000.toInt())
                webView.visibility = View.GONE
                val decor = window.decorView as android.view.ViewGroup
                decor.addView(
                    view,
                    android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
                setupFullScreen()
            }

            override fun onHideCustomView() {
                val v = customView ?: return
                (window.decorView as android.view.ViewGroup).removeView(v)
                customView = null
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
                webView.visibility = View.VISIBLE
                setupFullScreen()
            }

            // 支持 <input type="file"> —— 附件上传到 R2 需要
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: android.webkit.ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback = filePathCallback
                try {
                    // 优先使用网页声明的 accept 类型；否则用一套覆盖办公/PDF/图片/视频/音频的广类型，
                    // 防止部分机型文件选择器只暴露“照片/视频”而隐藏 Word/Excel/PDF 等文档。
                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                    // 兜底强化：用系统文档选择器（SAF），并设为不限制类型，
                    // 这样左侧抽屉一定会出现「文档 / Documents」「下载 / Downloads」等根目录，
                    // 用户可直接进入手机 Documents 文件夹挑选 Word/Excel/PDF。
                    // 注：MODE_OPEN_FOLDER 在本 SDK 的 Kotlin stub 中未导出，用字面量 4 代替
                    val isDir = fileChooserParams?.mode == 4
                    if (!isDir) {
                        intent.action = Intent.ACTION_OPEN_DOCUMENT
                        intent.addCategory(Intent.CATEGORY_OPENABLE)
                        if (fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                        // 不设置 EXTRA_MIME_TYPES（否则部分机型会隐藏「文档」根目录）；
                        // 用 */* 让所有类型与所有根目录都可见、可浏览。
                        intent.type = "*/*"
                    }
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE)
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    Log.e(TAG, "打开文件选择器失败", e)
                    return false
                }
                return true
            }
        }

        // ===== 键盘与焦点设置（关键，勿再关闭）=====
        // 历史 bug：这里曾把 isFocusable / isFocusableInTouchMode 设为 false，
        // 导致网页里的登录框拿不到焦点 —— 软键盘不弹出、已输入内容被清空。
        // 必须保持为 true（默认值），否则页面所有输入框都无法使用。
        try {
            webView.isFocusableInTouchMode = true
            webView.isFocusable = true
            // 避免页面加载时"自动弹出输入法"抢占交互：
            // 用"不在加载完成后主动请求焦点"来实现，而不是关闭可聚焦。
            webView.clearFocus()
        } catch (e: Exception) {
            Log.w(TAG, "设置 focusable 失败", e)
        }
        // 关闭 WebView 的边缘/滚动顶部发光效果：
        // 这些过度绘制在低端机上会拖慢首屏与滚动帧率。
        try {
            webView.overScrollMode = View.OVER_SCROLL_NEVER
        } catch (e: Exception) {
            Log.w(TAG, "设置 overScrollMode 失败", e)
        }
        // 显示滚动条，便于用户知道内容可滚动（与浏览器一致）
        webView.isHorizontalScrollBarEnabled = true
        webView.isVerticalScrollBarEnabled = true

        // 下载监听：附件下载交给系统下载器
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            try {
                val request = android.app.DownloadManager.Request(Uri.parse(url))
                    .setMimeType(mimeType)
                    .setNotificationVisibility(
                        android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    )
                    .setTitle(android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType))
                request.allowScanningByMediaScanner()
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "开始下载", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Log.e(TAG, "下载失败", e)
                Toast.makeText(this, "下载失败：${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * 返回键规则（用户明确要求，简单可靠）：
     *   ★ 单击返回键 → 返回上一级（网页内部回退：关预览 / 子目录回上层 / 关弹窗 / 关闭私密空间）
     *   ★ 双击返回键（2 秒内连按两次）→ 退出 APP
     *
     * 说明：这里【不再依赖】网页返回值或异步回调来决定是否退出——
     * 退出只由"是否 2 秒内连按两次"决定，返回上一级的动作永远同步发出，
     * 因此绝不会出现"单击直接退出"的情况。
     */
    private fun setupBackPress() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val now = System.currentTimeMillis()

                // ★ 双击（2 秒内第二次）→ 切回后台（类似微信，APP 仍在运行，下次点图标直接恢复无需登录）
                if (now - lastBackPressedTime < 2000) {
                    moveTaskToBack(true)
                    return
                }
                lastBackPressedTime = now

                // ★ 单击 → 返回上一级（同步发出回退动作，不关心返回值）
                webView.evaluateJavascript(
                    "(function(){try{if(window.__handleBack){window.__handleBack();}}catch(e){}})()",
                    null
                )

                // 若当前确实没有可返回的层级（网页推送的标志位为 false），
                // 提示"再按一次返回后台"，避免用户困惑（此时双击即最小化）
                if (!webCanGoBack) {
                    val msg = when (curLang) {
                        "en" -> "Press back again to switch to background"
                        "vi" -> "Nhấn lại để chuyển sang nền"
                        else -> "再按一次返回键返回后台"
                    }
                    Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    /** 原生兜底返回：先尝试网页历史回退，否则双击退出 */
    private fun handleNativeBack() {
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastBackPressedTime < 2000) {
            moveTaskToBack(true)
        } else {
            lastBackPressedTime = now
            val msg = when (curLang) {
                "en" -> "Press back again to switch to background"
                "vi" -> "Nhấn lại để chuyển sang nền"
                else -> "再按一次返回键返回后台"
            }
            Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show()
        }
    }

    private fun loadUrl() {
        // ★ 不再用"网络探测"拦住加载：探测只能说明系统认为有没有网，
        //   真正连不连得上以 WebView 的结果为准。即使探测失败也照样发起请求，
        //   失败由 onReceivedError 显示错误页，联网恢复后自动重试。
        errorLayout.visibility = View.GONE
        webView.loadUrl(HOME_URL)
    }

    /**
     * 强制刷新：先清 WebView 缓存再重新加载。
     * 用于下拉刷新和"重试"按钮，确保拿到网页的最新版本，
     * 不会因为 WebView 本地缓存而停留在旧页面。
     */
    private fun hardReload() {
        swipeRefresh.isRefreshing = true
        try {
            webView.clearCache(true)
            // 注意：不清除 Cookie/localStorage，否则会退出登录
        } catch (e: Exception) {
            Log.w(TAG, "清除缓存失败", e)
        }
        errorLayout.visibility = View.GONE
        webView.loadUrl(HOME_URL)
    }

    /**
     * 监听网络恢复：断网后重新联网时自动重载，不用用户手动点"重试"。
     * 以前断网一次就永远停在错误页，即使网络恢复也不会自己加载。
     */
    private fun registerNetworkCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(req, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    runOnUiThread {
                        // 联网恢复：重新后台预取各模块数据，刷新离线缓存（满足"联网后自动更新再保留"的循环）
                        prefetchOfflineData()
                        // 有会话时顺便执行完整离线同步，把离线期间服务器的新变化拉下来。
                        if (cacheManager.hasSession()) syncOfflineData(showToast = false)
                        // 只在"错误页正显示"或"页面还没加载出来"时才自动重载，
                        // 避免正常浏览时被无谓刷新打断。
                        val need = errorLayout.visibility == View.VISIBLE ||
                            webView.url.isNullOrEmpty() ||
                            webView.progress < 100
                        if (need) {
                            Log.i(TAG, "网络恢复，自动重新加载")
                            hardReload()
                        }
                    }
                }
            })
        } catch (e: Exception) {
            Log.w(TAG, "注册网络回调失败(可忽略)", e)
        }
    }

    private fun setupSwipeRefresh() {
        // 进度圈颜色（与 APP 主题一致）
        swipeRefresh.setColorSchemeColors(
            resources.getColor(R.color.primary, theme),
            resources.getColor(R.color.accent, theme)
        )
        swipeRefresh.setOnRefreshListener {
            hardReload()
        }

        // 解决手势冲突：网页内容已经滚动过（scrollY > 0）时禁用下拉刷新，
        // 否则用户在表格里向下滚动会误触发刷新。
        // 必须等页面加载完再绑定，否则 viewTreeObserver 拿不到正确状态。
        webView.webViewClient
        webView.viewTreeObserver.addOnScrollChangedListener {
            swipeRefresh.isEnabled = webView.scrollY <= 0
        }
    }

    /**
     * 注入移动端增强样式（res/raw/mobile_css.css）。
     *
     * 关键：样式表开头是「暗门载体硬性保护」——用 !important 强制
     *  .tb-logo / .tb-user-avatar / .tb-item[data-view="dashboard"]
     * 保持可见、可点击。只要这段在，任何后续样式都藏不掉这三个入口，
     * 因此四个暗门（个人佣金、私密空间、清理、当月更新）不会丢失。
     *
     * 注入后会立即校验三个载体是否真实存在，结果写入日志，便于安装后自查。
     */
    private fun injectMobileCss() {
        val css = try {
            resources.openRawResource(R.raw.mobile_css).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            Log.e(TAG, "injectMobileCss: read css failed - ${e.message}")
            return
        }
        val quoted = org.json.JSONObject.quote(css)
        val injectJs = "(function(){" +
            "if(document.getElementById('agi-pm-mobile-css'))return;" +
            "var s=document.createElement('style');" +
            "s.id='agi-pm-mobile-css';" +
            "s.textContent=$quoted;" +
            "document.head.appendChild(s);" +
            "})()"
        webView.evaluateJavascript(injectJs, null)

        // 校验三个暗门载体仍然存在（缺失会导致对应暗门永久失效）
        val guardJs = "(function(){" +
            "var a=!!document.querySelector('.tb-logo');" +
            "var b=!!document.querySelector('.tb-user-avatar');" +
            "var c=!!document.querySelector('.tb-item[data-view=\"dashboard\"]');" +
            "return a&&b&&c;" +
            "})()"
        webView.evaluateJavascript(guardJs) { result ->
            val ok = result?.trim('"')?.toBooleanStrictOrNull() ?: false
            if (ok) {
                Log.i(TAG, "HIDDEN-ENTRY GUARD: OK (logo/avatar/dashboard present)")
            } else {
                Log.e(TAG, "HIDDEN-ENTRY GUARD: FAILED - result=$result")
            }
        }
    }

    /**
     * 注入移动端 JS 补丁（res/raw/mobile_js.js）。
     *
     * 作用：
     *   1) Chart.js 异步加载竞态修复：把 Chart 未就绪时发起的图表创建请求排队，
     *      等库加载完成后自动重绘，避免卡片永远显示「Loading chart library…」。
     *   2) 屏幕旋转后主动触发 resize，让 Chart.js 响应式图表重新适应新宽度。
     */
    private fun injectMobileJs() {
        val js = try {
            resources.openRawResource(R.raw.mobile_js).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            Log.e(TAG, "injectMobileJs: read js failed - ${e.message}")
            return
        }
        // 页脚版本号直接采用【APK 的 versionName】（随每次打包递增），
        // 这样用户装上新 APK 后页脚立刻显示最新版本，不再受服务器 loginVer 滞后影响。
        val serverVer = BuildConfig.VERSION_NAME
        val jsText = js.replace("__AGI_PM_VERSION__", serverVer)
        // ★ 必须【直接执行】脚本内容。
        //   原实现把整段 JS 用 JSONObject.quote 包成字符串再塞进 IIFE：
        //       (function(){ "....源码...." })()
        //   这只会产生一个字符串字面量，代码根本不会运行 —— 导致本文件里所有补丁
        //   （打印桥接 / 图表竞态修复 / 离线横幅 / PDF 展开辅助）全部静默失效，
        //   线上表现为"点打印完全没反应"。
        //   注意与 injectMobileCss 区分：CSS 是用 JS 创建 style 标签注入，那条路径是对的。
        val inject = "try{ $jsText }catch(e){ console.log('agi-inject-error: '+e); }"
        webView.evaluateJavascript(inject, null)
    }

    private fun showError(msg: String) {
        hideSplash()   // 加载失败也要撤掉启动页，否则会一直卡在启动页
        errorText.text = msg
        errorLayout.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
    }

    @Suppress("DEPRECATION")
    private fun isNetworkAvailable(): Boolean {
        // ★ 绝对不要要求 NET_CAPABILITY_VALIDATED（V2026.09.05.29 修复）：
        //   这个能力需要系统先访问 Google 的连通性校验服务器才算"已验证"，
        //   在中国大陆、部分越南运营商、企业 Wi-Fi / 私人 DNS 下永远为 false，
        //   手机明明能上网，APP 却判定"无网络"并拒绝加载 —— 这就是
        //   "安装后连不上服务器"的根因。
        //   但反过来也【不能盲目乐观】：飞行模式/无信号时 activeNetwork 为 null，
        //   若此时判成"有网"，就会去请求网络→WebView 白屏（ERR_INTERNET_DISCONNECTED），
        //   离线缓存永远用不上。所以"拿不到网络就判为离线"，宁可走缓存，
        //   即使误判，系统网络回调 onAvailable 也会在恢复联网时自动重载。
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val n = cm.activeNetwork
                val caps = if (n != null) cm.getNetworkCapabilities(n) else null
                if (caps != null) {
                    // 有 INTERNET 能力即认为可联网（不要求 VALIDATED，见上方说明）
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                } else {
                    // activeNetwork 为 null / 拿不到能力：飞行模式、无信号、刚开机的典型场景。
                    // 退回旧接口判断真实连接状态；判不出来就【保守判为离线】，
                    // 走离线缓存，避免 WebView 白屏。恢复联网后网络回调会触发自动重载。
                    val info = cm.activeNetworkInfo
                    info?.isConnected ?: false
                }
            } else {
                val info = cm.activeNetworkInfo
                info != null && info.isConnected
            }
        } catch (e: Exception) {
            false   // 判断出错时保守处理，走离线缓存（更安全）
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            val cb = filePathCallback ?: return
            val results = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            cb.onReceiveValue(results)
            filePathCallback = null
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // 从通知/对话框返回后系统栏可能被重新显示，焦点恢复时再隐藏一次，
        // 确保 APP 始终保持全屏。
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        try { unregisterReceiver(qaReceiver) } catch (_: Exception) {}
        webView.destroy()
        super.onDestroy()
    }

    // 物理键盘返回键（部分设备/外接键盘）
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // 系统返回键统一交给 OnBackPressedDispatcher（setupBackPress）处理，
        // 那里会先询问网页 __handleBack；此处不再拦截，否则会绕过网页直接 goBack。
        return super.onKeyDown(keyCode, event)
    }

    // 旋转屏幕：Manifest 已声明 configChanges，Activity 不会重建、网页不会重新加载，
    // 这里只需在旋转后重新隐藏系统栏，保持沉浸式全屏。
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        hideSystemBars()
    }

    // ============================================================
    // 指纹快速登录
    // 网页登录成功后把账号密码存到 APP 私有目录（其他应用无法读取），
    // 之后网页点「指纹快速登录」→ 弹指纹对话框 → 验证通过自动登录。
    // ============================================================

    /**
     * 接管 /api/ 请求：
     *  - GET：在线时原生转发（带会话头、加密缓存响应）；离线时返回最近缓存（只读）。
     *  - 非 GET（POST/PUT/DELETE）：离线时一律拦截，返回 412 提示"需联网"。
     */
    private fun handleApi(request: WebResourceRequest, url: String): WebResourceResponse? {
        val user = cacheManager.currentUser()
        val lower = url.lowercase()
        // 登出：清除 APK 持久会话，使下次打开回到登录页（持久登录不废掉登出）
        if (lower.contains("/api/logout")) {
            cacheManager.clearSession()
            Log.i(TAG, "logout: cleared APK cached session")
        }
        val isCommission = lower.contains("/api/commission")
        return if (request.method.equals("GET", true)) {
            // 在线：先试实时；若实时失败（断网/服务器不可达/DNS 解析失败）则回退离线缓存。
            // 离线：直接回退缓存。这样"不管有没有网"都能拿到数据，不再卡登录/空白。
            // 先试实时（不依赖 isNetworkAvailable，避免启动时 CM 未就绪误判离线）；
            // 实时失败（断网/不可达）再回退离线缓存。
            try {
                val live = proxyGet(url, request, user, isCommission)
                if (live != null) return live
            } catch (e: Exception) {
                Log.w(TAG, "proxyGet failed, fallback to offline cache: $url", e)
            }
            // 离线或实时失败：回退缓存（按当前用户名；兼容旧空用户名会话也兜底）
            val key = normalizeApiKey(url)
            val c = cacheManager.getCache(user, key) ?: cacheManager.getCache("", key)
            if (c != null) {
                Log.i(TAG, "OFFLINE API cache HIT: $key (user='$user')")
                buildTextResponse(c.status, c.mime, c.body)
            } else {
                Log.w(TAG, "OFFLINE API cache MISS: $key (user='$user')")
                buildTextResponse(503, "application/json", offlineErrJson("offline_no_cache"))
            }
        } else {
            if (!isNetworkAvailable()) {
                buildTextResponse(412, "application/json", offlineErrJson("offline_readonly"))
            } else {
                null
            }
        }
    }

    /**
     * 原生转发 GET 请求，并加密缓存当前用户权限范围内的 200~299 文本响应
     * （CRM/LOST/WON/佣金/看板等列表与记录，服务器已按 token 过滤）。
     */
    private fun proxyGet(url: String, request: WebResourceRequest, user: String, isCommission: Boolean): WebResourceResponse? {
        val lower = url.lowercase()
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        var authToken: String? = null
        try {
            val headers = request.requestHeaders
            for ((k, v) in headers) {
                val lk = k.lowercase()
                if (lk == "host" || lk == "connection" || lk == "accept-encoding" || lk == "content-length") continue
                conn.setRequestProperty(k, v)
                if (lk == "authorization") authToken = v.removePrefix("Bearer ").trim()
            }
            if (authToken.isNullOrEmpty()) {
                val sess = cacheManager.getSession()
                if (sess != null) conn.setRequestProperty("Authorization", "Bearer " + sess.first)
            }
            // 强制源站返回最新内容，保证线上版本实时刷新。
            conn.setRequestProperty("Cache-Control", "no-cache")
            conn.setRequestProperty("Pragma", "no-cache")
            val status = conn.responseCode
            val stream = if (status < 400) conn.inputStream else conn.errorStream
            val bodyBytes = stream?.readBytes() ?: ByteArray(0)
            val mime = conn.contentType ?: "application/json"
            val body = String(bodyBytes, Charsets.UTF_8)
            // 离线数据：缓存当前用户权限范围内的全部 GET /api/ 文本响应（200~299）。
            // 服务器本就按 token 过滤，缓存即等于“权限范围内数据”；附件类（files/vault/documents）落盘无意义且为二进制，剔除。
            val isBinary = lower.contains("/api/files") || lower.contains("/api/vault") || lower.contains("/documents")
            val isText = mime.startsWith("application/json", true) || mime.startsWith("text/", true)
            val allowCache = status in 200..299 && isText && !isBinary
            if (allowCache) cacheManager.putCache(user, normalizeApiKey(url), status, mime, body)
            // ★ 离线会话自动捕获：在线时拦截 /api/session、/api/me 的响应，
            //   把响应里的 token+user 直接写进离线会话，断网即可注入登录态。
            //   不依赖网页主动调用 AndroidBridge.saveSession，根治"断网进不去"。
            if (allowCache) maybeCacheSessionFromResponse(url, authToken, body)
            return buildTextResponse(status, mime, body)
        } catch (e: Exception) {
            Log.w(TAG, "proxyGet error: $url", e)
            return null
        } finally {
            try { conn.disconnect() } catch (e: Exception) { }
        }
    }

    /**
     * 在线时自动从会话类 GET 响应里抓取离线会话（token + user），
     * 写入 CacheManager，使断网也能注入登录态。
     * 来源：/api/session、/api/me（都返回 {ok,user}，且请求头带 Bearer token）。
     * 这样即使网页从不调用 AndroidBridge.saveSession，离线登录依然可用。
     */
    private fun maybeCacheSessionFromResponse(url: String, headerToken: String?, body: String) {
        try {
            val lower = url.lowercase()
            if (!lower.contains("/api/session") && !lower.contains("/api/me") && !lower.contains("/api/login")) return
            val obj = org.json.JSONObject(body)
            if (!obj.optBoolean("ok", false) || !obj.has("user")) return
            val user = obj.getJSONObject("user").toString()
            val token = (headerToken?.takeIf { it.isNotEmpty() }
                ?: obj.optString("token", "")).takeIf { it.isNotEmpty() } ?: return
            cacheManager.putSession(token, user)
            // 会话到手：执行完整离线数据同步。首次登录时 saveSession 可能没被调用，
            // 这里兜底触发同步+提示，确保断网前数据已经落盘。
            syncOfflineData(showToast = true)
        } catch (e: Exception) {
            Log.w(TAG, "maybeCacheSessionFromResponse failed: $url", e)
        }
    }

    // ---- 同源静态资源离线缓存：在线代理并落盘，离线喂缓存 ----

    private fun serveVendor(path: String): WebResourceResponse? {
        val assetPath = "vendor/" + path.substring("/vendor/".length)
        return try {
            val stream = applicationContext.assets.open(assetPath)
            val mime = when {
                assetPath.endsWith(".js") -> "application/javascript"
                assetPath.endsWith(".css") -> "text/css"
                assetPath.endsWith(".woff") || assetPath.endsWith(".woff2") -> "font/woff2"
                assetPath.endsWith(".ttf") -> "font/ttf"
                else -> "application/octet-stream"
            }
            WebResourceResponse(mime, "UTF-8", stream)
        } catch (e: Exception) {
            Log.w(TAG, "vendor intercept miss: $assetPath", e)
            null
        }
    }

    /**
     * 同源静态资源（主文档 + 外链脚本/样式/清单）：在线原生代理并加密缓存，
     * 离线直接喂本地缓存。断网后整页可完整渲染，离线会话注入也才有载体。
     */
    private fun handleSite(request: WebResourceRequest): WebResourceResponse? {
        val reqUrl = request.url ?: return null
        val host = reqUrl.host ?: return null
        val rawPath = reqUrl.path ?: ""
        val normPath = if (rawPath.isEmpty() || rawPath == "/index.html") "/" else rawPath
        val key = host + normPath

        // ★ 主文档也走本地缓存/快照，在线时同样秒开：
        //   主文档直接放行会导致每次启动都联网下载 1.9MB HTML，出现进度条/白屏。
        //   改为由 handleSite 代理：有缓存读缓存，无缓存读 APK 内置快照，均立即返回；
        //   同时后台静默回源刷新，下次启动自然用到线上最新版。

        // ★ 秒开优化（白屏 3 秒的根治）：本地已有缓存 → 立即喂给 WebView，不再等
        //   1.6MB 主文档 + 子资源的网络往返；同时后台线程静默回源刷新缓存，
        //   下次启动自然用到新版本。以前在线时每次都强制回源（no-cache），
        //   网络稍慢就是数秒白屏。
        val cached = cacheManager.getSite(key)
        if (cached != null) {
            Log.i(TAG, "instant serve cached site: $key (bg refresh scheduled)")
            refreshSiteInBackground(request, key)
            return buildTextResponse(200, cached.mime, cached.body)
        }

        // 首次启动（还没有缓存）：优先用 APK 内置的页面快照立即渲染，
        // 消除"新装 APP 打开白屏几秒"（1.9MB 主文档不必等网络往返）。
        val snapshot = readSiteSnapshot(normPath)
        if (snapshot != null) {
            Log.i(TAG, "instant serve built-in snapshot: $key (bg refresh scheduled)")
            refreshSiteInBackground(request, key)
            // 主文档 URL 没有扩展名，guessMime 会误判为 octet-stream，必须显式指定 text/html
            val mime = if (normPath == "/" || rawPath.endsWith("/index.html")) "text/html" else guessMime(reqUrl.toString())
            return buildTextResponse(200, mime, snapshot)
        }

        // 既无缓存也无快照：走在线代理并落盘
        return try {
            proxySite(request, key)
        } catch (e: Exception) {
            Log.w(TAG, "proxySite failed, no offline cache for: $key", e)
            null
        }
    }

    /** 读取 APK 内置的同源页面快照（assets/site/...），无则返回 null */
    private fun readSiteSnapshot(normPath: String): String? {
        return try {
            val rel = if (normPath == "/" || normPath.isEmpty()) "/index.html" else normPath
            val assetName = "site" + rel
            resources.assets.open(assetName).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            null
        }
    }

    /** 后台静默刷新站点缓存（每次启动每个 key 最多刷一次，避免重复流量） */
    private fun refreshSiteInBackground(request: WebResourceRequest, key: String) {
        if (!siteRefreshKeys.add(key)) return
        val url = request.url.toString()
        val headers = request.requestHeaders ?: emptyMap()
        Thread {
            try {
                proxySiteByUrl(url, headers, key)
                Log.i(TAG, "bg site refresh done: $key")
            } catch (e: Exception) {
                Log.w(TAG, "bg site refresh failed: $key", e)
            }
        }.start()
    }

    /** 原生转发同源静态资源并加密缓存可文本化的响应（html/js/css/json/manifest）。 */
    private fun proxySite(request: WebResourceRequest, key: String): WebResourceResponse? {
        return proxySiteByUrl(request.url.toString(), request.requestHeaders ?: emptyMap(), key)
    }

    private fun proxySiteByUrl(
        url: String,
        reqHeaders: Map<String, String>,
        key: String
    ): WebResourceResponse? {
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 15000
        conn.readTimeout = 20000
        conn.instanceFollowRedirects = true
        try {
            val headers = reqHeaders
            for ((k, v) in headers) {
                val lk = k.lowercase()
                // 跳过逐跳头与 cookie（本应用用 Bearer token，不依赖 cookie）
                if (lk in setOf("host", "connection", "accept-encoding", "content-length", "cookie")) continue
                conn.setRequestProperty(k, v)
            }
            // 强制向源站取最新：避免任何中间缓存/CDN 返回旧版，
            // 解决"网页版本不更新"——线上访问永远拿到最新 index.html/JS。
            conn.setRequestProperty("Cache-Control", "no-cache")
            conn.setRequestProperty("Pragma", "no-cache")
            val status = conn.responseCode
            val stream = if (status < 400) conn.inputStream else conn.errorStream
            val bodyBytes = stream?.readBytes() ?: ByteArray(0)
            val rawMime = conn.contentType ?: guessMime(url)
            val mime = if (rawMime.contains("charset", true)) rawMime else "$rawMime; charset=utf-8"
            val body = String(bodyBytes, Charsets.UTF_8)
            if (status in 200..299 && isCacheableText(mime)) {
                cacheManager.putSite(key, mime, body)
                // 从首页 HTML 里提取服务器版本号（loginVer）并缓存，
                // 这样即使不重新打包 APK，登录页脚也能跟随服务器最新版本。
                val path = android.net.Uri.parse(url).path ?: "/"
                if (path == "/" || path == "/index.html" || path.endsWith("/index.html")) {
                    extractAndCacheVersion(body)
                }
            }
            return buildTextResponse(status, mime, body)
        } finally {
            try { conn.disconnect() } catch (e: Exception) { }
        }
    }

    private fun guessMime(url: String): String = when {
        url.endsWith(".js", true) -> "application/javascript"
        url.endsWith(".css", true) -> "text/css"
        url.endsWith(".html", true) || url.endsWith(".htm", true) -> "text/html"
        url.endsWith(".json", true) -> "application/json"
        url.endsWith(".webmanifest", true) -> "application/manifest+json"
        else -> "application/octet-stream"
    }

    private fun isCacheableText(mime: String): Boolean =
        mime.contains("text") || mime.contains("javascript") || mime.contains("json") ||
        mime.contains("html") || mime.contains("css") || mime.contains("manifest")

    /**
     * 从服务器首页 HTML 的 #loginVer 元素提取版本号并缓存。
     * 这样网页更新后，登录页脚显示的服务器版本会自动同步，无需重新打包 APK。
     */
    private fun extractAndCacheVersion(html: String) {
        try {
            val re = Regex("""id=["']loginVer["'][^>]*>([^<]+)</""", RegexOption.IGNORE_CASE)
            val m = re.find(html)
            val ver = m?.groupValues?.get(1)?.trim()
            if (!ver.isNullOrEmpty()) {
                cacheManager.putVersion(ver)
                Log.i(TAG, "extracted server version: $ver")
            }
        } catch (e: Exception) {
            Log.w(TAG, "extract server version failed", e)
        }
    }

    private fun offlineErrJson(code: String): String {
        val m = when (code) {
            "offline_readonly" -> mapOf(
                "zh" to "当前离线，编辑操作需联网后重试",
                "en" to "Offline now, edit actions need network",
                "vi" to "Đang offline, thao tác sửa cần mạng"
            )
            "offline_no_cache" -> mapOf(
                "zh" to "当前离线，且本地无缓存数据",
                "en" to "Offline and no cached data locally",
                "vi" to "Đang offline và chưa có dữ liệu cache"
            )
            else -> mapOf(
                "zh" to "离线不可用",
                "en" to "Unavailable offline",
                "vi" to "Không dùng được khi offline"
            )
        }
        val msg = m[systemLang()] ?: m["zh"]!!
        return "{\"ok\":false,\"error\":" + org.json.JSONObject.quote(msg) + "}"
    }

    private fun buildTextResponse(status: Int, mime: String, body: String): WebResourceResponse {
        // WebResourceResponse 的 mimeType 参数必须是 "text/html" 这类纯类型，
        // 不能带 "; charset=..."，否则 WebView 会解析失败并退回到纯文本显示源码。
        val parts = mime.split(';')
        val baseMime = parts[0].trim().lowercase()
        val enc = parts.asSequence()
            .drop(1)
            .map { it.trim() }
            .filter { it.startsWith("charset", true) }
            .map { it.substringAfter('=', "").trim() }
            .firstOrNull { it.isNotEmpty() } ?: "UTF-8"
        val charset = try { java.nio.charset.Charset.forName(enc) } catch (e: Exception) { Charsets.UTF_8 }
        val stream = java.io.ByteArrayInputStream(body.toByteArray(charset))
        // ★ 关键：响应必须带 no-store/no-cache，否则 WebView 会把"拦截返回"的
        //   index.html/JS/CSS 缓存到自己的 HTTP 缓存里，下次启动直接喂旧页面 →
        //   登录页脚版本号永远不更新（"版本不更新"真凶）。离线缓存由我们自己的
        //   CacheManager 负责，不依赖 WebView 缓存，所以这里强制不缓存是安全的。
        val respHeaders = mapOf(
            "Cache-Control" to "no-store, no-cache, must-revalidate",
            "Pragma" to "no-cache",
            "Expires" to "0"
        )
        return WebResourceResponse(baseMime, enc, status, statusReason(status), respHeaders, stream)
    }

    /**
     * 离线缓存键归一化：去掉前端用于防缓存突击的查询参数（_t/_r/_v/_），
     * 否则离线时每次请求的 URL 都带新时间戳/随机数，永远命中不了缓存。
     * 服务器对这些参数本就忽略，所以线上转发仍用原始 URL，只有缓存键用归一化后的。
     */
    private fun normalizeApiKey(url: String): String {
        val q = url.indexOf('?')
        if (q < 0) return url
        val base = url.substring(0, q)
        val kept = url.substring(q + 1).split('&').filter { p ->
            val k = p.substringBefore('=').lowercase()
            k != "_t" && k != "_r" && k != "_v" && k != "_"
        }
        return if (kept.isEmpty()) base else "$base?${kept.joinToString("&")}"
    }

    private fun statusReason(status: Int): String {
        return when (status) {
            200 -> "OK"
            201 -> "Created"
            202 -> "Accepted"
            203 -> "Non-Authoritative Information"
            204 -> "No Content"
            301 -> "Moved Permanently"
            302 -> "Found"
            303 -> "See Other"
            304 -> "Not Modified"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            403 -> "Forbidden"
            404 -> "Not Found"
            412 -> "Precondition Failed"
            500 -> "Internal Server Error"
            503 -> "Service Unavailable"
            else -> "Status $status"
        }
    }

    /** 在线时尝试免密自动登录（用本地保存的凭据）；离线则交给 maybeOfflineSession 注入缓存会话 */
    private fun maybeAutoLogin() {
        if (!cacheManager.hasCreds()) return
        val s = cacheManager.getSession() ?: return
        try {
            val body = org.json.JSONObject(s.second)
            if (!body.optBoolean("ok", false) || !body.has("user")) return
            val ju = org.json.JSONObject.quote(body.getJSONObject("user").toString())
            val jp = org.json.JSONObject.quote(cacheManager.getCreds()?.second ?: "")
            webView.evaluateJavascript(
                "(window.VAULT_TOKEN || (function(){try{return sessionStorage.getItem('won_vault_token')}catch(e){return ''}})()) ? '1':'0'"
            ) { v ->
                if (v != null && v.contains("'1'")) {
                    // 已有会话，无需自动登录
                } else {
                    webView.evaluateJavascript("window.__fpLogin && window.__fpLogin($ju, $jp);", null)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "maybeAutoLogin failed", e)
        }
    }

    /** 离线且有缓存会话时，直接把 token + user 注入网页，进入"已登录（只读）"态 */
    private fun maybeOfflineSession() {
        if (!cacheManager.hasSession()) return
        val s = cacheManager.getSession() ?: return
        Log.i(TAG, "maybeOfflineSession: 有缓存会话，开始注入离线登录态")
        try {
            // 网页 saveSession 存的是"用户对象本身"（d.user），也可能存完整登录响应（含 ok/user）。
            // 兼容两种结构，取出 user 对象 JSON。
            val raw = s.second
            val userObj = try {
                val b = org.json.JSONObject(raw)
                if (b.has("user")) b.getJSONObject("user").toString() else raw
            } catch (e: Exception) { raw }
            val token = org.json.JSONObject.quote(s.first)
            val ju = org.json.JSONObject.quote(userObj)
            val js = "(function(){try{" +
                    "VAULT_TOKEN=$token;authUser=JSON.parse($ju);" +
                    "try{sessionStorage.setItem('won_vault_token',$token);}catch(e){}" +
                    "try{sessionStorage.setItem('won_auth_user',JSON.stringify(authUser));}catch(e){}" +
                    "if(typeof showMainContent==='function')showMainContent();" +
                    "if(typeof window._updateUserChip==='function')window._updateUserChip(authUser);" +
                    "if(typeof switchView==='function')switchView('dashboard');" +
                    "}catch(e){console.warn('[offline] inject failed',e);}})();"
            // 立即注入；再延迟 600ms 注入一次，防止页面启动时的会话校验把登录态覆盖回登录页
            webView.evaluateJavascript(js, null)
            webView.postDelayed({ webView.evaluateJavascript(js, null) }, 600)
        } catch (e: Exception) {
            Log.w(TAG, "maybeOfflineSession failed", e)
        }
    }

    /** 覆盖 index.html 登录页写死的版本号（<span id="loginVer">，旧值 V2026.09.08.19），
     *  改成 APK 的 versionName，保证页脚版本与构建同步、用户一眼可见。 */
    private fun overrideLoginVer() {
        val ver = org.json.JSONObject.quote(BuildConfig.VERSION_NAME)
        webView.evaluateJavascript(
            "(function(){try{var e=document.getElementById('loginVer');if(e)e.textContent=$ver;}catch(_){}})();",
            null
        )
    }

    /** 登录成功后（或联网打开且有会话时）后台静默预取各模块列表接口，
     *  让数据进入离线缓存，断网也能回放。请求经 shouldInterceptRequest 自动落盘。 */
    private var lastPrefetchTs = 0L
    private fun prefetchOfflineData() {
        if (!isNetworkAvailable()) return          // 离线时不预取（否则会把 503 错误写进缓存）
        if (!cacheManager.hasSession()) return
        val now = System.currentTimeMillis()
        if (now - lastPrefetchTs < 20000) return    // 20s 内不重复预取，避免刷屏
        lastPrefetchTs = now
        val js = "(function(){" +
                "try{" +
                "var base=(typeof API_BASE!=='undefined')?API_BASE:'https://agi-goldsum-crm.duckdns.org';" +
                "var eps=['/api/crm-projects','/api/lost-projects','/api/won-projects'," +
                "'/api/commission/records','/api/commission/amount-requests','/api/dashboard-stats'," +
                "'/api/session','/api/me'];" +
                "var h=(typeof authHeaders==='function')?authHeaders():{};" +
                "eps.forEach(function(p){try{fetch(base+p,{credentials:'include',headers:h});}catch(e){}});" +
                "}catch(e){}" +
                "})();"
        // evaluateJavascript 必须在 UI 线程执行（saveSession 桥回调在后台线程）
        runOnUiThread { webView.evaluateJavascript(js, null) }
        Log.i(TAG, "prefetchOfflineData: triggered background fetch of 6 endpoints")
    }

    /**
     * 完整离线数据同步：首次登录或每次联网登录后，把服务器上当前用户权限范围内的
     * 关键记录全部拉下来写入 CacheManager。完成后可选弹三语橙色居中提示。
     */
    private fun syncOfflineData(showToast: Boolean = false, force: Boolean = false) {
        if (!isNetworkAvailable()) return
        if (!cacheManager.hasSession()) return
        val now = System.currentTimeMillis()
        if (!force && now - lastFullSyncTs < 30000) return  // 30s 节流，避免重复同步
        lastFullSyncTs = now

        val sess = cacheManager.getSession() ?: return
        val token = sess.first
        // 从缓存的 user 里取 username，用于 /api/me?username= 等接口
        val username = try {
            org.json.JSONObject(sess.second).optString("username", "")
        } catch (e: Exception) { "" }
        val user = cacheManager.currentUser()
        val base = HOME_URL

        Thread {
            var okCount = 0
            var failCount = 0
            val endpoints = mutableListOf<String>().apply {
                add("/api/session")
                add("/api/me")
                if (username.isNotEmpty()) add("/api/me?username=${java.net.URLEncoder.encode(username, "UTF-8")}")
                add("/api/crm-projects")
                add("/api/lost-projects")
                add("/api/won-projects")
                add("/api/commission/records")
                add("/api/commission/amount-requests")
                add("/api/dashboard-stats")
                add("/api/dashboard-update-status")
                add("/api/login-history")
                add("/api/users")
                add("/api/managers")
                if (username.isNotEmpty()) add("/api/perm-version?username=${java.net.URLEncoder.encode(username, "UTF-8")}")
                add("/api/metal-prices?cur=USD")
                add("/api/metal-prices?cur=RMB")
                add("/api/metal-prices?cur=VND")
                add("/api/feed-prices")
                add("/api/livestock-prices")
                add("/api/fx-rates")
                // 审批流常用视图
                if (username.isNotEmpty()) {
                    add("/api/approval-requests?scope=todo&me=${java.net.URLEncoder.encode(username, "UTF-8")}")
                    add("/api/approval-requests?scope=mine&me=${java.net.URLEncoder.encode(username, "UTF-8")}")
                }
            }
            for (path in endpoints) {
                try {
                    val url = "$base$path"
                    val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                    conn.requestMethod = "GET"
                    conn.connectTimeout = 15000
                    conn.readTimeout = 20000
                    conn.setRequestProperty("Authorization", "Bearer $token")
                    conn.setRequestProperty("Accept", "application/json")
                    conn.setRequestProperty("Cache-Control", "no-cache")
                    conn.setRequestProperty("Pragma", "no-cache")
                    val status = conn.responseCode
                    val stream = if (status < 400) conn.inputStream else conn.errorStream
                    val bodyBytes = stream?.readBytes() ?: ByteArray(0)
                    val body = String(bodyBytes, Charsets.UTF_8)
                    val mime = conn.contentType ?: "application/json"
                    if (status in 200..299 && (mime.contains("json", true) || mime.contains("text", true))) {
                        cacheManager.putCache(user, normalizeApiKey(url), status, mime, body)
                        okCount++
                    } else {
                        failCount++
                    }
                    conn.disconnect()
                } catch (e: Exception) {
                    Log.w(TAG, "syncOfflineData failed: $path", e)
                    failCount++
                }
            }
            cacheManager.setLastSync(System.currentTimeMillis())
            Log.i(TAG, "syncOfflineData complete: ok=$okCount fail=$failCount")
            if (showToast) {
                runOnUiThread { showSyncToastWithCurrentLang() }
            }
        }.start()
    }

    /**
     * 当前系统语言（zh/en/vi）：提示文案随【系统】语言切换（不是 App 内部语言）。
     * 用 Resources.getSystem() 取设备真实系统语言，避免被 App 自身 locale 覆盖。
     */
    private fun systemLang(): String {
        return try {
            val loc = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                android.content.res.Resources.getSystem().configuration.locales[0]
            } else {
                @Suppress("DEPRECATION")
                android.content.res.Resources.getSystem().configuration.locale
            }
            when (loc.language.lowercase()) {
                "en" -> "en"
                "vi" -> "vi"
                else -> "zh"
            }
        } catch (e: Exception) { "zh" }
    }

    /**
     * 显示同步提示前，先主动从网页读取当前语言。
     *
     * 背景（提示语不跟随语言的真实根因）：curLang 由网页每 5 秒轮询推送(setLang)，
     * 而同步提示在登录成功后【立即】弹出，此时推送往往还没发生，
     * 于是提示语停留在旧语言；更糟的是网页的 agiLang() 在 CUR_LANG 尚未就绪时
     * 会用 navigator.language（设备系统语言）推送，导致原生侧被系统语言污染。
     * 这里在弹出前先查一次真实的 window.CUR_LANG，保证提示语与界面语言一致。
     */
    private fun showSyncToastWithCurrentLang() {
        try {
            webView.evaluateJavascript(
                "(function(){try{return String(window.CUR_LANG||'');}catch(e){return '';}})()"
            ) { v ->
                val l = v?.trim('"') ?: ""
                if (l == "zh" || l == "en" || l == "vi") curLang = l
                showSyncToast()
            }
        } catch (e: Exception) {
            Log.w(TAG, "read CUR_LANG failed", e)
            showSyncToast()
        }
    }

    /**
     * 三语同步成功提示：经典橙色背景、屏幕中央、约 1 秒后自动消失。
     * 用 Window 悬浮层实现 —— API 30+ 已废弃并忽略 Toast.setView，
     * 自定义橙色背景在 Android 11+ 会被丢弃，故改用 decorView 叠加层。
     */
    private fun showSyncToast() {
        val lang = curLang
        val msg = when (lang) {
            "en" -> "Latest records synced with server. You can still use them offline next time."
            "vi" -> "Dữ liệu mới nhất đã đồng bộ với máy chủ. Lần sau offline vẫn dùng được."
            else -> "最新记录已经与服务器同步成功，下次离线后仍然可以使用这些数据！"
        }
        runOnUiThread {
            try {
                val ctx = this
                val container = android.widget.FrameLayout(ctx).apply {
                    layoutParams = android.widget.FrameLayout.LayoutParams(
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                    )
                    isClickable = false
                    isFocusable = false
                    elevation = 2000f
                }
                val tv = android.widget.TextView(ctx).apply {
                    text = msg
                    setTextColor(android.graphics.Color.WHITE)
                    textSize = 14f
                    setPadding(40, 22, 40, 22)
                    gravity = android.view.Gravity.CENTER
                    elevation = 2000f
                    background = android.graphics.drawable.GradientDrawable().apply {
                        cornerRadius = 18f
                        setColor(android.graphics.Color.argb(238, 214, 120, 0)) // 经典橙 #D67800
                    }
                }
                val lp = android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                    android.widget.FrameLayout.LayoutParams.WRAP_CONTENT
                ).apply { gravity = android.view.Gravity.CENTER }
                container.addView(tv, lp)
                val decor = window.decorView as android.view.ViewGroup
                decor.addView(container)
                container.bringToFront()
                // 约 3 秒后自动消失（用户要求停留更久，便于看清三语文案）
                backHandler.postDelayed({ try { decor.removeView(container) } catch (_: Exception) {} }, 3000)
            } catch (e: Exception) {
                Log.w(TAG, "showSyncToast failed", e)
                try { android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show() } catch (_: Exception) {}
            }
        }
    }


    inner class AndroidBridge {
        @android.webkit.JavascriptInterface
        fun saveCredentials(user: String, pwd: String) {
            cacheManager.saveCreds(user, pwd)
        }

        /** 登录成功后由网页调用：保存服务端会话 token + 用户资料，供离线注入会话登录 */
        @android.webkit.JavascriptInterface
        fun saveSession(token: String, userJson: String) {
            cacheManager.putSession(token, userJson)
            // ★ 登录成功后【不要立即】全量同步：
            //   它会把服务器上全部关键记录拉下来并写入加密缓存，与首页数据加载
            //   争抢带宽和 CPU —— 这正是"点登录按钮后进度条要走好几秒"的原因。
            //   改为延后到首页基本加载完成后再在后台同步，离线能力完全不受影响。
            backHandler.postDelayed({
                syncOfflineData(showToast = true, force = true)
            }, 8000)
        }

        @android.webkit.JavascriptInterface
        fun clearCredentials() {
            cacheManager.clearCreds()
        }

        @android.webkit.JavascriptInterface
        fun hasCredentials(): String =
            if (cacheManager.hasCreds()) "1" else "0"

        /** 缓存状态：是否离线 + 上次同步时间（网页据此提示） */
        @android.webkit.JavascriptInterface
        fun cacheStatus(): String = cacheManager.cacheStatusJson(!isNetworkAvailable())

        /** 当前是否离线：'1' = 离线，'0' = 在线 */
        @android.webkit.JavascriptInterface
        fun isOffline(): String = if (isNetworkAvailable()) "0" else "1"

        /** 网页推送当前语言(zh/en/vi)，离线提示文案随之切换 */
        @android.webkit.JavascriptInterface
        fun setLang(lang: String) {
            curLang = when (lang) {
                "en" -> "en"
                "vi" -> "vi"
                else -> "zh"
            }
        }

        // ★ 手机 APP 已移除打印功能（用户需求：网页版保留打印，APP 内不需要）。
        //   这里不再提供 printToPdf 接口：APP 里点"打印"会走网页自身的 window.print()，
        //   在 WebView 中不产生任何反应、不弹任何提示。
        //   网页版 index.html 的打印逻辑未做任何改动，浏览器中照常可用。

        /** 离线启动时注入的会话（token + user JSON），仅在断网且有缓存时有效 */
        @android.webkit.JavascriptInterface
        fun offlineSession(): String {
            val s = cacheManager.getSession() ?: return "null"
            return try {
                val raw = s.second
                // 兼容两种存储格式：完整登录响应 {user:...} 或纯 user 对象
                val userObj = try {
                    val b = org.json.JSONObject(raw)
                    if (b.has("user")) b.getJSONObject("user") else b
                } catch (e: Exception) {
                    org.json.JSONObject(raw)
                }
                org.json.JSONObject().put("token", s.first).put("user", userObj).toString()
            } catch (e: Exception) {
                "null"
            }
        }

        @android.webkit.JavascriptInterface
        fun authenticate() {
            runOnUiThread { showFingerprintDialog() }
        }

        /**
         * 网页主动推送"当前是否有可返回的内部层级"（私密空间子目录/预览/弹窗等）。
         * '1' = 有（返回键交给网页）；'0' = 没有（返回键走原生回退/退出）。
         *
         * 这是【同步】调用（JS 接口同步执行），比 evaluateJavascript 异步回调可靠得多：
         * 返回键按下时直接读标志位，不受 JS 执行速度/超时影响。
         */
        @android.webkit.JavascriptInterface
        fun setBackState(state: String) {
            webCanGoBack = (state == "1")
            Log.d(TAG, "setBackState -> $webCanGoBack")
        }

        /**
         * 网页主动切换屏幕方向（私密空间竖屏看文档 / 主系统横屏看表格）。
         * mode: "portrait" | "landscape" | "sensor"（跟随传感器自动旋转）
         *
         * 说明：Manifest 里是 sensorLandscape（主系统按横屏设计），
         * 但运行时 requestedOrientation 的优先级高于 Manifest，
         * 所以私密空间可以在不改 Manifest 的前提下临时切成竖屏。
         */
        @android.webkit.JavascriptInterface
        fun setOrientation(mode: String) {
            runOnUiThread {
                val o = when (mode.lowercase()) {
                    "portrait" -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    "landscape" -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    else -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR
                }
                if (requestedOrientation != o) {
                    requestedOrientation = o
                    Log.d(TAG, "setOrientation -> $mode")
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    @SuppressLint("MissingPermission")
    private fun showFingerprintDialog() {
        val fm = try {
            @Suppress("DEPRECATION")
            getSystemService(android.hardware.fingerprint.FingerprintManager::class.java)
        } catch (e: Exception) { null }
        if (fm == null || !fm.isHardwareDetected || !fm.hasEnrolledFingerprints()) {
            Toast.makeText(this, "此设备不支持指纹或未录入指纹", Toast.LENGTH_SHORT).show()
            return
        }
        val creds = cacheManager.getCreds()
        val user = creds?.first ?: ""
        val pwd = creds?.second ?: ""
        if (pwd.isEmpty()) {
            Toast.makeText(this, "请先登录一次以保存凭据", Toast.LENGTH_SHORT).show()
            return
        }

        val tv = TextView(this).apply {
            text = "请触摸指纹传感器\nTouch the fingerprint sensor"
            setPadding(64, 40, 64, 24)
            textSize = 16f
        }
        val dlg = android.app.AlertDialog.Builder(this)
            .setTitle("指纹登录 / Fingerprint")
            .setView(tv)
            .setNegativeButton("取消") { d, _ -> d.dismiss() }
            .create()
        dlg.show()

        fm.authenticate(
            null, android.os.CancellationSignal(), 0,
            object : android.hardware.fingerprint.FingerprintManager.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: android.hardware.fingerprint.FingerprintManager.AuthenticationResult?) {
                    dlg.dismiss()
                    runOnUiThread {
                        val ju = org.json.JSONObject.quote(user)
                        val jp = org.json.JSONObject.quote(pwd)
                        webView.evaluateJavascript(
                            "window.__fpLogin && window.__fpLogin($ju, $jp);", null
                        )
                    }
                }

                override fun onAuthenticationFailed() {
                    tv.text = "识别失败，请再试\nNot recognized, try again"
                }

                override fun onAuthenticationError(errCode: Int, errString: CharSequence?) {
                    dlg.dismiss()
                    Toast.makeText(this@MainActivity, errString ?: "指纹验证出错", Toast.LENGTH_SHORT).show()
                }
            },
            null
        )
    }
}
