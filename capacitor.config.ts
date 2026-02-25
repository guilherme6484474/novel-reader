import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.novelreader',
  appName: 'Novel Reader',
  webDir: 'dist',
  android: {
    // Allow WebView to continue running in background (for TTS)
    backgroundColor: '#1a1510',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
  },
};

export default config;
