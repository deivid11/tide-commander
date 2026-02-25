import type { CapacitorConfig } from '@capacitor/cli';

const capServerUrl = process.env.CAP_SERVER_URL?.trim();

const server: CapacitorConfig['server'] = {
  // Use http scheme to allow connections to local network servers
  // This is required for connecting to ws:// and http:// endpoints
  androidScheme: 'http',
  // Allow cleartext (non-HTTPS) traffic
  cleartext: true,
};

// Optional live-reload URL for local device testing.
// Leave CAP_SERVER_URL unset for packaged APKs to use bundled web assets.
if (capServerUrl) {
  server.url = capServerUrl;
}

const config: CapacitorConfig = {
  appId: 'com.tidecommander.app',
  appName: 'Tide Commander',
  webDir: 'dist',
  server,
  android: {
    // Allow mixed content for WebSocket connections
    allowMixedContent: true,
  },
  plugins: {
    // Splash screen configuration
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
    },
    // Local notifications configuration for high-priority delivery
    LocalNotifications: {
      // Use high-priority channel for agent alerts
      smallIcon: 'ic_launcher',
      iconColor: '#00D4AA',
      sound: 'default',
    },
  },
};

export default config;
