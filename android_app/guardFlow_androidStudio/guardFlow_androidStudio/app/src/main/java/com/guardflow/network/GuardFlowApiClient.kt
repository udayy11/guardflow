package com.guardflow.network

import com.guardflow.model.GuardFlowEvent
import com.guardflow.model.RiskResult
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Path

interface GuardFlowApiClient {
    
    @POST("events")
    suspend fun sendEvent(@Body event: GuardFlowEvent): Response<Unit>

    @POST("score/{sessionId}")
    suspend fun fetchRiskScore(@Path("sessionId") sessionId: String): RiskResult
}
