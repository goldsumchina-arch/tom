package com.agipm.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 离线只读缓存管理器。
 *
 * 不依赖任何外部库：直接用 AndroidKeyStore 生成并保管一把 AES-256-GCM 密钥
 * （密钥不可导出、仅本机可用），所有凭据与缓存数据均以密文落盘到 APP 私有
 * SharedPreferences，其他应用与 root 外均无法读出明文。
 *
 * 设计要点：
 *   - 按用户名命名空间隔离：不同用户登录同一设备，缓存互不串看。
 *   - 个人佣金仅 cuong/tom/travis 允许缓存（暗门，其余人绝不落盘）。
 *   - 仅缓存 JSON/文本响应（200~299），附件(/api/files、/api/vault)永不缓存。
 */
data class CacheEntry(val status: Int, val mime: String, val body: String, val ts: Long)

class CacheManager(private val ctx: Context) {

    private val prefs = ctx.getSharedPreferences("agipm_secure", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val secretKey: SecretKey

    companion object {
        private const val KEY_ALIAS = "agipm_cache_key"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val IV_LEN = 12
        private val COMMISSION_ALLOWED = setOf("cuong", "tom", "travis")
        private const val K_CU = "cu"
        private const val K_CP = "cp"
        private const val K_LAST = "last_sync"
        private const val K_SESS_TOKEN = "sess_token"
        private const val K_SESS_USER = "sess_user"
        private const val K_VERSION = "server_version"
        private const val PREFIX_CACHE = "cache:"
        private const val OLD_CREDS = "agipm_creds"
    }

    init {
        secretKey = getOrCreateKey()
        migrateOldCreds()
    }

    private fun getOrCreateKey(): SecretKey {
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return keyStore.getKey(KEY_ALIAS, null) as SecretKey
        }
        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            .build()
        kg.init(spec)
        return kg.generateKey()
    }

