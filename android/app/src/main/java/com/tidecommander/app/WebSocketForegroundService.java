package com.tidecommander.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.IOException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Foreground service that:
 * 1. Keeps the app process alive in background
 * 2. Maintains a native WebSocket connection to the server
 * 3. Creates Android notifications for agent_notification messages
 *    when the app is in background (WebView JS is paused)
 */
public class WebSocketForegroundService extends Service {
    private static final String TAG = "TideWsForeground";
    private static final String CHANNEL_ID = "TideCommanderForeground";
    private static final int FOREGROUND_NOTIFICATION_ID = 1;
    // Agent notifications start at 1000 to avoid collision with foreground notification
    private static int agentNotificationId = 1000;

    public static final String ACTION_RECONNECT = "RECONNECT";

    // Track whether the app is in foreground (set by MainActivity)
    public static volatile boolean isAppInForeground = false;

    private PowerManager.WakeLock wakeLock;
    private Handler handler;
    private Runnable notificationChecker;
    private boolean isRunning = false;

    // Native WebSocket
    private OkHttpClient okHttpClient;
    private WebSocket webSocket;
    private int reconnectAttempts = 0;
    private static final int MAX_RECONNECT_DELAY_MS = 30000;
    // Dedupe agent notifications by server notification id
    private static final long NOTIFICATION_DEDUPE_TTL_MS = 2 * 60 * 1000; // 2 minutes
    private static final int NOTIFICATION_DEDUPE_CACHE_MAX_SIZE = 500;
    private static final Map<String, Long> seenNotificationIds = new LinkedHashMap<>();

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        acquireWakeLock();
        handler = new Handler(Looper.getMainLooper());

