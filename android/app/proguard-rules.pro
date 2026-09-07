# 混淆规则（当前 release 包未开启混淆，此文件仅作占位）
# 如以后开启 isMinifyEnabled = true，需在此保留 WebView 相关类
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
