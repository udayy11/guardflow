package com.guardflow.data.repository

import com.guardflow.model.GuardFlowEvent
import kotlinx.coroutines.flow.Flow

interface GuardFlowRepository {
    fun getAllEvents(): Flow<List<GuardFlowEvent>>
    fun getEventsBySession(sessionId: String): Flow<List<GuardFlowEvent>>
    suspend fun recordEvent(event: GuardFlowEvent)
}