        okHttpClient = new OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS) // No read timeout for WebSocket
            .pingInterval(30, TimeUnit.SECONDS)    // Keep-alive pings
            .build();

        // Periodically check if foreground notification was dismissed and repost it
        notificationChecker = new Runnable() {
            @Override
            public void run() {
                if (isRunning) {
                    ensureNotificationVisible();
                    handler.postDelayed(this, 2000);
                }
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        isRunning = true;
        Notification notification = createForegroundNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(FOREGROUND_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(FOREGROUND_NOTIFICATION_ID, notification);
        }

        handler.post(notificationChecker);

        // Handle reconnect action from ServerConfigPlugin
        if (intent != null && ACTION_RECONNECT.equals(intent.getAction())) {
            connectNativeWebSocket();
        } else if (webSocket == null) {
            // First start — try connecting if URL is already configured
            connectNativeWebSocket();
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
        }
        disconnectNativeWebSocket();
        if (okHttpClient != null) {
            okHttpClient.dispatcher().executorService().shutdown();
        }
        super.onDestroy();
        releaseWakeLock();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ─── Native WebSocket ────────────────────────────────────────────

    private void connectNativeWebSocket() {
        // Disconnect existing connection first
        disconnectNativeWebSocket();

        SharedPreferences prefs = getSharedPreferences(
            ServerConfigPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(ServerConfigPlugin.KEY_SERVER_URL, "");
        String authToken = prefs.getString(ServerConfigPlugin.KEY_AUTH_TOKEN, "");

        if (serverUrl == null || serverUrl.isEmpty()) {
            Log.d(TAG, "No server URL configured, skipping native WebSocket");
            return;
        }

        // Build WebSocket URL from HTTP URL
        String wsUrl = serverUrl
            .replaceFirst("^https://", "wss://")
            .replaceFirst("^http://", "ws://");
        if (!wsUrl.endsWith("/ws")) {
            wsUrl = wsUrl.replaceAll("/$", "") + "/ws";
        }

        Log.d(TAG, "Connecting native WebSocket to: " + wsUrl);

        Request.Builder requestBuilder = new Request.Builder().url(wsUrl);
        if (authToken != null && !authToken.isEmpty()) {
            // Use protocol-based auth like the JS client
            requestBuilder.addHeader("Sec-WebSocket-Protocol", "auth-" + authToken);
        }

        webSocket = okHttpClient.newWebSocket(requestBuilder.build(), new WebSocketListener() {
            @Override
            public void onOpen(@NonNull WebSocket ws, @NonNull Response response) {
                Log.d(TAG, "Native WebSocket connected");
                reconnectAttempts = 0;
                updateForegroundNotification("Connected to server");
            }

            @Override
            public void onMessage(@NonNull WebSocket ws, @NonNull String text) {
                handleWebSocketMessage(text);
            }

            @Override
            public void onClosing(@NonNull WebSocket ws, int code, @NonNull String reason) {
                Log.d(TAG, "Native WebSocket closing: " + code + " " + reason);
                ws.close(1000, null);
            }

            @Override
            public void onClosed(@NonNull WebSocket ws, int code, @NonNull String reason) {
                Log.d(TAG, "Native WebSocket closed: " + code);
                webSocket = null;
                updateForegroundNotification("Disconnected");
                scheduleReconnect();
            }

            @Override
            public void onFailure(@NonNull WebSocket ws, @NonNull Throwable t, @Nullable Response response) {
                Log.w(TAG, "Native WebSocket failure: " + t.getMessage());
                webSocket = null;
                updateForegroundNotification("Disconnected");
                scheduleReconnect();
            }
        });
    }

    private void disconnectNativeWebSocket() {
        if (webSocket != null) {
            webSocket.close(1000, "Service disconnect");
            webSocket = null;
        }
    }

    private void scheduleReconnect() {
        if (!isRunning) return;
        reconnectAttempts++;
        long delay = Math.min(1000L * (1 << Math.min(reconnectAttempts - 1, 14)), MAX_RECONNECT_DELAY_MS);
        Log.d(TAG, "Scheduling reconnect in " + delay + "ms (attempt " + reconnectAttempts + ")");
        handler.postDelayed(this::connectNativeWebSocket, delay);
    }

    private void handleWebSocketMessage(String text) {
        try {
            JSONObject message = new JSONObject(text);
            String type = message.optString("type", "");

            if ("agent_notification".equals(type)) {
                JSONObject payload = message.optJSONObject("payload");
                if (payload != null) {
                    String notificationId = payload.optString("id", "");
                    String title = payload.optString("title", "Agent Alert");
                    String body = payload.optString("message", "");
                    String agentId = payload.optString("agentId", "");
                    String agentName = payload.optString("agentName", "Agent");
                    String iconUrl = payload.optString("iconUrl", "");
                    String imageUrl = payload.optString("imageUrl", "");

                    // Only show native notification when app is in background
                    // (when in foreground, the WebView JS handles it with in-app toast)
                    if (!isAppInForeground) {
                        if (shouldDisplayNotification(notificationId)) {
                            showAgentNotification(agentName + ": " + title, body, agentId, iconUrl, imageUrl);
                        } else {
                            Log.d(TAG, "Skipping duplicate notification id=" + notificationId);
                        }
                    }
                }
            }
        } catch (Exception e) {
            // Ignore non-JSON or irrelevant messages
        }
    }

    private boolean shouldDisplayNotification(String notificationId) {
        if (notificationId == null || notificationId.isEmpty()) {
            // If server id is unavailable, don't block delivery.
            return true;
        }

        final long now = System.currentTimeMillis();
        synchronized (seenNotificationIds) {
            // Remove expired entries
            Iterator<Map.Entry<String, Long>> it = seenNotificationIds.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<String, Long> entry = it.next();
                if (now - entry.getValue() > NOTIFICATION_DEDUPE_TTL_MS) {
                    it.remove();
                }
            }

            Long seenAt = seenNotificationIds.get(notificationId);
            if (seenAt != null && now - seenAt <= NOTIFICATION_DEDUPE_TTL_MS) {
                return false;
            }

            seenNotificationIds.put(notificationId, now);

            // Bound cache size to avoid unbounded growth
            while (seenNotificationIds.size() > NOTIFICATION_DEDUPE_CACHE_MAX_SIZE) {
                Iterator<String> keyIt = seenNotificationIds.keySet().iterator();
                if (!keyIt.hasNext()) break;
                keyIt.next();
                keyIt.remove();
            }
            return true;
        }
    }

    private void showAgentNotification(String title, String body, String agentId,
                                        String iconUrl, String imageUrl) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        final int id = agentNotificationId++;

        // Post immediately with the fallback icon; upgrade asynchronously once
        // remote PNGs finish downloading. This keeps latency low on slow networks.
        manager.notify(id, buildAgentNotification(title, body, agentId, null, null));

        boolean hasIcon = iconUrl != null && !iconUrl.isEmpty();
        boolean hasImage = imageUrl != null && !imageUrl.isEmpty();
        if (!hasIcon && !hasImage) return;

        fetchBitmapAsync(hasIcon ? iconUrl : null, iconBitmap -> {
            fetchBitmapAsync(hasImage ? imageUrl : null, bigBitmap -> {
                if (iconBitmap == null && bigBitmap == null) return;
                NotificationManager m = getSystemService(NotificationManager.class);
                if (m == null) return;
                m.notify(id, buildAgentNotification(title, body, agentId, iconBitmap, bigBitmap));
            });
        });
    }

    private Notification buildAgentNotification(String title, String body, String agentId,
                                                 @Nullable Bitmap largeIcon, @Nullable Bitmap bigPicture) {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        tapIntent.putExtra("agentId", agentId);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, agentNotificationId, tapIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MainActivity.AGENT_NOTIFICATION_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL);

        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }
        if (bigPicture != null) {
            NotificationCompat.BigPictureStyle style = new NotificationCompat.BigPictureStyle()
                .bigPicture(bigPicture)
                .setSummaryText(body);
            // Hide the round thumbnail when the notification is expanded, per platform guidance.
            if (largeIcon != null) {
                style.bigLargeIcon((Bitmap) null);
            }
            builder.setStyle(style);
        }
        return builder.build();
    }

    private interface BitmapCallback {
        void onResult(@Nullable Bitmap bitmap);
    }

    // Download a PNG/JPEG from a URL off the main thread. Invokes callback with
    // null on any failure so the caller can fall back to a plain notification.
    private void fetchBitmapAsync(@Nullable String url, @NonNull BitmapCallback callback) {
        if (url == null || url.isEmpty() || okHttpClient == null) {
            callback.onResult(null);
            return;
        }
        Request request;
        try {
            request = new Request.Builder().url(url).build();
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "Invalid notification image URL: " + url);
            callback.onResult(null);
            return;
        }
        okHttpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                Log.w(TAG, "Failed to fetch notification image: " + e.getMessage());
                callback.onResult(null);
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                Bitmap bitmap = null;
                try (ResponseBody responseBody = response.body()) {
                    if (response.isSuccessful() && responseBody != null) {
                        bitmap = BitmapFactory.decodeStream(responseBody.byteStream());
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to decode notification image: " + e.getMessage());
                }
                callback.onResult(bitmap);
            }
        });
    }

    // ─── Foreground Notification Management ──────────────────────────

    private void ensureNotificationVisible() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            StatusBarNotification[] activeNotifications = manager.getActiveNotifications();
            boolean found = false;
            for (StatusBarNotification sbn : activeNotifications) {
                if (sbn.getId() == FOREGROUND_NOTIFICATION_ID) {
                    found = true;
                    break;
                }
            }
            if (!found && isRunning) {
                manager.notify(FOREGROUND_NOTIFICATION_ID, createForegroundNotification());
            }
        }
    }

    private void updateForegroundNotification(String status) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && isRunning) {
            Notification notification = createForegroundNotification(status);
            manager.notify(FOREGROUND_NOTIFICATION_ID, notification);
        }
    }

    private Notification createForegroundNotification() {
        return createForegroundNotification("WebSocket connected");
    }

    private Notification createForegroundNotification(String contentText) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Tide Commander")
            .setContentText(contentText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();

        notification.flags |= Notification.FLAG_NO_CLEAR | Notification.FLAG_ONGOING_EVENT;
        return notification;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Background Service",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps WebSocket connection alive");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.enableLights(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    // ─── Wake Lock ───────────────────────────────────────────────────

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "TideCommander::WebSocketWakeLock"
            );
            wakeLock.acquire();
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }
}
