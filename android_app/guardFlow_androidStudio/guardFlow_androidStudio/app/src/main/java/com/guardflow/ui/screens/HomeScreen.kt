package com.guardflow.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.guardflow.state.RiskUiState
import com.guardflow.ui.components.RiskStatusCard
import com.guardflow.ui.theme.RiskSafe

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    uiState: RiskUiState,
    onCheckNow: () -> Unit,
    onOpenHistory: () -> Unit,
    onConfirmPhysically: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("GuardFlow") },
                navigationIcon = {
                    Icon(
                        imageVector = Icons.Default.Shield,
                        contentDescription = null,
                        modifier = Modifier.padding(start = 16.dp, end = 8.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                },
                actions = {
                    IconButton(onClick = onOpenHistory) {
                        Icon(Icons.Default.History, contentDescription = "History")
                    }
                }
            )
        },
        bottomBar = {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Button(
                    onClick = onCheckNow,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    enabled = uiState !is RiskUiState.Loading
                ) {
                    Text("Check current session now")
                }
            }
        },
        modifier = modifier
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Real-time security monitoring for your digital assets.",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            when (uiState) {
                is RiskUiState.Idle -> {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier.padding(vertical = 48.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Security,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.outline
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "Tap the button below to start a risk assessment of your current session.",
                            textAlign = TextAlign.Center,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }

                is RiskUiState.Loading -> {
                    CircularProgressIndicator(modifier = Modifier.padding(vertical = 48.dp))
                }

                is RiskUiState.Scored -> {
                    RiskStatusCard(result = uiState.result)
                }

                is RiskUiState.AwaitingPhysicalConfirmation -> {
                    Column {
                        RiskStatusCard(result = uiState.result)
                        Spacer(modifier = Modifier.height(24.dp))
                        PhysicalConfirmationPrompt(
                            secondsRemaining = uiState.secondsRemaining,
                            onConfirmPressed = onConfirmPhysically
                        )
                    }
                }

                is RiskUiState.Confirmed -> {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(vertical = 48.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.VerifiedUser,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = RiskSafe
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "Physical verification successful. Session is now fully protected.",
                            textAlign = TextAlign.Center,
                            style = MaterialTheme.typography.titleMedium,
                            color = RiskSafe
                        )
                    }
                }

                is RiskUiState.Error -> {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(vertical = 48.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = uiState.message,
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        TextButton(onClick = onCheckNow) {
                            Text("Retry Assessment")
                        }
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(80.dp)) // Padding for bottom bar
        }
    }
}
