// Voice input on Android (spec 9): opens the phone's built-in speech
// recognizer and returns the text. Prefers offline recognition (turn on
// offline speech / download the English pack in Android settings).
// CI copies this into the generated Android project.
package io.github.barksandbytes.workdashboard

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class SpeechPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun listen(invoke: Invoke) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Say what happened")
        }
        if (intent.resolveActivity(activity.packageManager) == null) {
            invoke.reject("no-recognizer")
            return
        }
        startActivityForResult(invoke, intent, "onResult")
    }

    @ActivityCallback
    private fun onResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("cancelled")
            return
        }
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
        val ret = JSObject()
        ret.put("text", text)
        invoke.resolve(ret)
    }
}
