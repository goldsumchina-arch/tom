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
        private const val WEB_VERSION = 84

        private const val PREFS_NAME = "agipm_prefs"
        private const val KEY_LAST_WEB_VERSION = "last_web_version"

        // 指纹登录凭据存储（APK 私有目录，其他应用无法读取；Base64 混淆存放）
        private const val CREDS_PREFS = "agipm_creds"
        private const val KEY_CRED_USER = "cu"
        private const val KEY_CRED_PWD = "cp"
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorLayout: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var retryButton: Button
    private lateinit var swipeRefresh: SwipeRefreshLayout

    // 用于文件上传/下载
    private var filePathCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private val FILE_CHOOSER_REQUEST_CODE = 1001

    private var lastBackPressedTime = 0L

    // 主站点（pages.dev）加载失败后是否已切换到备用站点（workers.dev）
    private var usedFallback = false

    // 返回键处理：避免 evaluateJavascript 异步回调与超时兜底重复执行
    private val backHandler by lazy { Handler(Looper.getMainLooper()) }
    private var backSettled = false

    // 网页推送的"有内部可返回层级"标志（由 AndroidBridge.setBackState 同步写入）
    @Volatile
    private var webCanGoBack = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                errorLayout.visibility = View.GONE
                // 页面加载完成，收起下拉刷新进度圈
                swipeRefresh.isRefreshing = false
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

                // ★ 双击（2 秒内第二次）→ 退出 APP
                if (now - lastBackPressedTime < 2000) {
                    finish()
                    return
                }
                lastBackPressedTime = now

                // ★ 单击 → 返回上一级（同步发出回退动作，不关心返回值）
                webView.evaluateJavascript(
                    "(function(){try{if(window.__handleBack){window.__handleBack();}}catch(e){}})()",
                    null
                )

                // 若当前确实没有可返回的层级（网页推送的标志位为 false），
                // 提示"再按一次退出"，避免用户困惑（此时双击即可退出）
                if (!webCanGoBack) {
                    Toast.makeText(this@MainActivity, R.string.exit_confirm, Toast.LENGTH_SHORT).show()
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
            finish()
        } else {
            lastBackPressedTime = now
            Toast.makeText(this@MainActivity, R.string.exit_confirm, Toast.LENGTH_SHORT).show()
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

    private fun showError(msg: String) {
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
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val n = cm.activeNetwork
                if (n == null) {
                    // activeNetwork 为 null 不等于没网（部分 ROM / 刚开机时），
                    // 退回旧接口再判一次，判不出来就认为"有网"，交给 WebView 去试。
                    val info = cm.activeNetworkInfo
                    info?.isConnected ?: true
                } else {
                    val caps = cm.getNetworkCapabilities(n)
                    caps == null || caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                }
            } else {
                val info = cm.activeNetworkInfo
                info != null && info.isConnected
            }
        } catch (e: Exception) {
            true    // 判断出错时乐观处理，让 WebView 自己尝试
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

    private val credPrefs by lazy {
        getSharedPreferences(CREDS_PREFS, Context.MODE_PRIVATE)
    }

    inner class AndroidBridge {
        @android.webkit.JavascriptInterface
        fun saveCredentials(user: String, pwd: String) {
            credPrefs.edit()
                .putString(KEY_CRED_USER, android.util.Base64.encodeToString(user.toByteArray(), android.util.Base64.NO_WRAP))
                .putString(KEY_CRED_PWD, android.util.Base64.encodeToString(pwd.toByteArray(), android.util.Base64.NO_WRAP))
                .apply()
        }

        @android.webkit.JavascriptInterface
        fun clearCredentials() {
            credPrefs.edit().clear().apply()
        }

        @android.webkit.JavascriptInterface
        fun hasCredentials(): String =
            if (credPrefs.getString(KEY_CRED_PWD, null).isNullOrEmpty()) "0" else "1"

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
        val b64 = { s: String? ->
            try {
                s?.let { String(android.util.Base64.decode(it, android.util.Base64.NO_WRAP)) } ?: ""
            } catch (e: Exception) { "" }
        }
        val user = b64(credPrefs.getString(KEY_CRED_USER, null))
        val pwd = b64(credPrefs.getString(KEY_CRED_PWD, null))
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
