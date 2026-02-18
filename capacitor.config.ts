import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.novelreader',
  appName: 'novel-reader',
  webDir: 'dist',
  server: {
    url: 'https://5e9ab4b3-5216-499b-8a50-b82effe50cd0.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
