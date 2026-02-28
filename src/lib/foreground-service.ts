/**
 * Android Foreground Service manager for TTS background playback.
 * Uses @capawesome-team/capacitor-android-foreground-service to keep
 * the app alive when the screen is off or the app is in the background.
 */
import { Capacitor } from '@capacitor/core';
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';

let ForegroundServicePlugin: typeof import('@capawesome-team/capacitor-android-foreground-service').ForegroundService | null = null;
let isRunning = false;

async function getPlugin() {
  if (ForegroundServicePlugin) return ForegroundServicePlugin;
  if (Capacitor.getPlatform() !== 'android') return null;
  try {
    const mod = await import('@capawesome-team/capacitor-android-foreground-service');
    ForegroundServicePlugin = mod.ForegroundService;
    return ForegroundServicePlugin;
  } catch (e) {
    ttsWarn('[ForegroundService] Plugin not available: ' + String(e));
    return null;
  }
}

/**
 * Start the foreground service with a persistent notification.
 * This prevents Android from killing the WebView when the screen is off.
 */
export async function startForegroundService(): Promise<void> {
  if (isRunning) return;
  const plugin = await getPlugin();
  if (!plugin) return;

  try {
    await plugin.startForegroundService({
      id: 1001,
      title: 'Novel Reader',
      body: 'Reproduzindo áudio...',
      smallIcon: 'ic_stat_icon_config_sample',
      silent: false,
    });
    isRunning = true;
    ttsLog('[ForegroundService] Started — audio will continue in background');
  } catch (e) {
    ttsWarn('[ForegroundService] Failed to start: ' + String(e));
  }
}

/**
 * Stop the foreground service when TTS playback ends.
 */
export async function stopForegroundService(): Promise<void> {
  if (!isRunning) return;
  const plugin = await getPlugin();
  if (!plugin) return;

  try {
    await plugin.stopForegroundService();
    isRunning = false;
    ttsLog('[ForegroundService] Stopped');
  } catch (e) {
    ttsWarn('[ForegroundService] Failed to stop: ' + String(e));
  }
}
