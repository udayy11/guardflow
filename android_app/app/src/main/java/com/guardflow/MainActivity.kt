package com.guardflow

import android.app.KeyguardManager
import android.content.Context
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import com.guardflow.notification.SecurityNotificationManager
import android.Manifest
import android.os.Build
import androidx.lifecycle.ViewModelProvider
import com.guardflow.navigation.GuardFlowNavHost
import com.guardflow.network.ApiConfig
import com.guardflow.network.GuardFlowApiClient
import com.guardflow.observer.GuardFlowObserverService
import com.guardflow.ui.theme.GuardFlowTheme
import com.guardflow.viewmodel.GuardFlowViewModel
import com.guardflow.viewmodel.GuardFlowViewModelFactory
import com.guardflow.data.DataProvider
import com.guardflow.data.SessionManager
import kotlinx.coroutines.runBlocking
import java.util.UUID

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }

        val notificationManager = SecurityNotificationManager(this)
        notificationManager.createNotificationChannels()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                101
            )
        }

        val repository = DataProvider.provideRepository(this)
        val apiClient = DataProvider.provideApiClient()
        
        // Shared session management
        val sessionManager = SessionManager(this)
        
        val viewModel = ViewModelProvider(
            this,
            GuardFlowViewModelFactory(
                api = apiClient,
                repository = repository,
                sessionManager = sessionManager
            )
        )[GuardFlowViewModel::class.java]

        val isAccessibilityPermissionGranted = isAccessibilityServiceEnabled()

        setContent {
            GuardFlowTheme {
                GuardFlowNavHost(
                    viewModel = viewModel,
                    isAccessibilityPermissionGranted = isAccessibilityPermissionGranted
                )
            }
        }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val expectedService = "$packageName/${GuardFlowObserverService::class.java.canonicalName}"
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""
        return enabledServices.split(':').any { it.equals(expectedService, ignoreCase = true) }
    }
}
