package tr.com.bkthukuk.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class BktFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushPlugin.tokenRefreshed()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.notification?.title ?: return
        val body = message.notification?.body ?: return
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "bkt_reminders_v1"
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(
                channelId, "BKT Hukuk Hatırlatmaları", NotificationManager.IMPORTANCE_DEFAULT
            ))
        }
        val route = message.data["route"]?.takeIf { it in setOf("file-detail", "deadlines", "tasks") }
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
        launch.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        route?.let { launch.putExtra("bkt_push_route", it) }
        message.data["file_id"]?.let { launch.putExtra("bkt_push_file_id", it) }
        val requestCode = (message.messageId ?: message.data["event_key"] ?: body).hashCode()
        val pending = PendingIntent.getActivity(
            this, requestCode, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        manager.notify(requestCode, notification)
    }
}
