package com.guardflow.data

import android.content.Context
import androidx.room.Room
import com.guardflow.data.local.GuardFlowDatabase
import com.guardflow.data.repository.GuardFlowRepository
import com.guardflow.data.repository.GuardFlowRepositoryImpl
import com.guardflow.network.ApiConfig
import com.guardflow.network.GuardFlowApiClient
import com.squareup.moshi.FromJson
import com.squareup.moshi.Moshi
import com.squareup.moshi.ToJson
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.time.Instant
import java.util.Date

object DataProvider {
    private var database: GuardFlowDatabase? = null
    private var repository: GuardFlowRepository? = null
    private var apiClient: GuardFlowApiClient? = null

    class InstantAdapter {
        @ToJson
        fun toJson(instant: Instant): String = instant.toString()

        @FromJson
        fun fromJson(value: String): Instant = Instant.parse(value)
    }

    class DateAdapter {
        @ToJson
        fun toJson(date: Date): String = date.toInstant().toString()

        @FromJson
        fun fromJson(value: String): Date = Date.from(Instant.parse(value))
    }

    private fun provideMoshi(): Moshi = Moshi.Builder()
        .add(InstantAdapter())
        .add(DateAdapter())
        .addLast(KotlinJsonAdapterFactory())
        .build()

    fun provideApiClient(): GuardFlowApiClient {
        return apiClient ?: synchronized(this) {
            val retrofit = Retrofit.Builder()
                .baseUrl(ApiConfig.BASE_URL.let { if (it.endsWith("/")) it else "$it/" })
                .addConverterFactory(MoshiConverterFactory.create(provideMoshi()))
                .build()
            
            retrofit.create(GuardFlowApiClient::class.java).also { apiClient = it }
        }
    }

    fun provideRepository(context: Context): GuardFlowRepository {
        return repository ?: synchronized(this) {
            val db = database ?: Room.databaseBuilder(
                context.applicationContext,
                GuardFlowDatabase::class.java,
                GuardFlowDatabase.DATABASE_NAME
            ).fallbackToDestructiveMigration()
                .build().also { database = it }

            GuardFlowRepositoryImpl(db.guardFlowDao(), provideApiClient()).also { repository = it }
        }
    }
}
