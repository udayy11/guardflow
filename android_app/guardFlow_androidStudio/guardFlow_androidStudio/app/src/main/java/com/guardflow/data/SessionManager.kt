package com.guardflow.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

private val Context.dataStore by preferencesDataStore(name = "session_prefs")

class SessionManager(private val context: Context) {
    private val SESSION_ID_KEY = stringPreferencesKey("session_id")

    val sessionId: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SESSION_ID_KEY] ?: ""
    }

    suspend fun getOrCreateSessionId(): String {
        val current = sessionId.first()
        return if (current.isNotEmpty()) {
            current
        } else {
            val newId = UUID.randomUUID().toString()
            context.dataStore.edit { prefs ->
                prefs[SESSION_ID_KEY] = newId
            }
            newId
        }
    }
}
