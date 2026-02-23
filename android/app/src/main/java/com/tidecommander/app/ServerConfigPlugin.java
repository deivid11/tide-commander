package com.tidecommander.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

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
    public static final String KEY_AUTH_TOKEN = "auth_token";

    @PluginMethod
    public void syncConfig(PluginCall call) {
        String url = call.getString("url", "");
        String token = call.getString("token", "");

        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_SERVER_URL, url)
            .putString(KEY_AUTH_TOKEN, token)
            .apply();

        // Tell the foreground service to connect/reconnect its native WebSocket
        Intent intent = new Intent(getContext(), WebSocketForegroundService.class);
        intent.setAction(WebSocketForegroundService.ACTION_RECONNECT);
        getContext().startService(intent);

        call.resolve();
    }
}
