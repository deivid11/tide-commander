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
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
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

    // NOTE: deliberately NO permanent wake lock. The foreground service keeps
    // the process alive and incoming socket data wakes the CPU on its own; a
    // held PARTIAL_WAKE_LOCK prevents the SoC from ever sleeping and made the
    // phone heat up while idle in the background. The battery-optimization
    // exemption (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) covers Doze delivery.
    private Handler handler;
    private boolean isRunning = false;

    // Native WebSocket
    private OkHttpClient okHttpClient;
    private WebSocket webSocket;
    private int reconnectAttempts = 0;
    // Which URL of the synced candidate list the next connect attempt uses.
    // Advanced on connection failure so the service fails over between
    // backends on its own — while the app is backgrounded its JS socket is
    // parked and cannot re-probe for us (e.g. after leaving the home Wi-Fi).
    private int candidateIndex = 0;
    // Retry ceiling. Off the server's network (out of the house, no VPN) the
    // socket can never connect, and a 30s ceiling meant ~2,880 pointless
    // DNS+TCP attempts a day — the single worst battery case for this service.
    private static final int MAX_RECONNECT_DELAY_MS = 300000;
    // Dedupe agent notifications by server notification id
    private static final long NOTIFICATION_DEDUPE_TTL_MS = 2 * 60 * 1000; // 2 minutes
    private static final int NOTIFICATION_DEDUPE_CACHE_MAX_SIZE = 500;
    private static final Map<String, Long> seenNotificationIds = new LinkedHashMap<>();

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        handler = new Handler(Looper.getMainLooper());

        okHttpClient = new OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS) // No read timeout for WebSocket
            // Keep-alive cadence. Each ping wakes the radio out of idle, so 30s
            // (2,880 wakeups/day) was pure battery burn: the server never pings
            // us, it only answers, so this interval alone sets the idle cost.
            // 5 min stays well inside carrier/NAT connection timeouts and
            // matches what FCM itself uses on cellular.
            .pingInterval(5, TimeUnit.MINUTES)
            .build();

        // NOTE: nothing reposts the foreground notification any more. It used to
        // be re-added whenever the user swiped it away, which is hostile — and a
        // recurring CPU wakeup on top. Android keeps it up on its own for as long
        // as the service is in the foreground, and that's enough.
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

        // Handle reconnect action from ServerConfigPlugin
        if (intent != null && ACTION_RECONNECT.equals(intent.getAction())) {
            // Fresh config from JS puts its chosen URL first — start over there.
            candidateIndex = 0;
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
        List<String> candidates = loadCandidateUrls(prefs);
        String authToken = prefs.getString(ServerConfigPlugin.KEY_AUTH_TOKEN, "");

        if (candidates.isEmpty()) {
            Log.d(TAG, "No server URL configured, skipping native WebSocket");
            return;
        }

        final int usedIndex = candidateIndex % candidates.size();
        String serverUrl = candidates.get(usedIndex);

        // Build WebSocket URL from HTTP URL
        String wsUrl = serverUrl
            .replaceFirst("^https://", "wss://")
            .replaceFirst("^http://", "ws://");
        if (!wsUrl.endsWith("/ws")) {
            wsUrl = wsUrl.replaceAll("/$", "") + "/ws";
        }
        // Notification-only subscription: the server skips the broadcast
        // firehose (agent output streams etc.) for this socket, so the phone's
        // radio and CPU stay idle unless an actual notification arrives.
        wsUrl = wsUrl + "?mode=notify";

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
                candidateIndex = usedIndex; // pin the URL that actually works
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
                // This URL didn't answer — rotate to the next candidate for the
                // upcoming retry (wraps around via the modulo at connect time).
                candidateIndex = usedIndex + 1;
                updateForegroundNotification("Disconnected");
                scheduleReconnect();
            }
        });
    }

    /**
     * Candidate URL list for the native socket: the JS-chosen active URL first,
     * then the rest of the configured priority list.
     */
    private List<String> loadCandidateUrls(SharedPreferences prefs) {
        ArrayList<String> urls = new ArrayList<>();
        String json = prefs.getString(ServerConfigPlugin.KEY_SERVER_URLS, "");
        if (json != null && !json.isEmpty()) {
            try {
                JSONArray arr = new JSONArray(json);
                for (int i = 0; i < arr.length(); i++) {
                    String u = arr.optString(i, "").trim();
                    if (!u.isEmpty() && !urls.contains(u)) {
                        urls.add(u);
                    }
                }
            } catch (JSONException e) {
                Log.w(TAG, "Invalid server_urls JSON: " + e.getMessage());
            }
        }
        String active = prefs.getString(ServerConfigPlugin.KEY_SERVER_URL, "");
        if (active != null && !active.isEmpty()) {
            urls.remove(active);
            urls.add(0, active);
        }
        return urls;
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
        // Cheap pre-filter: with an up-to-date server the ?mode=notify socket
        // only receives agent_notification messages, but against an older
        // server this still avoids JSON-parsing the full broadcast firehose.
        if (text == null || !text.contains("\"agent_notification\"")) {
            return;
        }
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
            // DEFERRED lets Android hold the notification back ~10s. Push
            // normally stands this service down long before that, so the
            // "Connected to server" row never reaches the shade at all.
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .build();

        notification.flags |= Notification.FLAG_NO_CLEAR | Notification.FLAG_ONGOING_EVENT;
        return notification;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // MIN is the quietest a foreground service can be: no icon in the
            // status bar, collapsed at the bottom of the shade. Android does not
            // allow a foreground service with no notification at all — the only
            // way to be rid of it entirely is to not run the service, which is
            // exactly what happens once FCM push is active.
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Background Service",
                NotificationManager.IMPORTANCE_MIN
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

}
