package com.guardflow.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.guardflow.data.SessionManager
import com.guardflow.data.repository.GuardFlowRepository
import com.guardflow.network.GuardFlowApiClient

class GuardFlowViewModelFactory(
    private val api: GuardFlowApiClient,
    private val repository: GuardFlowRepository,
    private val sessionManager: SessionManager
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(GuardFlowViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return GuardFlowViewModel(
                api = api,
                repository = repository,
                sessionManager = sessionManager
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
