package com.guardflow.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.guardflow.model.GuardFlowEvent
import kotlinx.coroutines.flow.Flow

@Dao
interface GuardFlowDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEvent(event: GuardFlowEvent)

    @Query("SELECT * FROM events ORDER BY timestamp DESC")
    fun getAllEvents(): Flow<List<GuardFlowEvent>>

    @Query("SELECT * FROM events WHERE sessionId = :sessionId ORDER BY timestamp DESC")
    fun getEventsBySession(sessionId: String): Flow<List<GuardFlowEvent>>
}
