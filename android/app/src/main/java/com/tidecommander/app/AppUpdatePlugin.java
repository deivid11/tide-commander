package com.tidecommander.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * In-app APK self-update for store-less installs.
 *
 * JS calls AppUpdate.downloadAndInstall({url}) with a release APK URL; the
 * plugin downloads it natively (no WebView/CORS involvement, redirects
 * followed), emits "downloadProgress" events, then hands the file to the
 * Android package installer via the app's FileProvider. Requires the
 * REQUEST_INSTALL_PACKAGES permission already declared in the manifest; on
 * first use Android routes the user through the "install unknown apps"
 * settings screen and the install continues when they return.
 *
 * A fully silent install is not possible for sideloaded apps (needs device
 * owner or a store) — the system install dialog is the one remaining tap.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String UPDATES_DIR = "updates";
    private static final String APK_FILE_NAME = "tide-commander-update.apk";
    private static final int PROGRESS_EMIT_INTERVAL_MS = 250;

    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build();

    private final AtomicBoolean downloadInFlight = new AtomicBoolean(false);
    private File pendingApk;

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (!downloadInFlight.compareAndSet(false, true)) {
            call.reject("An update download is already in progress");
            return;
        }

        // The call resolves from the download thread / settings round-trip,
        // long after this method returns.
        call.setKeepAlive(true);

        new Thread(() -> {
            try {
                File apk = downloadApk(url);
                downloadInFlight.set(false);
                getActivity().runOnUiThread(() -> requestInstall(call, apk));
            } catch (Exception e) {
                downloadInFlight.set(false);
                call.reject("Download failed: " + e.getMessage());
            }
        }, "apk-update-download").start();
    }

    private File downloadApk(String url) throws Exception {
        File dir = new File(getContext().getCacheDir(), UPDATES_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new Exception("Could not create updates directory");
        }
        File out = new File(dir, APK_FILE_NAME);
        if (out.exists() && !out.delete()) {
            throw new Exception("Could not remove previous update file");
        }

        Request request = new Request.Builder().url(url).build();
        try (Response response = http.newCall(request).execute()) {
            ResponseBody body = response.body();
            if (!response.isSuccessful() || body == null) {
                throw new Exception("HTTP " + response.code());
            }
            long total = body.contentLength();
            long downloaded = 0;
            long lastEmit = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = body.byteStream(); FileOutputStream fos = new FileOutputStream(out)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    fos.write(buffer, 0, read);
                    downloaded += read;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS || downloaded == total) {
                        lastEmit = now;
                        emitProgress(downloaded, total);
                    }
                }
            }
            emitProgress(downloaded, total > 0 ? total : downloaded);
        }
        return out;
    }

    private void emitProgress(long downloadedBytes, long totalBytes) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloadedBytes);
        data.put("totalBytes", totalBytes);
        data.put("percent", totalBytes > 0 ? (int) (downloadedBytes * 100 / totalBytes) : -1);
        notifyListeners("downloadProgress", data);
    }

    /**
     * API 26+ requires the per-app "install unknown apps" grant before the
     * package installer will accept our intent. If missing, send the user to
     * the settings screen for THIS app and resume the install on return.
     */
    private void requestInstall(PluginCall call, File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !getContext().getPackageManager().canRequestPackageInstalls()) {
            pendingApk = apk;
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            startActivityForResult(call, intent, "installPermissionResult");
            return;
        }
        launchInstaller(call, apk);
    }

    @ActivityCallback
    private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
        File apk = pendingApk;
        pendingApk = null;
        if (allowed && apk != null && apk.exists()) {
            launchInstaller(call, apk);
        } else {
            call.reject("install_permission_denied");
        }
    }

    private void launchInstaller(PluginCall call, File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);

            JSObject result = new JSObject();
            result.put("installStarted", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not launch installer: " + e.getMessage());
        }
    }
}
