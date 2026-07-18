package com.guardflow.data.local

import androidx.room.TypeConverter
import com.guardflow.model.EventType
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.time.Instant

class Converters {
    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()
    
    private val mapType = Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(mapType)

    @TypeConverter
    fun fromTimestamp(value: Long?): Instant? {
        return value?.let { Instant.ofEpochMilli(it) }
    }

    @TypeConverter
    fun dateToTimestamp(date: Instant?): Long? {
        return date?.toEpochMilli()
    }

    @TypeConverter
    fun fromEventType(value: String?): EventType? {
        return value?.let { EventType.valueOf(it) }
    }

    @TypeConverter
    fun eventTypeToString(eventType: EventType?): String? {
        return eventType?.name
    }

    @TypeConverter
    fun fromMetadata(value: String?): Map<String, Any?>? {
        return value?.let { mapAdapter.fromJson(it) }
    }

    @TypeConverter
    fun metadataToString(metadata: Map<String, Any?>?): String? {
        return metadata?.let { mapAdapter.toJson(it) }
    }
}
