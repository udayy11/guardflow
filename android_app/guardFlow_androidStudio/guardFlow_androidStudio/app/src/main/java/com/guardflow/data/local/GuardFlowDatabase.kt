package com.guardflow.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.guardflow.model.GuardFlowEvent

@Database(entities = [GuardFlowEvent::class], version = 1, exportSchema = false)
@TypeConverters(Converters::class)
abstract class GuardFlowDatabase : RoomDatabase() {
    abstract fun guardFlowDao(): GuardFlowDao

    companion object {
        const val DATABASE_NAME = "guard_flow_db"
    }
}
