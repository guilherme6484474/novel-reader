/**
 * Android Foreground Service manager for TTS background playback.
 * Uses @capawesome-team/capacitor-android-foreground-service to keep
 * the app alive when the screen is off or the app is in the background.
 */
import { Capacitor } from '@capacitor/core';
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';

let ForegroundServicePlugin: typeof import('@capawesome-team/capacitor-android-foreground-service').ForegroundService | null = null;
let isRunning = false;
let channelCreated = false;
let permissionRequested = false;
const NOTIF_CHANNEL_ID = 'novel-reader-tts';

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

async function ensurePermission(plugin: NonNullable<Awaited<ReturnType<typeof getPlugin>>>): Promise<boolean> {
  if (permissionRequested) return true;
  try {
    const status = await plugin.checkPermissions();
    if (status.display !== 'granted') {
      const req = await plugin.requestPermissions();
      permissionRequested = true;
      if (req.display !== 'granted') {
        ttsWarn('[ForegroundService] Notification permission denied — background playback may not work');
        return false;
      }
    }
    permissionRequested = true;
    return true;
  } catch (e) {
    ttsWarn('[ForegroundService] checkPermissions failed: ' + String(e));
    return true; // pre-Android 13 — permission API may not exist
  }
}

async function ensureChannel(plugin: NonNullable<Awaited<ReturnType<typeof getPlugin>>>): Promise<void> {
  if (channelCreated) return;
  try {
    await plugin.createNotificationChannel({
      id: NOTIF_CHANNEL_ID,
      name: 'Leitura em segundo plano',
      description: 'Mantém o áudio do Novel Reader tocando com a tela apagada',
      importance: 2, // IMPORTANCE_LOW — no sound, persistent
    } as any);
    channelCreated = true;
  } catch (e) {
    ttsWarn('[ForegroundService] createNotificationChannel failed: ' + String(e));
  }
}

/**
 * Start the foreground service with a persistent notification.
 * This prevents Android from killing the WebView when the screen is off.
 * Tries multiple smallIcon names so it works on Capacitor projects that
 * don't ship the `ic_stat_icon_config_sample` drawable.
 */
export async function startForegroundService(): Promise<void> {
  if (isRunning) return;
  const plugin = await getPlugin();
  if (!plugin) return;

  await ensurePermission(plugin);
  await ensureChannel(plugin);

  // Try common icon names in order. The first that exists in the app's
  // res/drawable (or res/mipmap) wins. If none exists, the OS uses a
  // fallback and the service still starts.
  const iconCandidates = [
    'ic_stat_icon_config_sample',
    'ic_stat_notification',
    'ic_notification',
    'ic_launcher_foreground',
    'ic_launcher',
  ];

  let lastError: unknown = null;
  for (const smallIcon of iconCandidates) {
    try {
      await plugin.startForegroundService({
        id: 1001,
        title: 'Novel Reader',
        body: 'Reproduzindo áudio...',
        smallIcon,
        silent: true,
        notificationChannelId: NOTIF_CHANNEL_ID,
      });
      isRunning = true;
      ttsLog(`[ForegroundService] Started with icon "${smallIcon}" — audio will continue in background`);
      return;
    } catch (e) {
      lastError = e;
      ttsWarn(`[ForegroundService] Failed with icon "${smallIcon}": ${String(e)}`);
    }
  }
  ttsWarn('[ForegroundService] All icon attempts failed. Background playback may stop when screen turns off. Last error: ' + String(lastError));
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
