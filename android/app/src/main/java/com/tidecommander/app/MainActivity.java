package com.tidecommander.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Channel ID for high-priority agent notifications (must match Capacitor config)
    public static final String AGENT_NOTIFICATION_CHANNEL_ID = "agent_alerts";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Create notification channels for agent alerts (high priority)
        createNotificationChannels();

        // Enable immersive fullscreen mode (hide status bar and navigation bar)
        hideSystemUI();

        // Start foreground service to keep WebSocket alive in background
        startBackgroundService();

        // Allow showing when locked
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            // Deprecated flags for older Android versions (pre-8.1)
            @SuppressWarnings("deprecation")
            int lockScreenFlags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            getWindow().addFlags(lockScreenFlags);
        }
    }

    @Override
    public void onResume() {
        super.onResume();

        // Trigger reconnect when app comes back to foreground
        // The WebView will receive this and reconnect the WebSocket
        getBridge().eval("window.dispatchEvent(new Event('tideAppResume'));", null);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopBackgroundService();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    private void startBackgroundService() {
        Intent serviceIntent = new Intent(this, WebSocketForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    private void stopBackgroundService() {
        Intent serviceIntent = new Intent(this, WebSocketForegroundService.class);
        stopService(serviceIntent);
    }

    private void hideSystemUI() {
        View decorView = getWindow().getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decorView);

        if (controller != null) {
            // Hide both status bar and navigation bar
            controller.hide(WindowInsetsCompat.Type.statusBars());
            // Use BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE for immersive mode
            // Bars will temporarily appear when swiping from edge
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }

        // Make content extend into the cutout area (notch)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Keep screen on while app is active
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /**
     * Create notification channels for Android 8.0+
     * - High-priority channel for agent alerts (shows on lock screen, wakes device)
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager == null) return;

            // High-priority channel for agent notifications
            NotificationChannel agentChannel = new NotificationChannel(
                AGENT_NOTIFICATION_CHANNEL_ID,
                "Agent Alerts",
                NotificationManager.IMPORTANCE_HIGH  // High = sound, heads-up, wake screen
            );
            agentChannel.setDescription("Notifications from Claude agents");
            agentChannel.enableVibration(true);
            agentChannel.setVibrationPattern(new long[]{0, 250, 250, 250});
            agentChannel.enableLights(true);
            agentChannel.setLightColor(0xFF00D4AA);  // Teal color
            agentChannel.setShowBadge(true);
            agentChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            agentChannel.setBypassDnd(false);  // Respect Do Not Disturb

            // Set default sound
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();
            agentChannel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audioAttributes);

            notificationManager.createNotificationChannel(agentChannel);
        }
    }
}
