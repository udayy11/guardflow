package com.guardflow.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.guardflow.data.SessionManager
import com.guardflow.data.repository.GuardFlowRepository
import com.guardflow.model.GuardFlowEvent
import com.guardflow.model.RiskResult
import com.guardflow.network.GuardFlowApiClient
import com.guardflow.notification.SecurityNotificationManager
import com.guardflow.state.HistoryEntry
import com.guardflow.state.RiskUiState
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

class GuardFlowViewModel(
    private val api: GuardFlowApiClient,
    private val repository: GuardFlowRepository,
    private val sessionManager: SessionManager,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {

    private val _uiState = MutableStateFlow<RiskUiState>(RiskUiState.Idle)
    val uiState: StateFlow<RiskUiState> = _uiState.asStateFlow()

    private val _history = MutableStateFlow<List<HistoryEntry>>(emptyList())
    val history: StateFlow<List<HistoryEntry>> = _history.asStateFlow()

    val activityLog: StateFlow<List<GuardFlowEvent>> = repository.getAllEvents()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    fun checkCurrentSession(notificationManager: SecurityNotificationManager? = null) {
        _uiState.value = RiskUiState.Loading

        viewModelScope.launch(ioDispatcher) {
            try {
                val sessionId = sessionManager.getOrCreateSessionId()
                val result = api.fetchRiskScore(sessionId)
                
                // Trigger notification
                notificationManager?.showNotificationForResult(result)

                val timestampLabel = LocalDateTime.now().format(
                    DateTimeFormatter.ofPattern("MMM d, h:mm a")
                )
                
                val newEntry = HistoryEntry(
                    sessionId = sessionId,
                    timestampLabel = timestampLabel,
                    score = result.score,
                    level = result.level,
                    summary = "Risk level: ${result.level} with ${result.triggeredRules.size} triggered rules"
                )
                
                withContext(Dispatchers.Main) {
                    _history.value = listOf(newEntry) + _history.value

                    if (result.requiresPhysicalConfirmation) {
                        _uiState.value = RiskUiState.AwaitingPhysicalConfirmation(result, 30)
                    } else {
                        _uiState.value = RiskUiState.Scored(result)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("GuardFlowVM", "Risk check failed", e)
                withContext(Dispatchers.Main) {
                    _uiState.value = RiskUiState.Error("Failed to fetch or parse risk assessment. Please try again.")
                }
            }
        }
    }

    fun onPhysicalConfirmationReceived() {
        _uiState.value = RiskUiState.Confirmed
    }

    fun onPhysicalConfirmationTimedOut() {
        if (_uiState.value is RiskUiState.AwaitingPhysicalConfirmation) {
            _uiState.value = RiskUiState.Error("Risk assessment timed out. The session was blocked for safety.")
        }
    }

    fun reset() {
        _uiState.value = RiskUiState.Idle
    }
}
