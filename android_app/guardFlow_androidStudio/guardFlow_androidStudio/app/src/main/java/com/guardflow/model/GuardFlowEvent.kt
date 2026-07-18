package com.guardflow.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

@Entity(tableName = "events")
@JsonClass(generateAdapter = true)
data class GuardFlowEvent(
    @PrimaryKey 
    @Json(name = "event_id") val eventId: String = UUID.randomUUID().toString(),
    @Json(name = "session_id") val sessionId: String,
    @Json(name = "event_type") val eventType: EventType,
    val timestamp: Instant = Instant.now(),
    @Json(name = "source_app") val sourceApp: String? = null,
    @Json(name = "payload") val metadata: Map<String, Any?> = emptyMap()
) {
    fun toWireJson(): Map<String, Any?> {
        return mapOf(
            "event_id" to eventId,
            "session_id" to sessionId,
            "event_type" to eventType.wireValue(),
            "timestamp" to DateTimeFormatter.ISO_INSTANT.format(timestamp),
            "source_app" to sourceApp,
            "payload" to metadata
        )
    }
}
