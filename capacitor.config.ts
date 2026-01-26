import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tidecommander.app',
  appName: 'Tide Commander',
  webDir: 'dist',
  server: {
    // Use http scheme to allow connections to local network servers
    // This is required for connecting to ws:// and http:// endpoints
    androidScheme: 'http',
    // Allow cleartext (non-HTTPS) traffic
    cleartext: true,
  },
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
  },
};

export default config;
