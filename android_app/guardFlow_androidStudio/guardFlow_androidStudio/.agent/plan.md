# Project Plan

GuardFlow - Implement ViewModel for risk assessment and history management.

## Project Brief

# GuardFlow Project Brief

GuardFlow is a high-performance Android application designed for real-time event monitoring and proactive risk assessment. The app provides a centralized dashboard to track custom events and visualize risk scores using an energetic, Material Design 3-based interface.

### Features
*   **Live Event Stream**: A real-time feed of monitored events featuring high-visibility priority indicators and status updates.
*   **Risk Scoring Dashboard**: An interactive visualization of calculated risk scores, allowing users to identify potential threats at a glance.
*   **Adaptive Detail View**: A multi-pane interface that displays detailed event metadata and risk factor breakdowns, optimizing for both mobile and large-screen devices.
*   **Event Filtering & Analytics**: Advanced filtering tools to sort events by severity, category, or risk level to streamline monitoring workflows.

### High-Level Tech Stack
*   **Language**: Kotlin
*   **UI Framework**: Jetpack Compose with Material Design 3 (M3)
*   **Navigation**: Jetpack Navigation 3 (State-driven)
*   **Adaptive Layouts**: Compose Material Adaptive library (supporting List-Detail and multi-pane patterns)
*   **Concurrency**: Kotlin Coroutines & Flow for reactive event processing
*   **Networking**: Retrofit & OkHttp for event data ingestion

## Implementation Steps

### Task_1_DataLayer: Define domain models (Event, RiskScore) and implement Room database and Repository for local event storage and reactive data flow.
- **Status:** COMPLETED
- **Updates:** Domain models, Room database, DAOs, and Repository have been successfully implemented.
- **Acceptance Criteria:**
  - Domain models defined
  - Room database and DAOs implemented
  - Repository provides Flow-based event updates

### Task_2_NavigationAdaptive: Set up Navigation 3 and implement a Compose Adaptive List-Detail layout for the main event monitoring interface.
- **Status:** COMPLETED
- **Updates:** Navigation 3 and Adaptive List-Detail layout implemented.
- **Acceptance Criteria:**
  - Navigation 3 integration working
  - Adaptive List-Detail scaffold functional on different screen sizes

### Task_3_DashboardFeatures: Implement the Live Event Stream feed with priority indicators and the Risk Scoring Dashboard with filtering capabilities.
- **Status:** COMPLETED
- **Updates:** Live Event Stream and Risk Scoring Dashboard implemented.
- **Acceptance Criteria:**
  - Live Event Stream displays data items
  - Risk Dashboard shows scoring visualizations
  - Filtering by severity/category is functional

### Task_4_ThemeAssetsVerify: Apply vibrant Material 3 theme, full edge-to-edge display, create adaptive app icon, and perform final run verification.
- **Status:** COMPLETED
- **Updates:** Applied vibrant Material 3 theme, configured full edge-to-edge display in MainActivity, and created adaptive app icons (shield/radar design). Verified the project builds successfully.
- **Acceptance Criteria:**
  - Material 3 vibrant theme applied
  - Edge-to-edge display working
  - Adaptive app icon implemented
  - Build passes and app runs without crashes

### Task_5_NetworkingImplementation: Add OkHttp dependencies and implement GuardFlowApiClient in the network package to handle sending events and fetching risk scores.
- **Status:** COMPLETED
- **Updates:** OkHttp 4.12.0 dependency added. GuardFlowApiClient implemented with sendEvents and fetchRiskScore methods. RiskUiState sealed interface and HistoryEntry data class created. Project builds successfully.
- **Acceptance Criteria:**
  - OkHttp dependency added to build.gradle
  - GuardFlowApiClient implemented in network package
  - API methods for sending events and fetching scores are defined

### Task_6_StateManagementVerification: Define RiskUiState and HistoryEntry in the state package for UI state management and perform final app stability verification.
- **Status:** COMPLETED
- **Updates:** RiskUiState and HistoryEntry implemented as requested. Performed a build to ensure stability. App structure is now complete for networking and state management.
- **Acceptance Criteria:**
  - RiskUiState and HistoryEntry implemented
  - App builds and runs without crashes
  - Existing tests pass

### Task_7_ViewModelImplementation: Implement GuardFlowViewModel in the viewmodel package to manage UI state, event history, and networking for risk assessment.
- **Status:** COMPLETED
- **Updates:** GuardFlowViewModel implemented in the viewmodel package.
- **Acceptance Criteria:**
  - ViewModel dependencies verified/added
  - GuardFlowViewModel implemented with uiState and history
  - Network calls use Dispatchers.IO and Coroutines
  - RiskResult parsing updates the history entry

### Task_8_FinalVerification: Run and Verify the application stability and ensure alignment with the GuardFlow requirements.
- **Status:** COMPLETED
- **Updates:** Implemented all core UI screens: HomeScreen, HistoryScreen, PermissionOnboardingScreen, and RiskStatusCard.
Integrated Navigation 3 to handle transitions between Onboarding, Home, and History.
Connected GuardFlowViewModel to provide real-time data to all screens.
Verified adaptive layout behavior (List-Detail strategy).
Updated MainActivity to initialize the full app stack.
Verified build stability.
- **Acceptance Criteria:**
  - App builds and runs without crashes
  - All existing tests pass
  - ViewModel correctly manages risk assessment state
  - Critic_agent verifies application stability
- **Duration:** N/A

