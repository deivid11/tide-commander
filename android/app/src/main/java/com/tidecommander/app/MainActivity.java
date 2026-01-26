package com.tidecommander.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable immersive fullscreen mode (hide status bar and navigation bar)
        hideSystemUI();

        // Start foreground service to keep WebSocket alive in background
        startBackgroundService();
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
}