    private fun encrypt(plain: String): String {
        // ★ Android Keystore（API 29+）默认要求"随机化加密"，禁止调用方提供 IV，
        //   必须由密钥库自己生成。若仍传自定义 IV 会抛
        //   InvalidAlgorithmParameterException: Caller-provided IV not permitted，
        //   导致加密整体失败、站点/会话/凭据全部写不进磁盘 → 离线彻底失效。
        //   正确做法：加密不传 IV，init 后从 cipher.iv 取回密钥库生成的随机 IV，拼到密文前。
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey) // 密钥库生成随机 IV
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return android.util.Base64.encodeToString(iv, android.util.Base64.NO_WRAP) + ":" +
                android.util.Base64.encodeToString(ct, android.util.Base64.NO_WRAP)
    }

    private fun decrypt(b64: String): String {
        val parts = b64.split(":", limit = 2)
        if (parts.size != 2) return ""
        val iv = android.util.Base64.decode(parts[0], android.util.Base64.NO_WRAP)
        val ct = android.util.Base64.decode(parts[1], android.util.Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }

    private fun migrateOldCreds() {
        try {
            val old = ctx.getSharedPreferences(OLD_CREDS, Context.MODE_PRIVATE)
            val ou = old.getString("cu", null)
            val op = old.getString("cp", null)
            if (!ou.isNullOrEmpty() && !op.isNullOrEmpty() && prefs.getString(K_CU, null).isNullOrEmpty()) {
                val u = String(android.util.Base64.decode(ou, android.util.Base64.NO_WRAP))
                val p = String(android.util.Base64.decode(op, android.util.Base64.NO_WRAP))
                saveCreds(u, p)
            }
            old.edit().clear().apply()
        } catch (e: Exception) {
            // 迁移失败不影响新逻辑
        }
    }

    fun saveCreds(user: String, pwd: String) {
        prefs.edit().putString(K_CU, encrypt(user)).putString(K_CP, encrypt(pwd)).apply()
    }

    fun getCreds(): Pair<String, String>? {
        val eu = prefs.getString(K_CU, null) ?: return null
        val ep = prefs.getString(K_CP, null) ?: return null
        return try {
            val u = decrypt(eu)
            val p = decrypt(ep)
            if (u.isEmpty() || p.isEmpty()) null else Pair(u, p)
        } catch (e: Exception) {
            null
        }
    }

    fun hasCreds(): Boolean = prefs.getString(K_CP, null) != null

    fun clearCreds() {
        prefs.edit().remove(K_CU).remove(K_CP).apply()
    }

    fun currentUser(): String {
        val eu = prefs.getString(K_CU, null) ?: return ""
        return try {
            decrypt(eu)
        } catch (e: Exception) {
            ""
        }
    }

    fun isCommissionAllowed(user: String): Boolean =
        COMMISSION_ALLOWED.contains(user.lowercase())

    private fun hashKey(user: String, url: String): String {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        val h = md.digest(("$user|$url").toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(PREFIX_CACHE)
        for (b in h) sb.append("%02x".format(b))
        return sb.toString()
    }

    fun putCache(user: String, url: String, status: Int, mime: String, body: String) {
        try {
            val obj = JSONObject()
                .put("status", status)
                .put("mime", mime)
                .put("body", body)
                .put("ts", System.currentTimeMillis())
            prefs.edit().putString(hashKey(user, url), encrypt(obj.toString())).apply()
            setLastSync(System.currentTimeMillis())
        } catch (e: Exception) {
            // 缓存写入失败不影响在线使用
        }
    }

    fun getCache(user: String, url: String): CacheEntry? {
        return try {
            val s = prefs.getString(hashKey(user, url), null) ?: return null
            val o = JSONObject(decrypt(s))
            CacheEntry(o.getInt("status"), o.getString("mime"), o.getString("body"), o.getLong("ts"))
        } catch (e: Exception) {
            null
        }
    }

    fun setLastSync(ts: Long) {
        try {
            prefs.edit().putLong(K_LAST, ts).apply()
        } catch (e: Exception) {
        }
    }

    fun getLastSync(): Long = try {
        prefs.getLong(K_LAST, 0L)
    } catch (e: Exception) {
        0L
    }

    fun putSession(token: String?, userJson: String?) {
        try {
            if (!token.isNullOrEmpty()) prefs.edit().putString(K_SESS_TOKEN, encrypt(token)).apply()
            if (!userJson.isNullOrEmpty()) {
                prefs.edit().putString(K_SESS_USER, encrypt(userJson)).apply()
                // 同时保存用户名到 K_CU：让离线缓存键（按用户名）与在线一致，
                // 且即使用户没勾"记住密码"，离线也能注入会话登录。
                try {
                    val u = org.json.JSONObject(userJson).optString("username", "")
                    if (u.isNotEmpty()) prefs.edit().putString(K_CU, encrypt(u)).apply()
                } catch (e: Exception) { }
            }
        } catch (e: Exception) {
        }
    }

    fun hasSession(): Boolean =
        prefs.getString(K_SESS_TOKEN, null) != null && prefs.getString(K_SESS_USER, null) != null

    /** 仅清除持久登录会话（token + user），保留记住的密码与离线数据缓存。用于"登出"后回到登录页。 */
    fun clearSession() {
        try {
            prefs.edit().remove(K_SESS_TOKEN).remove(K_SESS_USER).apply()
        } catch (e: Exception) { }
    }

    fun getSession(): Pair<String, String>? {
        val t = prefs.getString(K_SESS_TOKEN, null) ?: return null
        val u = prefs.getString(K_SESS_USER, null) ?: return null
        return try {
            Pair(decrypt(t), decrypt(u))
        } catch (e: Exception) {
            null
        }
    }

    /** 缓存服务器首页上的版本号（loginVer），供离线/不重新打包时显示最新版本。 */
    fun putVersion(version: String?) {
        try {
            if (!version.isNullOrEmpty()) {
                prefs.edit().putString(K_VERSION, encrypt(version)).apply()
            }
        } catch (e: Exception) { }
    }

    fun getVersion(): String? {
        val v = prefs.getString(K_VERSION, null) ?: return null
        return try { decrypt(v) } catch (e: Exception) { null }
    }

    fun cacheStatusJson(offline: Boolean): String {
        return try {
            JSONObject().put("offline", offline).put("lastSync", getLastSync()).toString()
        } catch (e: Exception) {
            "{\"offline\":$offline,\"lastSync\":0}"
        }
    }

    // ---- 站点静态资源离线缓存（主文档 + 外链脚本/样式/清单）----
    // 用 APP 私有文件存储（不用 SharedPreferences），避免单值 ~1MB Binder 上限——
    // index.html 约 1.6MB，落 SharedPreferences 会写失败导致离线整页无法加载。
    private val siteDir by lazy { ctx.getDir("agipm_site", Context.MODE_PRIVATE) }

    private fun siteFile(key: String): java.io.File {
        // 两次 hash 降低碰撞概率
        val h = Integer.toHexString(key.hashCode()) + "_" + Integer.toHexString(key.reversed().hashCode())
        return java.io.File(siteDir, "s_$h")
    }

    fun putSite(key: String, mime: String, body: String) {
        try {
            val f = siteFile(key)
            val mf = java.io.File(siteDir, f.name + ".mime")
            f.writeText(encrypt(body), Charsets.UTF_8)
            mf.writeText(mime, Charsets.UTF_8)
            setLastSync(System.currentTimeMillis())
        } catch (e: Exception) {
            android.util.Log.w("CacheManager", "putSite failed: $key", e)
        }
    }

    fun getSite(key: String): CacheEntry? {
        return try {
            val f = siteFile(key)
            if (!f.exists()) return null
            val mf = java.io.File(siteDir, f.name + ".mime")
            val mime = if (mf.exists()) mf.readText(Charsets.UTF_8) else "application/octet-stream"
            CacheEntry(200, mime, decrypt(f.readText(Charsets.UTF_8)), f.lastModified())
        } catch (e: Exception) {
            null
        }
    }

    /** 清空站点静态缓存（主文档 + 脚本），用于重新同步。 */
    fun clearSite() {
        try {
            siteDir.listFiles()?.forEach { it.delete() }
        } catch (e: Exception) { }
    }

    /** 清空全部离线数据（凭据 + 会话 + API 缓存 + 站点缓存），用于"重置离线缓存"。 */
    fun clearAll() {
        try {
            val e = prefs.edit()
            for (k in prefs.all.keys) {
                if (k.startsWith(PREFIX_CACHE)
                    || k == K_CU || k == K_CP || k == K_SESS_TOKEN || k == K_SESS_USER || k == K_LAST
                ) {
                    e.remove(k)
                }
            }
            e.apply()
            clearSite()
        } catch (e: Exception) { }
    }
}
