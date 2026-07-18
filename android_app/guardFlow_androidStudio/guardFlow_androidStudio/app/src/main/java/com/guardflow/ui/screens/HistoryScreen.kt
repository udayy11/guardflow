package com.guardflow.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.guardflow.model.EventType
import com.guardflow.model.GuardFlowEvent
import com.guardflow.model.RiskLevel
import com.guardflow.state.HistoryEntry
import com.guardflow.ui.components.RiskIndicator
import com.guardflow.ui.theme.RiskHigh
import com.guardflow.ui.theme.RiskMedium
import com.guardflow.ui.theme.RiskSafe
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    riskEntries: List<HistoryEntry>,
    activityEvents: List<GuardFlowEvent>,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Risk Checks", "Observer Activity")

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("Security History") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                )
                TabRow(selectedTabIndex = selectedTab) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(title) }
                        )
                    }
                }
            }
        },
        modifier = modifier
    ) { innerPadding ->
        Column(modifier = Modifier.padding(innerPadding).fillMaxSize()) {
            when (selectedTab) {
                0 -> RiskHistoryList(riskEntries)
                1 -> ActivityLogList(activityEvents)
            }
        }
    }
}

@Composable
private fun RiskHistoryList(entries: List<HistoryEntry>) {
    if (entries.isEmpty()) {
        EmptyState("No risk checks performed yet.")
    } else {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(entries) { entry ->
                HistoryItem(entry = entry)
                HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}

@Composable
private fun ActivityLogList(events: List<GuardFlowEvent>) {
    if (events.isEmpty()) {
        EmptyState("No background activity recorded yet. Ensure Accessibility Service is ON.")
    } else {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(events) { event ->
                ActivityItem(event = event)
                HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}

@Composable
private fun EmptyState(message: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text = message, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun HistoryItem(entry: HistoryEntry) {
    val riskColor = when (entry.level) {
        RiskLevel.LOW -> RiskSafe
        RiskLevel.MEDIUM -> RiskMedium
        RiskLevel.HIGH -> RiskHigh
        RiskLevel.CRITICAL -> RiskHigh
        RiskLevel.UNKNOWN -> MaterialTheme.colorScheme.outline
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(riskColor)
        )
        
        Spacer(modifier = Modifier.width(16.dp))
        
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.timestampLabel,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = entry.summary,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium
            )
        }
        
        Text(
            text = "${entry.score}",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = riskColor
        )
    }
}

@Composable
private fun ActivityItem(event: GuardFlowEvent) {
    val risk = when (event.eventType) {
        EventType.PAYMENT_INITIATED, EventType.SCREEN_SHARE_STARTED -> RiskLevel.HIGH
        EventType.SMS_RECEIVED, EventType.LINK_CLICKED -> RiskLevel.MEDIUM
        else -> RiskLevel.LOW
    }

    val url = event.metadata["url"]?.toString()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RiskIndicator(risk)
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            val istTime = event.timestamp.atZone(ZoneId.of("Asia/Kolkata"))
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
            
            Text(
                text = istTime,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = event.eventType.name.replace("_", " "),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold
            )
            
            event.sourceApp?.let {
                Text(
                    text = "App: $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            if (url != null) {
                Text(
                    text = "Link: $url",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(top = 2.dp)
                )
            } else if (event.metadata.isNotEmpty()) {
                // If it's not a LINK_CLICKED event, it might still have metadata like package_name
                event.metadata.forEach { (key, value) ->
                    if (key != "package_name") { // Don't repeat app name
                        Text(
                            text = "$key: $value",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline
                        )
                    }
                }
            }
        }
    }
}
