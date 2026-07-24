/**
 * Native Bluetooth/lock-screen media controls (Android APK).
 *
 * The Web Media Session API works in Chrome, but on the Capacitor WebView
 * the OS often ignores its play/pause events coming from Bluetooth headsets.
 * `capacitor-music-controls-plugin` creates a real native MediaSession +
 * foreground notification that receives hardware headset button events
 * reliably, even with the screen off.
 *
 * This module is a thin wrapper: it lazy-loads the plugin (so web builds
 * keep working), forwards headset events to the handlers we register from
 * `use-tts`, and mirrors play/pause state.
 */
import { Capacitor } from '@capacitor/core';
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';

type Plugin = typeof import('capacitor-music-controls-plugin').CapacitorMusicControls;

let plugin: Plugin | null = null;
let created = false;
let listenerHandle: { remove: () => void } | null = null;

let handlers: {
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onStop?: () => void;
} = {};

function isSupported(): boolean {
  return Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios';
}

async function getPlugin(): Promise<Plugin | null> {
  if (plugin) return plugin;
  if (!isSupported()) return null;
  try {
    const mod = await import('capacitor-music-controls-plugin');
    plugin = mod.CapacitorMusicControls;
    return plugin;
  } catch (e) {
    ttsWarn('[MusicControls] Plugin unavailable: ' + String(e));
    return null;
  }
}

/**
 * Register handlers that will be called when the user presses hardware
 * headset buttons or the lock-screen controls.
 */
export function setMusicControlsHandlers(next: typeof handlers) {
  handlers = next;
}

/**
 * Start showing the native media controls and begin listening for
 * headset button presses. Idempotent.
 */
export async function startMusicControls(title = 'Novel Reader', chapter = 'Leitura em andamento'): Promise<void> {
  const p = await getPlugin();
  if (!p) return;
  try {
    if (created) {
      try { p.updateIsPlaying({ isPlaying: true }); } catch { /* ignore */ }
      return;
    }
    await p.create({
      track: chapter,
      artist: title,
      album: 'Novel Reader',
      isPlaying: true,
      dismissable: false,
      hasPrev: true,
      hasNext: true,
      hasClose: true,
      hasSkipForward: false,
      hasSkipBackward: false,
      hasScrubbing: false,
      playIcon: 'media_play',
      pauseIcon: 'media_pause',
      prevIcon: 'media_prev',
      nextIcon: 'media_next',
      closeIcon: 'media_close',
      notificationIcon: 'notification',
    });
    created = true;

    listenerHandle = await p.addListener('controlsNotification', (raw: any) => {
      let msg = raw?.message ?? raw;
      if (typeof msg === 'string' && msg.startsWith('{')) {
        try { msg = JSON.parse(msg).message; } catch { /* ignore */ }
      }
      ttsLog('[MusicControls] Event: ' + String(msg));
      switch (msg) {
        case 'music-controls-play':
        case 'music-controls-toggle-play-pause':
        case 'music-controls-media-button-play':
        case 'music-controls-headset-hook':
          handlers.onPlay?.();
          break;
        case 'music-controls-pause':
        case 'music-controls-media-button-pause':
          handlers.onPause?.();
          break;
        case 'music-controls-next':
        case 'music-controls-media-button-next':
          handlers.onNext?.();
          break;
        case 'music-controls-previous':
        case 'music-controls-media-button-previous':
          handlers.onPrev?.();
          break;
        case 'music-controls-destroy':
        case 'music-controls-media-button':
          handlers.onStop?.();
          break;
        default:
          break;
      }
    });
    ttsLog('[MusicControls] Native media controls active');
  } catch (e) {
    ttsWarn('[MusicControls] start failed: ' + String(e));
  }
}

/** Update the native "is playing" state so the Bluetooth play/pause button reflects reality. */
export async function setMusicControlsPlaying(isPlaying: boolean): Promise<void> {
  const p = await getPlugin();
  if (!p || !created) return;
  try { p.updateIsPlaying({ isPlaying }); } catch { /* ignore */ }
}

/** Update the displayed chapter title. */
export async function updateMusicControlsMetadata(title: string, chapter: string): Promise<void> {
  const p = await getPlugin();
  if (!p) return;
  // The plugin has no live-update API for metadata; recreate cheaply if needed.
  if (!created) {
    await startMusicControls(title, chapter);
    return;
  }
  try {
    await p.destroy();
    created = false;
    if (listenerHandle) { try { listenerHandle.remove(); } catch { /* ignore */ } listenerHandle = null; }
    await startMusicControls(title, chapter);
  } catch (e) {
    ttsWarn('[MusicControls] metadata update failed: ' + String(e));
  }
}

/** Stop the native media controls when TTS stops. */
export async function stopMusicControls(): Promise<void> {
  const p = await getPlugin();
  if (!p || !created) return;
  try {
    if (listenerHandle) { try { listenerHandle.remove(); } catch { /* ignore */ } listenerHandle = null; }
    await p.destroy();
  } catch (e) {
    ttsWarn('[MusicControls] destroy failed: ' + String(e));
  }
  created = false;
}