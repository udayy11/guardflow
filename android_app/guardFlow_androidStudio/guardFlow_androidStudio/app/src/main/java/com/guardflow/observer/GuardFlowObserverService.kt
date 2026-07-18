package com.guardflow.observer

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.guardflow.data.DataProvider
import com.guardflow.data.SessionManager
import com.guardflow.data.repository.GuardFlowRepository
import com.guardflow.model.EventType
import com.guardflow.model.GuardFlowEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class GuardFlowObserverService : AccessibilityService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var repository: GuardFlowRepository
    private lateinit var sessionId: String

    private var lastRecordedUrl: String? = null
    private var lastRecordedApp: String? = null

    // Debounce/throttle state for browser scanning. TYPE_WINDOW_CONTENT_CHANGED,
    // TYPE_VIEW_SCROLLED, and TYPE_VIEW_FOCUSED all fire many times per second
    // during a single page load or redirect chain - without a minimum gap
    // between scans, each intermediate redirect hop (e.g. linkedin.com ->
    // www.linkedin.com -> in.linkedin.com) gets recorded as its own separate
    // "link clicked" event even though it's one real navigation.
    private var lastScanTimeMs: Long = 0L
    private val MIN_SCAN_INTERVAL_MS = 800L

    // Same strict URL pattern used in checkForLinkClicked, reused here so
    // findUrlInNodeTree() can no longer accept "any text with a dot and no
    // spaces" (which false-positived on email addresses, version strings,
    // and plain domain names shown in unrelated UI like a search-engine
    // picker list).
    private val urlPattern = Regex(
        "(?i)\\b((?:https?://|www\\d{0,3}[.]|[a-z0-9.\\-]+[.][a-z]{2,4}/)(?:[^\\s()<>]+|\\(([^\\s()<>]+|(\\([^\\s()<>]+\\)))*\\))+(?:\\(([^\\s()<>]+|(\\([^\\s()<>]+\\)))*\\)|[^\\s`!()\\[\\]{};:'\".,<>?«»“”‘’]))"
    )

    override fun onServiceConnected() {
        try {
            super.onServiceConnected()
            repository = DataProvider.provideRepository(this)
            val sessionManager = SessionManager(this)
            serviceScope.launch {
                try {
                    sessionId = sessionManager.getOrCreateSessionId()
                    Log.d("GuardFlowObserver", "Service Connected - Session: $sessionId")
                } catch (e: Exception) {
                    Log.e("GuardFlowObserver", "Failed to initialize session ID", e)
                }
            }
        } catch (e: Exception) {
            Log.e("GuardFlowObserver", "Error in onServiceConnected", e)
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        try {
            if (event == null) return

            val pkg = event.packageName?.toString() ?: ""

            when (event.eventType) {
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                    if (pkg != this.packageName) {
                        recordAppOpened(pkg)
                    }
                }
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
                AccessibilityEvent.TYPE_VIEW_SCROLLED,
                AccessibilityEvent.TYPE_VIEW_FOCUSED -> {
                    if (pkg.contains("chrome") || pkg.contains("browser") || pkg.contains("sbrowser")) {
                        if (shouldScanNow()) {
                            scanForBrowserUrl(pkg)
                        }
                    }
                }
                AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                    val source = event.source
                    if (source != null) {
                        checkForLinkClicked(source, pkg)
                        source.recycle()
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("GuardFlowObserver", "Error in onAccessibilityEvent", e)
        }
    }

    /**
     * Throttles how often scanForBrowserUrl() can run. Content-changed/
     * scrolled/focused events fire continuously while a page streams in or
     * a redirect chain resolves - without this gate, every intermediate
     * state gets treated as a distinct "link," not just the page the user
     * actually lands on.
     */
    private fun shouldScanNow(): Boolean {
        val now = System.currentTimeMillis()
        if (now - lastScanTimeMs < MIN_SCAN_INTERVAL_MS) {
            return false
        }
        lastScanTimeMs = now
        return true
    }

    private fun scanForBrowserUrl(packageName: String) {
        val root = rootInActiveWindow ?: return

        // Known Browser URL Bar IDs
        val urlBarIds = listOf(
            "com.android.chrome:id/url_bar",
            "com.sec.android.app.sbrowser:id/location_bar_edit_text",
            "org.mozilla.firefox:id/url_bar_title"
        )

        var found = false
        for (id in urlBarIds) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id)
            if (nodes.isNotEmpty()) {
                val url = nodes[0].text?.toString()
                if (isLikelyRealUrl(url)) {
                    recordLinkClicked(url!!, packageName)
                    found = true
                }
                nodes.forEach { it.recycle() }
                if (found) break
            }
        }

        if (!found) {
            // Fallback to recursive scan if the address bar itself couldn't be
            // read. This fallback is intentionally much stricter now (see
            // findUrlInNodeTree) - it previously accepted any text containing a
            // dot with no spaces, which misfired on email addresses and plain
            // domain names appearing anywhere on screen (e.g. a search-engine
            // picker list), not just genuine navigated-to URLs.
            findUrlInNodeTree(root, packageName)
        }
        root.recycle()
    }

    private fun recordAppOpened(packageName: String) {
        if (packageName == lastRecordedApp) return
        lastRecordedApp = packageName

        serviceScope.launch {
            if (!::sessionId.isInitialized) return@launch
            val event = GuardFlowEvent(
                sessionId = sessionId,
                eventType = EventType.APP_OPENED,
                sourceApp = packageName,
                metadata = mapOf("package_name" to packageName)
            )
            repository.recordEvent(event)
            Log.d("GuardFlowObserver", "Recorded App Opened: $packageName")
        }
    }

    private fun checkForLinkClicked(node: AccessibilityNodeInfo, packageName: String?) {
        // Search the node and its children for anything that looks like a URL
        val text = node.text?.toString() ?: ""
        val contentDesc = node.contentDescription?.toString() ?: ""

        val match = urlPattern.find(text) ?: urlPattern.find(contentDesc)

        if (match != null && isLikelyRealUrl(match.value)) {
            recordLinkClicked(match.value, packageName)
        } else {
            // If the node itself doesn't have a URL, check if it's a browser URL bar
            // often found in Chrome/Browsers
            if (packageName?.contains("chrome") == true || packageName?.contains("browser") == true) {
                if (shouldScanNow()) {
                    rootInActiveWindow?.let { root ->
                        findUrlInNodeTree(root, packageName)
                        root.recycle()
                    }
                }
            }
        }
    }

    private fun findUrlInNodeTree(node: AccessibilityNodeInfo, packageName: String?) {
        val text = node.text?.toString() ?: ""
        val contentDesc = node.contentDescription?.toString() ?: ""

        // Previously this accepted ANY text/contentDescription containing a
        // dot with no spaces as a "URL" - that matched email addresses
        // (which have a dot too), version strings, and plain domain names
        // sitting in unrelated UI (e.g. a list of search-engine options).
        // Requiring an actual match against urlPattern (scheme, www-prefix,
        // or domain+path) plus explicitly rejecting anything containing "@"
        // filters those false positives out.
        val candidate = urlPattern.find(text)?.value ?: urlPattern.find(contentDesc)?.value

        if (isLikelyRealUrl(candidate) && candidate != this.packageName) {
            Log.d("GuardFlowObserver", "Found potential URL in tree: $candidate")
            recordLinkClicked(candidate!!, packageName)
            // Don't return here, keep scanning to find the most specific one,
            // but recordLinkClicked handles deduplication
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                findUrlInNodeTree(child, packageName)
                child.recycle()
            }
        }
    }

    /**
     * Central validation gate for anything considered a "real" URL before
     * it's recorded as a LINK_CLICKED/WEBSITE_OPENED event. Rejects blanks,
     * email addresses (contain "@" - a dot alone is not enough to tell an
     * email apart from a domain), and anything that doesn't actually match
     * the URL pattern used elsewhere in this file.
     */
    private fun isLikelyRealUrl(candidate: String?): Boolean {
        if (candidate.isNullOrBlank()) return false
        if (candidate.contains("@")) return false // email address, not a URL
        if (candidate.length <= 4) return false
        return urlPattern.containsMatchIn(candidate) || candidate.startsWith("http")
    }

    private fun recordLinkClicked(url: String, sourceApp: String?) {
        if (url == lastRecordedUrl) return // Skip identical consecutive URLs
        lastRecordedUrl = url

        serviceScope.launch {
            if (!::sessionId.isInitialized) return@launch
            val event = GuardFlowEvent(
                sessionId = sessionId,
                eventType = EventType.LINK_CLICKED,
                sourceApp = sourceApp,
                metadata = mapOf(
                    "url" to url,
                    "detection_method" to "accessibility_scan"
                )
            )
            repository.recordEvent(event)
            Log.d("GuardFlowObserver", ">>> RECORDED LINK: $url from $sourceApp")
        }
    }

    override fun onInterrupt() {
        Log.d("GuardFlowObserver", "Service Interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }
}
