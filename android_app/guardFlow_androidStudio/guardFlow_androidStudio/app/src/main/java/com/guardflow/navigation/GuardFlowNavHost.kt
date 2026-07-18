package com.guardflow.navigation

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import com.guardflow.notification.SecurityNotificationManager
import com.guardflow.ui.screens.HistoryScreen
import com.guardflow.ui.screens.HomeScreen
import com.guardflow.ui.screens.PermissionOnboardingScreen
import com.guardflow.viewmodel.GuardFlowViewModel

@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun GuardFlowNavHost(
    viewModel: GuardFlowViewModel,
    isAccessibilityPermissionGranted: Boolean,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val notificationManager = remember { SecurityNotificationManager(context) }

    val uiState by viewModel.uiState.collectAsState()
    val history by viewModel.history.collectAsState()
    val activityLog by viewModel.activityLog.collectAsState()

    val startRoute = if (isAccessibilityPermissionGranted) NavRoute.Home else NavRoute.Permissions
    val backStack = rememberNavBackStack(startRoute)
    val windowAdaptiveInfo = currentWindowAdaptiveInfo()
    val listDetailStrategy = rememberListDetailSceneStrategy<NavKey>(
        directive = calculatePaneScaffoldDirective(windowAdaptiveInfo)
    )

    NavDisplay(
        backStack = backStack,
        onBack = { if (backStack.size > 1) backStack.removeAt(backStack.size - 1) },
        sceneStrategy = listDetailStrategy,
        modifier = modifier.fillMaxSize()
    ) { route ->
        when (route) {
            is NavRoute.Permissions -> {
                NavEntry(
                    key = route,
                    content = {
                        PermissionOnboardingScreen(
                            isPermissionGranted = isAccessibilityPermissionGranted,
                            onContinue = {
                                backStack.clear()
                                backStack.add(NavRoute.Home)
                            }
                        )
                    }
                )
            }
            is NavRoute.Home -> {
                NavEntry(
                    key = route,
                    metadata = ListDetailSceneStrategy.listPane(),
                    content = {
                        HomeScreen(
                            uiState = uiState,
                            onCheckNow = { viewModel.checkCurrentSession(notificationManager) },
                            onOpenHistory = { backStack.add(NavRoute.History) },
                            onConfirmPhysically = { viewModel.onPhysicalConfirmationReceived() }
                        )
                    }
                )
            }
            is NavRoute.History -> {
                NavEntry(
                    key = route,
                    metadata = ListDetailSceneStrategy.detailPane(),
                    content = {
                        HistoryScreen(
                            riskEntries = history,
                            activityEvents = activityLog,
                            onBack = { backStack.removeAt(backStack.size - 1) }
                        )
                    }
                )
            }
            else -> {
                NavEntry(key = route, content = { Text("Unknown Route") })
            }
        }
    }
}
