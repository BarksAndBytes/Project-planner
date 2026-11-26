// Shares an exported file (Word summary, CSV, backup) through Android's
// share sheet, so it can go to Word, Drive, email, etc. Only files inside
// the app's own cache/exports folder can be shared.
// CI copies this into the generated Android project.
package io.github.barksandbytes.workdashboard

import android.app.Activity
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

class ExportFileProvider : FileProvider()

@InvokeArg
class ShareArgs {
    lateinit var path: String
    lateinit var mime: String
    var title: String = "Share"
}

@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun share(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ShareArgs::class.java)
            val exports = File(activity.cacheDir, "exports").canonicalFile
            val file = File(args.path).canonicalFile
            if (file.parentFile != exports || !file.isFile) throw IllegalArgumentException("not an export file")
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".exports", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = args.mime
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, args.title))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Share failed: ${e.message}")
        }
    }
}
