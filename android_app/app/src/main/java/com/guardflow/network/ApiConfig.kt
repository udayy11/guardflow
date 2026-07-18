package com.guardflow.network

/**
 * Single source of truth for the backend base URL.
 *
 * Emulator note: 10.0.2.2 is the special alias the Android emulator uses
 * to reach the host machine's localhost. For a physical device on the
 * same network as the backend, replace this with the host machine's LAN IP,
 * e.g. "http://192.168.1.42:8000/api/v1".
 */
object ApiConfig {
    const val BASE_URL: String = "http://10.92.196.172:8000/api/v1"
}
/* http://10.0.2.2:8000/api/v1 */