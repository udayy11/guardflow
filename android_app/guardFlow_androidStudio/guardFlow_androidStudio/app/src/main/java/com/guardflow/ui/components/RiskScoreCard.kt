package com.guardflow.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.guardflow.model.RiskLevel

@Composable
fun RiskScoreCard(
    score: Int,
    level: RiskLevel,
    modifier: Modifier = Modifier
) {
    val color = when (level) {
        RiskLevel.LOW -> Color(0xFF4CAF50)
        RiskLevel.MEDIUM -> Color(0xFFFFC107)
        RiskLevel.HIGH -> Color(0xFFF44336)
        RiskLevel.CRITICAL -> Color(0xFFB71C1C)
        RiskLevel.UNKNOWN -> MaterialTheme.colorScheme.outline
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = color.copy(alpha = 0.1f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Risk Score",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = "$score/100",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = color
                )
            }
            
            Text(
                text = "Level: ${level.name}",
                style = MaterialTheme.typography.bodyMedium,
                color = color,
                modifier = Modifier.padding(vertical = 4.dp)
            )

            LinearProgressIndicator(
                progress = { score / 100f },
                modifier = Modifier.fillMaxWidth(),
                color = color,
                trackColor = color.copy(alpha = 0.2f)
            )
        }
    }
}
