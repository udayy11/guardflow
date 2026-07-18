package com.guardflow.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import org.json.JSONObject

enum class RiskLevel {
    LOW, MEDIUM, HIGH, CRITICAL, UNKNOWN
}

@JsonClass(generateAdapter = true)
data class RiskResult(
    @Json(name = "session_id") val sessionId: String = "",
    val score: Int,
    val level: RiskLevel,
    @Json(name = "triggered_rules") val triggeredRules: List<String> = emptyList(),
    @Json(name = "requires_physical_confirmation") val requiresPhysicalConfirmation: Boolean = false,
    val explanation: String? = null
) {
    companion object {
        fun fromWireJson(sessionId: String, json: JSONObject): RiskResult {
            val score = json.getInt("score")
            val level = try {
                RiskLevel.valueOf(json.getString("level").uppercase())
            } catch (e: Exception) {
                RiskLevel.UNKNOWN
            }

            val triggeredRulesArray = json.optJSONArray("triggered_rules")
            val triggeredRules = mutableListOf<String>()
            if (triggeredRulesArray != null) {
                for (i in 0 until triggeredRulesArray.length()) {
                    triggeredRules.add(triggeredRulesArray.getString(i))
                }
            }

            val requiresPhysicalConfirmation = json.optBoolean("requires_physical_confirmation", false)
            val explanation = json.optString("explanation", null)

            return RiskResult(
                sessionId = sessionId,
                score = score,
                level = level,
                triggeredRules = triggeredRules,
                requiresPhysicalConfirmation = requiresPhysicalConfirmation,
                explanation = explanation
            )
        }
    }
}
