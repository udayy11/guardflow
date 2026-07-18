package com.guardflow.model

import com.squareup.moshi.Json

enum class EventType {
    @Json(name = "app_opened") APP_OPENED,
    @Json(name = "website_opened") WEBSITE_OPENED,
    @Json(name = "form_field_filled") FORM_FIELD_FILLED,
    @Json(name = "form_submitted") FORM_SUBMITTED,
    @Json(name = "sms_received") SMS_RECEIVED,
    @Json(name = "link_clicked") LINK_CLICKED,
    @Json(name = "contact_added") CONTACT_ADDED,
    @Json(name = "call_started") CALL_STARTED,
    @Json(name = "screen_share_started") SCREEN_SHARE_STARTED,
    @Json(name = "payment_app_opened") PAYMENT_APP_OPENED,
    @Json(name = "payment_initiated") PAYMENT_INITIATED,
    @Json(name = "payment_confirmed") PAYMENT_CONFIRMED;

    fun wireValue(): String {
        return name.lowercase(java.util.Locale.ROOT)
    }
}
