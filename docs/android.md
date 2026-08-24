# Android APK (Optional)

Tide Commander can be built as an Android app using [Capacitor](https://capacitorjs.com/). The app connects to your Tide Commander server over the local network, giving you a mobile remote control for your agents.

## Prerequisites

- Android SDK (install via [Android Studio](https://developer.android.com/studio))
- Java 17+
- Tide Commander server running with `LISTEN_ALL_INTERFACES=1`

## Building the APK

### Debug Build

```bash
make apk
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

This debug APK is still a production web bundle (not Vite dev mode) as long as `CAP_SERVER_URL` is not set.

### Dev Live Reload Debug Build

```bash
make dev-apk CAP_SERVER_URL=http://192.168.1.100:5173
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

Use this only when you want the APK to load from your dev server.

### Release Build

```bash
make apk-release
```

Output: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

### Using npm Scripts

```bash
# Build web + sync to Android + open Android Studio
npm run android

# Just sync web assets to Android
npm run cap:sync
```

## Installing

Transfer the APK to your Android device and install it. You may need to enable "Install from unknown sources" in your device settings.

## Configuration

The app needs to connect to your Tide Commander server:

1. Make sure your server is running with `LISTEN_ALL_INTERFACES=1` in `.env`
2. Both your phone and computer must be on the same network
3. Update the server URL in the app settings to point to your computer's local IP (e.g., `http://192.168.1.100:5174`)

If you have `AUTH_TOKEN` set on the server, the app will need the same token to connect.

### Live Reload vs Packaged APK

- `CAP_SERVER_URL` unset: APK loads bundled assets from `dist` (recommended for normal debug and release APKs)
- `CAP_SERVER_URL=http://<your-ip>:5173`: APK loads from your dev server for live reload testing

Examples:

```bash
# Normal debug APK (no dev server mode)
unset CAP_SERVER_URL
make apk

# Release APK (no dev server mode)
unset CAP_SERVER_URL
make apk-release

# Optional: live reload test build
CAP_SERVER_URL=http://192.168.1.100:5173 make apk
```

## Push notifications (battery)

There are two delivery paths for agent alerts while the app is closed. FCM is
the one you want.

| | Firebase Cloud Messaging | WebSocket foreground service (fallback) |
|---|---|---|
| Idle battery cost | ~0 — rides the socket Android already keeps for every app | keep-alive ping every 5 min + permanent "Connected to server" notification |
| Works outside your LAN | Yes | No (needs to reach the server directly) |
| Setup | Firebase project + service account | none |

The app picks automatically: on boot it calls `GET /api/push/status`, and it
only registers a device token if the server has Firebase credentials. Once the
server accepts the token, the foreground service is stopped and stays down
(`ServerConfigPlugin.setPushActive`). If push is unavailable or the OS denies
the notification permission, the old WebSocket path takes over untouched.

### Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Add an **Android** app with package name `com.tidecommander.app`, download
   `google-services.json` and drop it in `android/app/`. The Gradle build picks
   it up automatically (it is git-ignored — it contains your project's ids).
3. Project settings → **Service accounts** → *Generate new private key*. Install
   the downloaded JSON on the server, either by pasting it in
   **Settings → About → Push notifications**, or by saving it to
   `~/.local/share/tide-commander/fcm-service-account.json` (override the path
   with `TIDE_FCM_SERVICE_ACCOUNT`). It is written `0600` — anyone holding it
   can push to every device of the project.
4. Rebuild and install the APK (`make apk`). Open the app once so it registers
   its token, then hit **Send test** in Settings → About.

The server never needs an inbound connection from Google — it only makes
outbound HTTPS calls to `oauth2.googleapis.com` and `fcm.googleapis.com`.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/push/status` | Whether FCM is configured + registered devices (tokens are never returned in full) |
| `POST /api/push/register` | Register/refresh a device token |
| `POST /api/push/unregister` | Drop a token |
| `POST /api/push/service-account` | Install the Firebase service-account JSON |
| `DELETE /api/push/service-account` | Remove credentials (falls back to the WebSocket service) |
| `POST /api/push/test` | Send a test push to every registered device |

Dead tokens are pruned automatically when FCM reports `UNREGISTERED`, and after
10 consecutive failures for any other reason.

## Features

The Android app supports:
- Agent management (spawn, select, send commands)
- Real-time conversation streaming
- Touch controls for the battlefield
- Push notifications from agents (Firebase Cloud Messaging, with a WebSocket fallback — see below)
- Haptic feedback
