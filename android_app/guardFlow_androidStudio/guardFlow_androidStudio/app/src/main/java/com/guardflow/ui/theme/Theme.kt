package com.guardflow.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColorScheme = lightColorScheme(
    primary = GuardBlue,
    onPrimary = Cloud,
    primaryContainer = Cloud,
    onPrimaryContainer = Ink,
    secondary = Slate,
    onSecondary = Cloud,
    tertiary = RiskSafe,
    background = Cloud,
    surface = Cloud,
    onBackground = Ink,
    onSurface = Ink,
)

private val DarkColorScheme = darkColorScheme(
    primary = GuardBlueDark,
    onPrimary = CloudDark,
    primaryContainer = CloudDark,
    onPrimaryContainer = InkDark,
    secondary = SlateDark,
    onSecondary = CloudDark,
    tertiary = RiskSafeDark,
    background = CloudDark,
    surface = CloudDark,
    onBackground = InkDark,
    onSurface = InkDark,
)

@Composable
fun GuardFlowTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = GuardFlowTypography,
        content = content
    )
}
