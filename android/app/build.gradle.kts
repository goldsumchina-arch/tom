// ============================================================
// AGI-PM 安卓 APP 构建配置
// ============================================================
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.agipm.app"

    // 编译用的 Android 版本（35 = Android 15）
    compileSdk = 35

    defaultConfig {
        // APP 在手机上的唯一标识（发布后不可更改，务必保留）
        applicationId = "com.agipm.app"

        // 最低支持 Android 7.0（覆盖 99% 在用设备）
        minSdk = 24
        // 目标 Android 15
        targetSdk = 35

        // ★ 版本号是三端（APK / Windows EXE / 网页）的唯一真源。
        //
        // 命名规则：V<年.月.日>.<当天第几次更改>
        //   · 末尾两位 = 当天第几次修改，从 01 开始，同日递增（01、02、03...）
        //   · 跨天则日期变化、序号重新从 01 起算
        //   · 例：9 月 5 日第一次改动 = V2026.09.05.01，当天第二次 = V2026.09.05.02
        //   · 参考历史：V2026.09.02.07→.09→.14（同日），V2026.09.03.01→.02→.03（跨日归01）
        //
        // 注意：末段【不是】全局序号，也【不】等于 MainActivity 的 WEB_VERSION
        //      （WEB_VERSION 是网页内容版本，两者互不相关，不要耦合）。
        //
        // Windows 的 build_desktop.py 与本项目的 build_apk.py 都从这里读取，
        // 两边生成的 APK / EXE 文件名永远一致。
        versionCode = 155
        versionName = "V2026.09.10.06"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // 签名配置
    // debug 包用 Android Studio 自动生成的调试签名，无需手动配置
    signingConfigs {
        create("release") {
            storeFile = file(rootProject.file("agi-pm-release.keystore"))
            storePassword = (project.findProperty("AGI_PM_RELEASE_STORE_PASSWORD") as String?) ?: ""
            keyAlias = (project.findProperty("AGI_PM_RELEASE_KEY_ALIAS") as String?) ?: "agipm"
            keyPassword = (project.findProperty("AGI_PM_RELEASE_KEY_PASSWORD") as String?) ?: ""
        }
    }

    buildTypes {
        debug {
            // 仍保留 debug 供开发，但发布统一走 release
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // 关键：release 必须用自签名 keystore 签名，否则无法安装
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // AndroidX 核心库
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.12.1")

    // 下拉刷新（用户可手动强制刷新，避免 WebView 缓存旧页面）
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    // 单元测试（可选，不影响打包）
    testImplementation("junit:junit:4.13.2")
}
