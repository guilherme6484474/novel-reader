import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.novelreader',
  appName: 'novel-reader',
  webDir: 'dist',
  android: {
    // Allow WebView to continue running in background (for TTS)
    backgroundColor: '#1a1510',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#1a1510',
    },
  },
  // Use this only for live-reload development from the Lovable preview.
  // Comment out before building a production APK.
  server: {
    url: 'https://5e9ab4b3-5216-499b-8a50-b82effe50cd0.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
