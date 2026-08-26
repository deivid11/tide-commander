package com.tidecommander.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens links in an Android app instead of asking the embedded WebView to
 * create a second browsing window. Some WebView/driver combinations leave the
 * original hardware surface black after a target=_blank window is closed.
 */
@CapacitorPlugin(name = "ExternalNavigation")
public class ExternalNavigationPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String rawUrl = call.getString("url");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }

        Uri uri;
        try {
            uri = Uri.parse(rawUrl);
        } catch (Exception error) {
            call.reject("Invalid URL", error);
            return;
        }

        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http")
            || scheme.equalsIgnoreCase("https")
            || scheme.equalsIgnoreCase("mailto")
            || scheme.equalsIgnoreCase("tel")
            || scheme.equalsIgnoreCase("geo")
            || scheme.equalsIgnoreCase("market"))) {
            call.reject("Unsupported external URL scheme");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            getActivity().startActivity(intent);
            // Resolve now, before Android pauses the WebView/JS bridge.
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("No Android app can open this link", error);
        } catch (Exception error) {
            call.reject("Could not open external link", error);
        }
    }
}
