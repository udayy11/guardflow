package com.guardflow.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.systemBars
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.guardflow.model.EventType
import com.guardflow.model.GuardFlowEvent
import com.guardflow.model.RiskLevel
import com.guardflow.ui.components.RiskIndicator
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventListScreen(
    events: List<GuardFlowEvent>,
    selectedType: EventType?,
    onTypeSelected: (EventType?) -> Unit,
    selectedRisk: RiskLevel?,
    onRiskSelected: (RiskLevel?) -> Unit,
    onEventClick: (GuardFlowEvent) -> Unit,
    onAddMockClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("GuardFlow Live Stream") },
                actions = {
                    Icon(Icons.Default.FilterList, contentDescription = "Filter")
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAddMockClick) {
                Icon(Icons.Default.Add, contentDescription = "Add Mock Event")
            }
        },
        modifier = modifier,
        contentWindowInsets = WindowInsets.systemBars
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
                .fillMaxSize()
        ) {
            // Filters
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(vertical = 8.dp)
            ) {
                item {
                    FilterChip(
                        selected = selectedType == null,
                        onClick = { onTypeSelected(null) },
                        label = { Text("All Types") }
                    )
                }
                items(EventType.entries) { type ->
                    FilterChip(
                        selected = selectedType == type,
                        onClick = { onTypeSelected(type) },
                        label = { Text(type.name.replace("_", " ")) }
                    )
                }
            }

            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(bottom = 8.dp)
            ) {
                item {
                    FilterChip(
                        selected = selectedRisk == null,
                        onClick = { onRiskSelected(null) },
                        label = { Text("All Severity") }
                    )
                }
                items(RiskLevel.entries.filter { it != RiskLevel.UNKNOWN }) { level ->
                    FilterChip(
                        selected = selectedRisk == level,
                        onClick = { onRiskSelected(level) },
                        label = { Text(level.name) }
                    )
                }
            }

            HorizontalDivider()

            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(events) { event ->
                    val risk = determineRiskLevel(event)
                    ListItem(
                        headlineContent = { Text(event.eventType.name.replace("_", " ")) },
                        supportingContent = { 
                            Column {
                                Text("ID: ${event.eventId.take(8)}...")
                                Text("Source: ${event.sourceApp ?: "System"}", style = MaterialTheme.typography.labelSmall)
                            }
                        },
                        leadingContent = { RiskIndicator(risk) },
                        trailingContent = { 
                            Text(
                                text = DateTimeFormatter.ISO_INSTANT.format(event.timestamp).take(19).replace("T", " "),
                                style = MaterialTheme.typography.bodySmall
                            )
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onEventClick(event) }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

// Reuse logic from ViewModel for UI consistency in this task
private fun determineRiskLevel(event: GuardFlowEvent): RiskLevel {
    return when (event.eventType) {
        EventType.PAYMENT_INITIATED, EventType.SCREEN_SHARE_STARTED -> RiskLevel.HIGH
        EventType.SMS_RECEIVED, EventType.LINK_CLICKED -> RiskLevel.MEDIUM
        else -> RiskLevel.LOW
    }
}
