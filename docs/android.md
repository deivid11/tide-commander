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

## Features

The Android app supports:
- Agent management (spawn, select, send commands)
- Real-time conversation streaming
- Touch controls for the battlefield
- Push notifications from agents (via Local Notifications)
- Haptic feedback
