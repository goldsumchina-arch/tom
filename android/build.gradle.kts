// ============================================================
// 根 build.gradle（Kotlin DSL）
// 这里只声明插件版本，具体依赖写在 app/build.gradle.kts
// ============================================================
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
