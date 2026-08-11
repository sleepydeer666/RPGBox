import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.rpgbox.mobile',
  appName: 'RPGBox',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: {
    allowMixedContent: true,
  },
}

export default config
