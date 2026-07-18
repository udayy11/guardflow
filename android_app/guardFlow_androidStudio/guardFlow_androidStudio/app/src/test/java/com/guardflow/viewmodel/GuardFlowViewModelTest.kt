package com.guardflow.viewmodel

import com.guardflow.model.RiskLevel
import com.guardflow.model.RiskResult
import com.guardflow.network.GuardFlowApiClient
import com.guardflow.state.RiskUiState
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GuardFlowViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val api: GuardFlowApiClient = mockk()
    private val repository: com.guardflow.data.repository.GuardFlowRepository = mockk(relaxed = true)
    private lateinit var viewModel: GuardFlowViewModel

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = GuardFlowViewModel(api, repository, testDispatcher) { "test-session" }
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `checkCurrentSession transitions to Loading then Scored on success`() = runTest {
        // Given
        val mockResult = RiskResult(
            sessionId = "test-session",
            score = 10,
            level = RiskLevel.LOW,
            triggeredRules = emptyList(),
            requiresPhysicalConfirmation = false,
            explanation = "All good"
        )
        every { api.fetchRiskScore("test-session") } returns mockResult

        // When
        viewModel.checkCurrentSession(null)
        
        // Then
        assertEquals(RiskUiState.Loading, viewModel.uiState.value)
        
        advanceUntilIdle()
        
        val state = viewModel.uiState.value
        assertTrue(state is RiskUiState.Scored)
        assertEquals(10, (state as RiskUiState.Scored).result.score)
        assertEquals(RiskLevel.LOW, state.result.level)
    }

    @Test
    fun `checkCurrentSession transitions to Loading then AwaitingPhysicalConfirmation when required`() = runTest {
        // Given
        val mockResult = RiskResult(
            sessionId = "test-session",
            score = 75,
            level = RiskLevel.HIGH,
            triggeredRules = emptyList(),
            requiresPhysicalConfirmation = true,
            explanation = "Suspicious activity"
        )
        every { api.fetchRiskScore("test-session") } returns mockResult

        // When
        viewModel.checkCurrentSession(null)
        
        // Then
        assertEquals(RiskUiState.Loading, viewModel.uiState.value)
        
        advanceUntilIdle()
        
        val state = viewModel.uiState.value
        assertTrue(state is RiskUiState.AwaitingPhysicalConfirmation)
        assertEquals(75, (state as RiskUiState.AwaitingPhysicalConfirmation).result.score)
        assertEquals(30, state.secondsRemaining)
    }

    @Test
    fun `checkCurrentSession transitions to Error on network failure`() = runTest {
        // Given
        every { api.fetchRiskScore("test-session") } throws Exception("Network Error")

        // When
        viewModel.checkCurrentSession(null)
        
        advanceUntilIdle()
        
        // Then
        val state = viewModel.uiState.value
        assertTrue(state is RiskUiState.Error)
        assertEquals("Failed to fetch or parse risk assessment. Please try again.", (state as RiskUiState.Error).message)
    }

    @Test
    fun `history is updated after a successful call`() = runTest {
        // Given
        val mockResult = RiskResult(
            sessionId = "test-session",
            score = 10,
            level = RiskLevel.LOW,
            triggeredRules = emptyList(),
            requiresPhysicalConfirmation = false,
            explanation = "All good"
        )
        every { api.fetchRiskScore("test-session") } returns mockResult

        // When
        viewModel.checkCurrentSession(null)
        advanceUntilIdle()
        
        // Then
        val history = viewModel.history.value
        assertEquals(1, history.size)
        assertEquals("test-session", history[0].sessionId)
        assertEquals(10, history[0].score)
        assertEquals(RiskLevel.LOW, history[0].level)
    }

    @Test
    fun `onPhysicalConfirmationReceived updates state to Confirmed`() = runTest {
        // When
        viewModel.onPhysicalConfirmationReceived()
        
        // Then
        assertEquals(RiskUiState.Confirmed, viewModel.uiState.value)
    }

    @Test
    fun `onPhysicalConfirmationTimedOut updates state to Error if in AwaitingPhysicalConfirmation`() = runTest {
        // Given
        val mockResponse = """
            {
                "session_id": "test-session",
                "score": 80,
                "level": "HIGH",
                "triggered_rules": [],
                "requires_physical_confirmation": true,
                "explanation": "Suspicious"
            }
        """.trimIndent()
        every { api.fetchRiskScore("test-session") } returns mockResponse
        
        viewModel.checkCurrentSession(null)
        advanceUntilIdle()
        
        assertTrue(viewModel.uiState.value is RiskUiState.AwaitingPhysicalConfirmation)

        // When
        viewModel.onPhysicalConfirmationTimedOut()
        
        // Then
        val state = viewModel.uiState.value
        assertTrue(state is RiskUiState.Error)
        assertEquals("Risk assessment timed out. The session was blocked for safety.", (state as RiskUiState.Error).message)
    }

    @Test
    fun `reset clears the state to Idle`() = runTest {
        // Given
        viewModel.onPhysicalConfirmationReceived()
        assertEquals(RiskUiState.Confirmed, viewModel.uiState.value)
        
        // When
        viewModel.reset()
        
        // Then
        assertEquals(RiskUiState.Idle, viewModel.uiState.value)
    }
}
