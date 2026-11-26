// Android Keystore wrapper for the data key (spec 6.1).
// CI copies this into the generated Android project
// (gen/android/app/src/main/java/io/github/barksandbytes/workdashboard/).
// The AES-256 key is created inside the Keystore and never leaves it.
package io.github.barksandbytes.workdashboard

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class KeystoreArgs {
    lateinit var data: String
}

@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "work-dashboard-data-key"
    private val transformation = "AES/GCM/NoPadding"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun reply(invoke: Invoke, bytes: ByteArray) {
        val ret = JSObject()
        ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
        invoke.resolve(ret)
    }

    @Command
    fun wrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(KeystoreArgs::class.java)
            val plain = Base64.decode(args.data, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(transformation)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            reply(invoke, cipher.iv + cipher.doFinal(plain))
        } catch (e: Exception) {
            invoke.reject("Keystore wrap failed: ${e.message}")
        }
    }

    @Command
    fun unwrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(KeystoreArgs::class.java)
            val sealed = Base64.decode(args.data, Base64.NO_WRAP)
            if (sealed.size < 12 + 16) throw IllegalArgumentException("too short")
            val cipher = Cipher.getInstance(transformation)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            reply(invoke, cipher.doFinal(sealed.copyOfRange(12, sealed.size)))
        } catch (e: Exception) {
            invoke.reject("Keystore unwrap failed: ${e.message}")
        }
    }
}
