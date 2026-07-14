package com.tidecommander.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.widget.Toast;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Saves authenticated server files into Android's public Downloads folder. */
@CapacitorPlugin(
    name = "FileDownload",
    permissions = @Permission(
        alias = "storage",
        strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
    )
)
public class FileDownloadPlugin extends Plugin {
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .followRedirects(true)
        .build();

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String filename = sanitizeFilename(call.getString("filename", "download"));
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
            && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }

        startDownload(call, url, filename);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("Storage permission is required to save downloads");
            return;
        }
        download(call);
    }

    private void startDownload(PluginCall call, String url, String filename) {
        JSObject headers = call.getObject("headers", new JSObject());
        String requestedMimeType = call.getString("mimeType");

        new Thread(() -> {
            Uri pendingUri = null;
            try {
                Request.Builder request = new Request.Builder().url(url);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.optString(key, null);
                    if (value != null && !value.isEmpty()) request.header(key, value);
                }

                try (Response response = http.newCall(request.build()).execute()) {
                    ResponseBody body = response.body();
                    if (!response.isSuccessful() || body == null) {
                        throw new Exception("HTTP " + response.code());
                    }

                    String mimeType = requestedMimeType;
                    if ((mimeType == null || mimeType.isEmpty()) && body.contentType() != null) {
                        mimeType = body.contentType().toString();
                    }
                    if (mimeType == null || mimeType.isEmpty()) mimeType = "application/octet-stream";

                    SavedFile saved = openDownload(filename, mimeType);
                    pendingUri = saved.uri;
                    try (InputStream input = body.byteStream(); OutputStream output = saved.output) {
                        byte[] buffer = new byte[64 * 1024];
                        int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    finishDownload(pendingUri);

                    JSObject result = new JSObject();
                    result.put("uri", pendingUri != null ? pendingUri.toString() : saved.file.getAbsolutePath());
                    result.put("filename", filename);
                    getActivity().runOnUiThread(() -> Toast.makeText(
                        getContext(),
                        "Saved to Downloads/Tide Commander",
                        Toast.LENGTH_SHORT
                    ).show());
                    call.resolve(result);
                }
            } catch (Exception error) {
                if (pendingUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    getContext().getContentResolver().delete(pendingUri, null, null);
                }
                call.reject("Download failed: " + error.getMessage(), error);
            }
        }, "file-download").start();
    }

    private SavedFile openDownload(String filename, String mimeType) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Tide Commander");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("Could not create a Downloads entry");
            OutputStream output = resolver.openOutputStream(uri);
            if (output == null) {
                resolver.delete(uri, null, null);
                throw new Exception("Could not open the destination file");
            }
            return new SavedFile(uri, null, output);
        }

        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Tide Commander");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create the Downloads folder");
        File file = uniqueFile(dir, filename);
        return new SavedFile(null, file, new FileOutputStream(file));
    }

    private void finishDownload(Uri uri) {
        if (uri == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        getContext().getContentResolver().update(uri, values, null, null);
    }

    private static File uniqueFile(File dir, String filename) {
        File candidate = new File(dir, filename);
        if (!candidate.exists()) return candidate;
        int dot = filename.lastIndexOf('.');
        String stem = dot > 0 ? filename.substring(0, dot) : filename;
        String extension = dot > 0 ? filename.substring(dot) : "";
        for (int i = 1; ; i++) {
            candidate = new File(dir, stem + " (" + i + ")" + extension);
            if (!candidate.exists()) return candidate;
        }
    }

    private static String sanitizeFilename(String filename) {
        String cleaned = filename.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return cleaned.isEmpty() ? "download" : cleaned;
    }

    private static class SavedFile {
        final Uri uri;
        final File file;
        final OutputStream output;

        SavedFile(Uri uri, File file, OutputStream output) {
            this.uri = uri;
            this.file = file;
            this.output = output;
        }
    }
}
