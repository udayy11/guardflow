package com.guardflow.data.repository
import android.util.Log
import com.guardflow.data.local.GuardFlowDao
import com.guardflow.model.GuardFlowEvent
import com.guardflow.network.GuardFlowApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
class GuardFlowRepositoryImpl(
    private val guardFlowDao: GuardFlowDao,
    private val apiClient: GuardFlowApiClient
) : GuardFlowRepository {
    override fun getAllEvents(): Flow<List<GuardFlowEvent>> {
        return guardFlowDao.getAllEvents()
    }

    override fun getEventsBySession(sessionId: String): Flow<List<GuardFlowEvent>> {
        return guardFlowDao.getEventsBySession(sessionId)
    }

    override suspend fun recordEvent(event: GuardFlowEvent) {
        // Room insert is the source of truth and always happens first.
        try {
            guardFlowDao.insertEvent(event)
            Log.d("GuardFlowSync", "Event saved to local database: ${event.eventType}")
        } catch (e: Exception) {
            Log.e("GuardFlowSync", "Failed to save event to Room", e)
        }

        // Best-effort sync to the backend. If this fails (network down, backend
        // unreachable, etc.) the event is NOT lost - it's already committed to
        // Room above. We deliberately swallow the failure here rather than
        // propagate it, since losing network connectivity should never crash
        // the caller (the accessibility service) or roll back the local insert.
        try {
            withContext(Dispatchers.IO) {
                Log.d("GuardFlowSync", "About to send event: $event")
                apiClient.sendEvent(event)
                Log.d("GuardFlowSync", "Event sent successfully")
            }
        } catch (e: Exception) {
            Log.e("GuardFlowSync", "Failed to send event", e)
            // Network sync failed; the event remains safely stored in Room.
        }
    }
}
