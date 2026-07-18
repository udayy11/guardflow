package com.guardflow.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Contactless
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.guardflow.ui.theme.RiskHigh
import com.guardflow.ui.theme.RiskHighBg

@Composable
fun PhysicalConfirmationPrompt(
    secondsRemaining: Int,
    onConfirmPressed: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(
            containerColor = RiskHighBg
        )
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Contactless,
                    contentDescription = null,
                    tint = RiskHigh,
                    modifier = Modifier.size(32.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = "Physical Verification Required",
                    style = MaterialTheme.typography.titleMedium,
                    color = RiskHigh,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Please tap your registered NFC security card on the dedicated GuardFlow hardware device.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = "Note: This step cannot be bypassed on this phone. It requires external hardware verification for high-risk actions.",
                style = MaterialTheme.typography.bodySmall,
                color = RiskHigh.copy(alpha = 0.8f)
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = "Time remaining: $secondsRemaining seconds",
                style = MaterialTheme.typography.labelLarge,
                color = RiskHigh,
                fontWeight = FontWeight.ExtraBold
            )
        }
    }
}
