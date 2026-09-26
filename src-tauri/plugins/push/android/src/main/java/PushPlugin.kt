package tr.com.bkthukuk.push

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging
import java.lang.ref.WeakReference

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class PushPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private var current: WeakReference<PushPlugin>? = null
        fun tokenRefreshed() {
            val plugin = current?.get() ?: return
            plugin.activity.runOnUiThread { plugin.trigger("tokenRefreshed", JSObject()) }
        }
    }

    init {
        current = WeakReference(this)
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = activity.getSystemService(Activity.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(NotificationChannel(
                "bkt_reminders_v1", "BKT Hukuk Hatırlatmaları", NotificationManager.IMPORTANCE_DEFAULT
            ))
        }
    }
    private var pendingNavigation: JSObject? = null

    override fun onNewIntent(intent: Intent) {
        readNavigation(intent)?.let {
            pendingNavigation = it
            trigger("navigation", it)
        }
    }

    @Command
    fun getToken(invoke: Invoke) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful || task.result.isNullOrBlank()) {
                invoke.reject("FCM token unavailable")
            } else {
                invoke.resolve(JSObject().apply { put("token", task.result) })
            }
        }
    }

    @Command
    fun getPermissionState(invoke: Invoke) {
        val granted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        invoke.resolve(JSObject().apply { put("granted", granted) })
    }

    @Command
    fun getPendingNavigation(invoke: Invoke) {
        val navigation = pendingNavigation ?: readNavigation(activity.intent)
        pendingNavigation = null
        activity.intent?.removeExtra("bkt_push_route")
        activity.intent?.removeExtra("bkt_push_file_id")
        activity.intent?.removeExtra("route")
        activity.intent?.removeExtra("file_id")
        invoke.resolve(navigation ?: JSObject())
    }

    private fun readNavigation(intent: Intent?): JSObject? {
        val source = intent ?: return null
        val route = source.getStringExtra("bkt_push_route") ?: source.getStringExtra("route") ?: return null
        if (route !in setOf("file-detail", "deadlines", "tasks")) return null
        val fileId = source.getStringExtra("bkt_push_file_id") ?: source.getStringExtra("file_id")
        return JSObject().apply { put("route", route); put("fileId", fileId) }
    }
}
