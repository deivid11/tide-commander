package com.tidecommander.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin that bridges the JavaScript-configured server URL
 * to Android SharedPreferences so the foreground service can connect
 * its own native WebSocket for background notification delivery.
 */
@CapacitorPlugin(name = "ServerConfig")
public class ServerConfigPlugin extends Plugin {
    public static final String PREFS_NAME = "TideCommanderPrefs";
    public static final String KEY_SERVER_URL = "server_url";
    public static final String KEY_SERVER_URLS = "server_urls";
    public static final String KEY_AUTH_TOKEN = "auth_token";
    // Opt-out for the persistent foreground service + its permanent
    // "Connected to server" notification. Default true so existing users are
    // unaffected — turning it off stops push delivery while the app is closed.
    public static final String KEY_BACKGROUND_SERVICE_ENABLED = "background_service_enabled";
    // Set once FCM push is registered end-to-end (token accepted by the
    // server). While true the foreground service stays DOWN: push arrives over
    // the socket Android already keeps for every app, so holding a second
    // always-on WebSocket would burn battery for nothing.
    public static final String KEY_PUSH_ACTIVE = "push_active";

    @PluginMethod
    public void syncConfig(PluginCall call) {
        String url = call.getString("url", "");
        String token = call.getString("token", "");
        // Full candidate list (JSON array) so the foreground service can fail
        // over between backends while the app's own socket is parked.
        JSArray urls = call.getArray("urls");
        String urlsJson = urls != null ? urls.toString() : "[]";

        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_SERVER_URL, url)
            .putString(KEY_SERVER_URLS, urlsJson)
            .putString(KEY_AUTH_TOKEN, token)
            .apply();

        // Only ask the foreground service to reconnect if the user hasn't
        // opted out and push isn't covering background delivery — otherwise
        // this would resurrect a service that should stay down (startService
        // starts the service if it isn't already running).
        if (prefs.getBoolean(KEY_BACKGROUND_SERVICE_ENABLED, true)
                && !prefs.getBoolean(KEY_PUSH_ACTIVE, false)) {
            Intent intent = new Intent(getContext(), WebSocketForegroundService.class);
            intent.setAction(WebSocketForegroundService.ACTION_RECONNECT);
            getContext().startService(intent);
        }

        call.resolve();
    }

    @PluginMethod
    public void getBackgroundServiceEnabled(PluginCall call) {
        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("enabled", prefs.getBoolean(KEY_BACKGROUND_SERVICE_ENABLED, true));
        call.resolve(result);
    }

    @PluginMethod
    public void setBackgroundServiceEnabled(PluginCall call) {
        Boolean enabledArg = call.getBoolean("enabled", true);
        boolean enabled = enabledArg == null || enabledArg;

        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_BACKGROUND_SERVICE_ENABLED, enabled).apply();

        Intent serviceIntent = new Intent(getContext(), WebSocketForegroundService.class);
        if (enabled && !prefs.getBoolean(KEY_PUSH_ACTIVE, false)) {
            // The plugin call runs while the app is in the foreground, so
            // startForegroundService is allowed even from O+.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }
        } else {
            getContext().stopService(serviceIntent);
        }
        call.resolve();
    }

    /**
     * Called by the JS side once FCM registration succeeded (or failed).
     *
     * Active push retires the foreground service immediately — that's the
     * whole point of the migration: no permanent socket, no 30s keep-alive
     * ping, no permanent "Connected to server" notification. If push ever
     * stops working the same call brings the fallback back up, provided the
     * user hasn't opted out of background delivery entirely.
     */
    @PluginMethod
    public void setPushActive(PluginCall call) {
        Boolean activeArg = call.getBoolean("active", false);
        boolean active = activeArg != null && activeArg;

        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_PUSH_ACTIVE, active).apply();

        Intent serviceIntent = new Intent(getContext(), WebSocketForegroundService.class);
        if (active) {
            getContext().stopService(serviceIntent);
        } else if (prefs.getBoolean(KEY_BACKGROUND_SERVICE_ENABLED, true)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void getPushActive(PluginCall call) {
        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("active", prefs.getBoolean(KEY_PUSH_ACTIVE, false));
        call.resolve(result);
    }
}
