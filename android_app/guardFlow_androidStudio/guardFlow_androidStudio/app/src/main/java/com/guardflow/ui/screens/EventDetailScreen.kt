package com.guardflow.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.guardflow.model.EventType
import com.guardflow.model.GuardFlowEvent
import com.guardflow.model.RiskLevel
import com.guardflow.ui.components.RiskScoreCard

@Composable
fun EventDetailScreen(
    event: GuardFlowEvent?,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        if (event == null) {
            Text("Select an event to see detailed risk assessment", style = MaterialTheme.typography.bodyLarge)
        } else {
            val riskLevel = determineRiskLevel(event)
            val score = determineRiskScore(event)

            Text(
                text = "Event Analysis",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(bottom = 16.dp)
            )

            RiskScoreCard(score = score, level = riskLevel)

            Text(
                text = "Event Metadata",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(top = 24.dp, bottom = 8.dp)
            )
            
            DetailItem("Type", event.eventType.name)
            DetailItem("Event ID", event.eventId)
            DetailItem("Session ID", event.sessionId)
            DetailItem("Timestamp", event.timestamp.toString())
            DetailItem("Source App", event.sourceApp ?: "N/A")
            
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

            Text(
                text = "Payload Data",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            if (event.metadata.isEmpty()) {
                Text("No additional metadata available", style = MaterialTheme.typography.bodySmall)
            } else {
                event.metadata.forEach { (key, value) ->
                    Text("$key: $value", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun DetailItem(label: String, value: String) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(text = label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        Text(text = value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun determineRiskLevel(event: GuardFlowEvent): RiskLevel {
    return when (event.eventType) {
        EventType.PAYMENT_INITIATED, EventType.SCREEN_SHARE_STARTED -> RiskLevel.HIGH
        EventType.SMS_RECEIVED, EventType.LINK_CLICKED -> RiskLevel.MEDIUM
        else -> RiskLevel.LOW
    }
}

private fun determineRiskScore(event: GuardFlowEvent): Int {
    return when (event.eventType) {
        EventType.PAYMENT_INITIATED -> 85
        EventType.SCREEN_SHARE_STARTED -> 92
        EventType.SMS_RECEIVED -> 45
        EventType.LINK_CLICKED -> 60
        EventType.PAYMENT_APP_OPENED -> 30
        else -> 5
    }
}
