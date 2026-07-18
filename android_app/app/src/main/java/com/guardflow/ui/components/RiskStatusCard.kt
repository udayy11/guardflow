package com.guardflow.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.Report
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.guardflow.model.RiskLevel
import com.guardflow.model.RiskResult
import com.guardflow.ui.theme.RiskHigh
import com.guardflow.ui.theme.RiskHighBg
import com.guardflow.ui.theme.RiskMedium
import com.guardflow.ui.theme.RiskMediumBg
import com.guardflow.ui.theme.RiskSafe
import com.guardflow.ui.theme.RiskSafeBg

@Composable
fun RiskStatusCard(result: RiskResult, modifier: Modifier = Modifier) {
    val (bgColor, contentColor, icon, headline) = when (result.level) {
        RiskLevel.LOW -> Quadruple(RiskSafeBg, RiskSafe, Icons.Default.CheckCircle, "Looks safe")
        RiskLevel.MEDIUM -> Quadruple(RiskMediumBg, RiskMedium, Icons.Default.Warning, "Proceed with caution")
        RiskLevel.HIGH -> Quadruple(RiskHighBg, RiskHigh, Icons.Default.Report, "This looks like a scam")
        RiskLevel.CRITICAL -> Quadruple(RiskHighBg, RiskHigh, Icons.Default.Report, "Critical risk detected")
        RiskLevel.UNKNOWN -> Quadruple(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, Icons.Default.Help, "Risk level unknown")
    }

    var progressTarget by remember { mutableFloatStateOf(0f) }
    val animatedProgress by animateFloatAsState(targetValue = progressTarget, label = "RiskProgress")

    LaunchedEffect(result.score) {
        progressTarget = result.score / 100f
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = bgColor)
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = contentColor,
                    modifier = Modifier.size(32.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = headline,
                    style = MaterialTheme.typography.titleLarge,
                    color = contentColor,
                    fontWeight = FontWeight.Bold
                )
            }

            Text(
                text = "${result.score}/100",
                style = MaterialTheme.typography.headlineMedium,
                color = contentColor,
                modifier = Modifier.padding(vertical = 8.dp)
            )

            LinearProgressIndicator(
                progress = { animatedProgress },
                modifier = Modifier.fillMaxWidth(),
                color = contentColor,
                trackColor = contentColor.copy(alpha = 0.2f)
            )

            result.explanation?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(top = 16.dp),
                    color = MaterialTheme.colorScheme.onSurface
                )
            }

            if (result.triggeredRules.isNotEmpty()) {
                Text(
                    text = "Observations:",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
                    color = contentColor
                )
                result.triggeredRules.forEach { rule ->
                    Text(
                        text = "• $rule",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
            }
        }
    }
}

private data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)
