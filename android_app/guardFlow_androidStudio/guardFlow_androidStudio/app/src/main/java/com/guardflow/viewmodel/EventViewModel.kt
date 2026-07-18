package com.guardflow.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.guardflow.data.repository.GuardFlowRepository
import com.guardflow.model.EventType
import com.guardflow.model.GuardFlowEvent
import com.guardflow.model.RiskLevel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class EventViewModel(private val repository: GuardFlowRepository) : ViewModel() {

    private val _selectedEventType = MutableStateFlow<EventType?>(null)
    val selectedEventType: StateFlow<EventType?> = _selectedEventType

    private val _selectedRiskLevel = MutableStateFlow<RiskLevel?>(null)
    val selectedRiskLevel: StateFlow<RiskLevel?> = _selectedRiskLevel

    val events: StateFlow<List<GuardFlowEvent>> = combine(
        repository.getAllEvents(),
        _selectedEventType,
        _selectedRiskLevel
    ) { events, type, level ->
        events.filter { event ->
            (type == null || event.eventType == type) &&
            (level == null || determineRiskLevel(event) == level)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun setEventTypeFilter(type: EventType?) {
        _selectedEventType.value = type
    }

    fun setRiskLevelFilter(level: RiskLevel?) {
        _selectedRiskLevel.value = level
    }

    // Mock logic to determine risk level for filtering demo
    // In a real app, this would come from the RiskResult associated with the event/session
    fun determineRiskLevel(event: GuardFlowEvent): RiskLevel {
        return when (event.eventType) {
            EventType.PAYMENT_INITIATED, EventType.SCREEN_SHARE_STARTED -> RiskLevel.HIGH
            EventType.SMS_RECEIVED, EventType.LINK_CLICKED -> RiskLevel.MEDIUM
            else -> RiskLevel.LOW
        }
    }

    fun addMockEvent(type: EventType) {
        viewModelScope.launch {
            repository.recordEvent(
                GuardFlowEvent(
                    sessionId = "mock-session",
                    eventType = type,
                    sourceApp = "GuardFlow"
                )
            )
        }
    }
}
