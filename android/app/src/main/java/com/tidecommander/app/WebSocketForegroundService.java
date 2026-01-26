package com.tidecommander.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.pm.ServiceInfo;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;

public class WebSocketForegroundService extends Service {
    private static final String CHANNEL_ID = "TideCommanderForeground";
    private static final int NOTIFICATION_ID = 1;
    private PowerManager.WakeLock wakeLock;
    private Handler handler;
    private Runnable notificationChecker;
    private boolean isRunning = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        acquireWakeLock();
        handler = new Handler(Looper.getMainLooper());

        // Periodically check if notification was dismissed and repost it
        notificationChecker = new Runnable() {
            @Override
            public void run() {
                if (isRunning) {
                    ensureNotificationVisible();
                    handler.postDelayed(this, 2000); // Check every 2 seconds
                }
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        isRunning = true;
        Notification notification = createNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Start checking for notification dismissal
        handler.post(notificationChecker);

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (handler != null) {
            handler.removeCallbacks(notificationChecker);
        }
        super.onDestroy();
        releaseWakeLock();
    }

    private void ensureNotificationVisible() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            StatusBarNotification[] activeNotifications = manager.getActiveNotifications();
            boolean found = false;
            for (StatusBarNotification sbn : activeNotifications) {
                if (sbn.getId() == NOTIFICATION_ID) {
                    found = true;
                    break;
                }
            }
            if (!found && isRunning) {
                // Notification was dismissed, repost it
                manager.notify(NOTIFICATION_ID, createNotification());
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Background Service",
                NotificationManager.IMPORTANCE_LOW  // Low = no sound, but always visible
            );
            channel.setDescription("Keeps WebSocket connection alive");
            channel.setShowBadge(false);
            channel.setSound(null, null);  // No sound
            channel.enableVibration(false);
            channel.enableLights(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification createNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Tide Commander")
            .setContentText("WebSocket connected")
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
