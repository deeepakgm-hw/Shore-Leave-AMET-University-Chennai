import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.shoreleave.app',
  appName: 'Shore Leave',
  webDir: '.output/public',
  server: {
    // For development / production live backend connection:
    // url: 'https://shoreleave.in',
    cleartext: true,
    androidScheme: 'https'
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;
