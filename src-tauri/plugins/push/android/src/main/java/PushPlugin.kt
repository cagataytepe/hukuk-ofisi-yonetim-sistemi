package tr.com.bkthukuk.push

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
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
    private data class Navigation(
        val route: String,
        val fileId: String? = null,
        val hearingId: String? = null,
        val view: String? = null,
        val date: String? = null
    )

    companion object {
        private const val NAVIGATION_STORE = "bkt_push_navigation"
        private const val ACTION_PUSH = "BKT_PUSH_NOTIFICATION"
        private var current: WeakReference<PushPlugin>? = null
        fun tokenRefreshed() {
            val plugin = current?.get() ?: return
            plugin.activity.runOnUiThread { plugin.trigger("tokenRefreshed", JSObject()) }
        }
    }

    init {
        current = WeakReference(this)
        readNavigation(activity.intent)?.let(::storeNavigation)
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = activity.getSystemService(Activity.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(NotificationChannel(
                "bkt_reminders_v1", "BKT Hukuk Hatırlatmaları", NotificationManager.IMPORTANCE_DEFAULT
            ))
        }
    }
    override fun onNewIntent(intent: Intent) {
        readNavigation(intent)?.let {
            storeNavigation(it)
            trigger("navigation", it.toJsObject())
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
        readNavigation(activity.intent)?.let(::storeNavigation)
        val navigation = takeStoredNavigation()
        clearIntentNavigation(activity.intent)
        invoke.resolve(navigation?.toJsObject() ?: JSObject())
    }

    private fun readNavigation(intent: Intent?): Navigation? {
        val source = intent ?: return null
        val route = source.getStringExtra("bkt_push_route") ?: source.getStringExtra("route") ?: return null
        if (route !in setOf("file-detail", "hearings", "deadlines", "tasks")) return null
        return Navigation(
            route = route,
            fileId = source.getStringExtra("bkt_push_file_id") ?: source.getStringExtra("file_id"),
            hearingId = source.getStringExtra("bkt_push_hearing_id") ?: source.getStringExtra("hearing_id"),
            view = source.getStringExtra("bkt_push_view") ?: source.getStringExtra("view"),
            date = source.getStringExtra("bkt_push_date") ?: source.getStringExtra("date")
        )
    }

    private fun Navigation.toJsObject() = JSObject().apply {
        put("route", route)
        fileId?.let { put("fileId", it) }
        hearingId?.let { put("hearingId", it) }
        view?.let { put("view", it) }
        date?.let { put("date", it) }
    }

    private fun storeNavigation(navigation: Navigation) {
        activity.getSharedPreferences(NAVIGATION_STORE, Context.MODE_PRIVATE).edit()
            .putString("route", navigation.route)
            .putString("fileId", navigation.fileId)
            .putString("hearingId", navigation.hearingId)
            .putString("view", navigation.view)
            .putString("date", navigation.date)
            .apply()
    }

    private fun takeStoredNavigation(): Navigation? {
        val preferences = activity.getSharedPreferences(NAVIGATION_STORE, Context.MODE_PRIVATE)
        val route = preferences.getString("route", null) ?: return null
        val navigation = Navigation(
            route = route,
            fileId = preferences.getString("fileId", null),
            hearingId = preferences.getString("hearingId", null),
            view = preferences.getString("view", null),
            date = preferences.getString("date", null)
        )
        preferences.edit().clear().apply()
        return navigation
    }

    private fun clearIntentNavigation(intent: Intent?) {
        val source = intent ?: return
        for (key in listOf(
            "bkt_push_route", "bkt_push_file_id", "bkt_push_hearing_id", "bkt_push_view", "bkt_push_date",
            "route", "file_id", "hearing_id", "view", "date"
        )) source.removeExtra(key)
        if (source.action == ACTION_PUSH) source.action = null
    }
}
