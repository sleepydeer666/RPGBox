import { Capacitor } from '@capacitor/core'

export type RuntimePlatform = 'android' | 'web'

export function runtimePlatform(): RuntimePlatform {
  return Capacitor.isNativePlatform() ? 'android' : 'web'
}

export function isAndroidRuntime(): boolean {
  return runtimePlatform() === 'android'
}
