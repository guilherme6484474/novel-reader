/**
 * Keep-awake utility — prevents Android from suspending the WebView
 * when the screen is off during TTS playback.
 */
import { isNative } from '@/lib/native-tts';
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';

let keepAwakeModule: typeof import('@capacitor-community/keep-awake') | null = null;
let isKeptAwake = false;

async function getModule() {
  if (keepAwakeModule) return keepAwakeModule;
  if (!isNative()) return null;
  try {
    keepAwakeModule = await import('@capacitor-community/keep-awake');
    return keepAwakeModule;
  } catch (e) {
    ttsWarn('[KeepAwake] Plugin not available: ' + String(e));
    return null;
  }
}

/**
 * Acquire wake lock — call when TTS starts.
 * Prevents screen/CPU from sleeping so audio continues.
 */
export async function acquireWakeLock(): Promise<void> {
  if (isKeptAwake) return;
  const mod = await getModule();
  if (!mod) return;
  try {
    await mod.KeepAwake.keepAwake();
    isKeptAwake = true;
    ttsLog('[KeepAwake] Wake lock acquired');
  } catch (e) {
    ttsWarn('[KeepAwake] Failed to acquire: ' + String(e));
  }
}

/**
 * Release wake lock — call when TTS stops.
 */
export async function releaseWakeLock(): Promise<void> {
  if (!isKeptAwake) return;
  const mod = await getModule();
  if (!mod) return;
  try {
    await mod.KeepAwake.allowSleep();
    isKeptAwake = false;
    ttsLog('[KeepAwake] Wake lock released');
  } catch (e) {
    ttsWarn('[KeepAwake] Failed to release: ' + String(e));
  }
}
