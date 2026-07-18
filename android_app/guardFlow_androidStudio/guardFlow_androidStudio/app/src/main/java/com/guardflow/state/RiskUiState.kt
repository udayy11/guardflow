package com.guardflow.state

import com.guardflow.model.RiskLevel
import com.guardflow.model.RiskResult

sealed interface RiskUiState {
    data object Idle : RiskUiState
    data object Loading : RiskUiState
    data class Scored(val result: RiskResult) : RiskUiState
    data class AwaitingPhysicalConfirmation(
        val result: RiskResult,
        val secondsRemaining: Int
    ) : RiskUiState
    data object Confirmed : RiskUiState
    data class Error(val message: String) : RiskUiState
}

data class HistoryEntry(
    val sessionId: String,
    val timestampLabel: String,
    val score: Int,
    val level: RiskLevel,
    val summary: String
)
