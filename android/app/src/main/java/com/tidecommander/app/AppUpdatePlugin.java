package com.tidecommander.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

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

    // OTA web bundle (Expo-updates style): UI assets pulled from the connected
    // server and hosted via Capacitor's setServerBasePath. Prefs shared with
    // MainActivity's boot rollback check.
    public static final String WEB_BUNDLE_PREFS = "TideWebBundle";
    public static final String PREF_BUNDLE_PATH = "path";
    public static final String PREF_BUNDLE_HASH = "hash";
    public static final String PREF_BUNDLE_VERSION = "version";
    public static final String PREF_BUNDLE_PENDING = "pendingConfirm";
    private static final String WEB_BUNDLES_DIR = "web-bundles";

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

    // ── OTA web bundle ──────────────────────────────────────────────

    /**
     * Download a zipped web bundle from the connected server, extract it and
     * swap the WebView onto it (same http://localhost origin, so every native
     * plugin keeps working). The WebView reloads immediately. pendingConfirm
     * stays true until the freshly booted JS calls confirmWebBundle(); if the
     * app is relaunched before that, MainActivity rolls back to bundled assets
     * — a broken bundle can never brick the UI.
     */
    @PluginMethod
    public void applyWebBundle(PluginCall call) {
        String url = call.getString("url");
        String hash = call.getString("hash");
        String version = call.getString("version", "");
        if (url == null || url.isEmpty() || hash == null || hash.isEmpty()) {
            call.reject("url and hash are required");
            return;
        }
        if (!downloadInFlight.compareAndSet(false, true)) {
            call.reject("A download is already in progress");
            return;
        }
        JSObject headers = call.getObject("headers", new JSObject());

        call.setKeepAlive(true);
        new Thread(() -> {
            try {
                File bundleDir = downloadAndExtractBundle(url, hash, headers);

                SharedPreferences.Editor prefs = webBundlePrefs().edit();
                prefs.putString(PREF_BUNDLE_PATH, bundleDir.getAbsolutePath());
                prefs.putString(PREF_BUNDLE_HASH, hash);
                prefs.putString(PREF_BUNDLE_VERSION, version);
                prefs.putBoolean(PREF_BUNDLE_PENDING, true);
                prefs.apply();

                // Persist for Capacitor's boot restore (Bridge reads this pref;
                // it auto-ignores it after a new APK binary is installed).
                getContext()
                    .getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, bundleDir.getAbsolutePath())
                    .apply();

                downloadInFlight.set(false);
                JSObject result = new JSObject();
                result.put("applied", true);
                // Resolve first — setServerBasePath reloads the WebView and
                // tears down the calling JS context.
                call.resolve(result);
                getActivity().runOnUiThread(() -> bridge.setServerBasePath(bundleDir.getAbsolutePath()));
            } catch (Exception e) {
                downloadInFlight.set(false);
                call.reject("Web bundle sync failed: " + e.getMessage());
            }
        }, "web-bundle-sync").start();
    }

    /** Called by JS once the app has booted successfully on the new bundle. */
    @PluginMethod
    public void confirmWebBundle(PluginCall call) {
        webBundlePrefs().edit().putBoolean(PREF_BUNDLE_PENDING, false).apply();
        call.resolve();
    }

    /** Drop any OTA bundle and return to the assets bundled in the APK. */
    @PluginMethod
    public void resetWebBundle(PluginCall call) {
        webBundlePrefs().edit().clear().apply();
        getContext()
            .getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH)
            .apply();
        deleteRecursive(new File(getContext().getFilesDir(), WEB_BUNDLES_DIR));
        call.resolve();
        getActivity().runOnUiThread(() -> bridge.setServerAssetPath("public"));
    }

    @PluginMethod
    public void getWebBundleState(PluginCall call) {
        SharedPreferences prefs = webBundlePrefs();
        JSObject ret = new JSObject();
        // What the WebView is ACTUALLY serving right now (Capacitor ignores a
        // persisted bundle after an APK update, so prefs alone can lie).
        ret.put("bridgePath", bridge.getServerBasePath());
        ret.put("path", prefs.getString(PREF_BUNDLE_PATH, null));
        ret.put("hash", prefs.getString(PREF_BUNDLE_HASH, null));
        ret.put("version", prefs.getString(PREF_BUNDLE_VERSION, null));
        ret.put("pendingConfirm", prefs.getBoolean(PREF_BUNDLE_PENDING, false));
        call.resolve(ret);
    }

    private SharedPreferences webBundlePrefs() {
        return getContext().getSharedPreferences(WEB_BUNDLE_PREFS, Context.MODE_PRIVATE);
    }

    private File downloadAndExtractBundle(String url, String hash, JSObject headers) throws Exception {
        File bundlesRoot = new File(getContext().getFilesDir(), WEB_BUNDLES_DIR);
        File tmpDir = new File(bundlesRoot, "tmp-" + System.currentTimeMillis());
        if (!tmpDir.mkdirs()) {
            throw new Exception("Could not create bundle directory");
        }

        Request.Builder requestBuilder = new Request.Builder().url(url);
        for (java.util.Iterator<String> it = headers.keys(); it.hasNext(); ) {
            String key = it.next();
            String value = headers.getString(key);
            if (value != null) requestBuilder.addHeader(key, value);
        }

        try (Response response = http.newCall(requestBuilder.build()).execute()) {
            ResponseBody body = response.body();
            if (!response.isSuccessful() || body == null) {
                throw new Exception("HTTP " + response.code());
            }
            long total = body.contentLength();
            CountingInputStream counting = new CountingInputStream(body.byteStream());
            String canonicalRoot = tmpDir.getCanonicalPath() + File.separator;
            long lastEmit = 0;

            try (ZipInputStream zip = new ZipInputStream(counting)) {
                ZipEntry entry;
                byte[] buffer = new byte[64 * 1024];
                while ((entry = zip.getNextEntry()) != null) {
                    if (entry.isDirectory()) continue;
                    File target = new File(tmpDir, entry.getName());
                    if (!target.getCanonicalPath().startsWith(canonicalRoot)) {
                        throw new Exception("Illegal path in bundle: " + entry.getName());
                    }
                    File parent = target.getParentFile();
                    if (parent != null && !parent.exists() && !parent.mkdirs()) {
                        throw new Exception("Could not create " + parent.getName());
                    }
                    try (FileOutputStream fos = new FileOutputStream(target)) {
                        int read;
                        while ((read = zip.read(buffer)) != -1) {
                            fos.write(buffer, 0, read);
                        }
                    }
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS) {
                        lastEmit = now;
                        emitBundleProgress(counting.getCount(), total);
                    }
                }
            }
            emitBundleProgress(total > 0 ? total : counting.getCount(), total > 0 ? total : counting.getCount());
        } catch (Exception e) {
            deleteRecursive(tmpDir);
            throw e;
        }

        if (!new File(tmpDir, "index.html").exists()) {
            deleteRecursive(tmpDir);
            throw new Exception("Bundle has no index.html");
        }

        // Promote tmp dir to its final hash-named location; drop older bundles.
        File finalDir = new File(bundlesRoot, hash);
        deleteRecursive(finalDir);
        if (!tmpDir.renameTo(finalDir)) {
            throw new Exception("Could not finalize bundle directory");
        }
        File[] siblings = bundlesRoot.listFiles();
        if (siblings != null) {
            for (File sibling : siblings) {
                if (!sibling.equals(finalDir)) deleteRecursive(sibling);
            }
        }
        return finalDir;
    }

    private void emitBundleProgress(long downloadedBytes, long totalBytes) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloadedBytes);
        data.put("totalBytes", totalBytes);
        data.put("percent", totalBytes > 0 ? (int) (downloadedBytes * 100 / totalBytes) : -1);
        notifyListeners("bundleProgress", data);
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursive(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    /** Counts bytes consumed from the network so zip extraction can report progress. */
    private static class CountingInputStream extends FilterInputStream {
        private long count = 0;

        CountingInputStream(InputStream in) {
            super(in);
        }

        long getCount() {
            return count;
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b != -1) count++;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int read = super.read(b, off, len);
            if (read > 0) count += read;
            return read;
        }
    }
}
