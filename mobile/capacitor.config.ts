import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.easycall.global',
  appName: 'EASY CALL',
  webDir: '../dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    url: 'https://ais-dev-okhi65ketiut5guwbkvuqv-888822968659.us-east1.run.app',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
