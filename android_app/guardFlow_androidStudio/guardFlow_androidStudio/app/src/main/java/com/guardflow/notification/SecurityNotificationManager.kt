package com.guardflow.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.guardflow.MainActivity
import com.guardflow.model.RiskLevel
import com.guardflow.model.RiskResult

class SecurityNotificationManager(private val context: Context) {

    private val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    companion object {
        const val URGENT_CHANNEL_ID = "guardflow_urgent_v2" // Incremented version to force update
        const val INFO_CHANNEL_ID = "guardflow_info"
        const val NOTIFICATION_ID = 1001
    }

    fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Urgent Channel (High Risk)
            val urgentChannel = NotificationChannel(
                URGENT_CHANNEL_ID,
                "GuardFlow Urgent",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Critical security alerts and scam detections"
                enableVibration(true)
                setBypassDnd(true)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                enableLights(true)
                lightColor = android.graphics.Color.RED
                importance = NotificationManager.IMPORTANCE_HIGH
            }

            // Information Channel (Safe/Medium Risk)
            val infoChannel = NotificationChannel(
                INFO_CHANNEL_ID,
                "GuardFlow Information",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "General security status updates and analysis results"
            }

            notificationManager.createNotificationChannel(urgentChannel)
            notificationManager.createNotificationChannel(infoChannel)
        }
    }

    fun showNotificationForResult(result: RiskResult) {
        when (result.level) {
            RiskLevel.LOW -> showSafeNotification()
            RiskLevel.MEDIUM -> showMediumRiskNotification(result)
            RiskLevel.HIGH -> showHighRiskNotification(result)
            RiskLevel.CRITICAL -> showHighRiskNotification(result)
            else -> {}
        }
    }

    private fun showSafeNotification() {
        val pendingIntent = createPendingIntent(0)
        val notification = NotificationCompat.Builder(context, INFO_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // Using system icon for now
            .setContentTitle("No Significant Risk Detected")
            .setContentText("GuardFlow analyzed this session and found no suspicious activity. You may continue safely.")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun showMediumRiskNotification(result: RiskResult) {
        val pendingIntent = createPendingIntent(1)
        val bulletPoints = result.triggeredRules.joinToString("\n") { "• $it" }
        val bigText = "${result.explanation ?: "Activity flagged for review."}\n\nObservations:\n$bulletPoints"

        val notification = NotificationCompat.Builder(context, INFO_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("GuardFlow Flagged This Activity")
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun showHighRiskNotification(result: RiskResult) {
        val pendingIntent = createPendingIntent(2)
        val notification = NotificationCompat.Builder(context, URGENT_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Potential Scam Detected – Immediate Action Required")
            .setContentText("GuardFlow has detected multiple high-risk fraud indicators. Review this activity before proceeding.")
            .setPriority(NotificationCompat.PRIORITY_MAX) // Use MAX instead of HIGH
            .setCategory(NotificationCompat.CATEGORY_ALARM) // Categorize as Alarm for visibility
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setFullScreenIntent(pendingIntent, true)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOngoing(true) // Make it harder to dismiss
            .build()

        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun createPendingIntent(requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or 
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or 
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("EXTRA_ALARM", true)
        }
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }
}
