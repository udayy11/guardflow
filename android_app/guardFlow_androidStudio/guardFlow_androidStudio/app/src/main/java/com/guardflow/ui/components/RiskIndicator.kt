package com.guardflow.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.guardflow.model.RiskLevel

@Composable
fun RiskIndicator(level: RiskLevel, modifier: Modifier = Modifier) {
    val color = when (level) {
        RiskLevel.LOW -> Color(0xFF4CAF50) // Green
        RiskLevel.MEDIUM -> Color(0xFFFFC107) // Amber
        RiskLevel.HIGH -> Color(0xFFF44336) // Red
        RiskLevel.CRITICAL -> Color(0xFFB71C1C) // Dark red
        RiskLevel.UNKNOWN -> MaterialTheme.colorScheme.outline
    }
    Box(
        modifier = modifier
            .size(12.dp)
            .clip(CircleShape)
            .background(color)
    )
}
