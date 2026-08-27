import { Capacitor } from '@capacitor/core'

export type RuntimePlatform = 'android' | 'desktop' | 'web'

export function runtimePlatform(): RuntimePlatform {
  if (Capacitor.isNativePlatform()) return 'android'
  return typeof window !== 'undefined' && window.rpgboxDesktop ? 'desktop' : 'web'
}

export function isAndroidRuntime(): boolean {
  return runtimePlatform() === 'android'
}

export function isDesktopRuntime(): boolean {
  return runtimePlatform() === 'desktop'
}
