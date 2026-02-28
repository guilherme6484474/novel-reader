/**
 * Keep-awake utility — prevents the device from suspending during TTS playback.
 *
 * Native (Capacitor): Uses @capacitor-community/keep-awake plugin.
 * Web: Uses Screen Wake Lock API + silent audio loop + Media Session API
 *      to keep JS alive even when the screen is off or the tab is in background.
 */
import { isNative } from '@/lib/native-tts';
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';

// ─── Native (Capacitor) ───
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

// ─── Web: Screen Wake Lock API ───
let screenWakeLock: WakeLockSentinel | null = null;

async function acquireScreenWakeLock() {
  if (screenWakeLock) return;
  if (!('wakeLock' in navigator)) {
    ttsWarn('[KeepAwake] Screen Wake Lock API not supported');
    return;
  }
  try {
    screenWakeLock = await (navigator as any).wakeLock.request('screen');
    screenWakeLock!.addEventListener('release', () => {
      ttsLog('[KeepAwake] Screen wake lock was released');
      screenWakeLock = null;
    });
    ttsLog('[KeepAwake] Screen wake lock acquired');
  } catch (e) {
    ttsWarn('[KeepAwake] Screen wake lock failed: ' + String(e));
  }
}

async function releaseScreenWakeLock() {
  if (!screenWakeLock) return;
  try {
    await screenWakeLock.release();
    screenWakeLock = null;
    ttsLog('[KeepAwake] Screen wake lock released');
  } catch (e) {
    ttsWarn('[KeepAwake] Screen wake lock release failed: ' + String(e));
  }
}

// Re-acquire on visibility change (the lock is lost when tab goes background/screen off)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isKeptAwake) {
      ttsLog('[KeepAwake] Visibility restored, re-acquiring wake lock');
      acquireScreenWakeLock();
      // Also ensure silent audio is still running
      if (!silentAudioActive) startSilentAudio();
    }
  });
}

// ─── Web: Silent audio loop ───
// An HTML <audio> element playing a silent MP3 in a loop is the most reliable
// way to keep Chrome on Android alive when the screen is off.
// The Web Audio API oscillator approach often gets suspended by the OS.
let silentAudioEl: HTMLAudioElement | null = null;
let silentAudioActive = false;

// Tiny silent MP3 (~0.5s) encoded as base64 data URI — loops forever
const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBkFAAAAAAD/+1DEAAAHAAGf9AAAIMAAMO/4AAQAAAAANIAAAAADSA0gNIDSA0mf/6TQDSA0gNIDSA0gNJn/5MgNIDSA0gNIDSA0mf/lMgNIDSA0gNIDSBpMgNIDSA0gNIDSA0gNID/+xDELgPAAAGkAAAAIAAANIAAAAQSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIA=';

function startSilentAudio() {
  if (silentAudioActive) return;
  try {
    silentAudioEl = new Audio(SILENT_MP3);
    silentAudioEl.loop = true;
    silentAudioEl.volume = 0.01; // Near-silent but enough to keep process alive
    // Play returns a promise — catch autoplay errors
    const playPromise = silentAudioEl.play();
    if (playPromise) {
      playPromise.catch((e) => {
        ttsWarn('[KeepAwake] Silent audio autoplay blocked: ' + String(e));
      });
    }
    silentAudioActive = true;
    ttsLog('[KeepAwake] Silent audio loop started (HTML Audio)');
  } catch (e) {
    ttsWarn('[KeepAwake] Silent audio failed: ' + String(e));
  }
}

function stopSilentAudio() {
  if (!silentAudioActive) return;
  try {
    if (silentAudioEl) {
      silentAudioEl.pause();
      silentAudioEl.src = '';
      silentAudioEl = null;
    }
  } catch {
    // ignore cleanup errors
  }
  silentAudioActive = false;
  ttsLog('[KeepAwake] Silent audio loop stopped');
}

// ─── Web: Media Session API ───
// Registers the app as a media player so the OS gives it priority
// and shows lock-screen controls (pause/play).
let mediaSessionActive = false;
let mediaSessionPauseHandler: (() => void) | null = null;
let mediaSessionPlayHandler: (() => void) | null = null;

function startMediaSession() {
  if (mediaSessionActive) return;
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    ttsWarn('[KeepAwake] Media Session API not supported');
    return;
  }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Leitura em andamento',
      artist: 'Novel Reader',
      album: 'TTS',
    });
    navigator.mediaSession.playbackState = 'playing';
    mediaSessionActive = true;
    ttsLog('[KeepAwake] Media Session started');
  } catch (e) {
    ttsWarn('[KeepAwake] Media Session failed: ' + String(e));
  }
}

function stopMediaSession() {
  if (!mediaSessionActive) return;
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
      try { navigator.mediaSession.setActionHandler('play', null); } catch {}
      try { navigator.mediaSession.setActionHandler('pause', null); } catch {}
      try { navigator.mediaSession.setActionHandler('stop', null); } catch {}
    }
  } catch {}
  mediaSessionActive = false;
  mediaSessionPauseHandler = null;
  mediaSessionPlayHandler = null;
  ttsLog('[KeepAwake] Media Session stopped');
}

/**
 * Register lock-screen media controls (optional).
 * Call after acquireWakeLock to wire pause/play/stop buttons.
 */
export function setMediaSessionHandlers(handlers: {
  onPause?: () => void;
  onPlay?: () => void;
  onStop?: () => void;
}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    if (handlers.onPause) {
      mediaSessionPauseHandler = handlers.onPause;
      navigator.mediaSession.setActionHandler('pause', handlers.onPause);
    }
    if (handlers.onPlay) {
      mediaSessionPlayHandler = handlers.onPlay;
      navigator.mediaSession.setActionHandler('play', handlers.onPlay);
    }
    if (handlers.onStop) {
      navigator.mediaSession.setActionHandler('stop', handlers.onStop);
    }
    ttsLog('[KeepAwake] Media Session handlers set');
  } catch (e) {
    ttsWarn('[KeepAwake] Media Session handlers failed: ' + String(e));
  }
}

// ─── Public API ───

/**
 * Acquire wake lock — call when TTS starts.
 * Native: Capacitor plugin. Web: Screen Wake Lock + silent audio.
 */
export async function acquireWakeLock(): Promise<void> {
  if (isKeptAwake) return;

  if (isNative()) {
    const mod = await getModule();
    if (mod) {
      try {
        await mod.KeepAwake.keepAwake();
        isKeptAwake = true;
        ttsLog('[KeepAwake] Native wake lock acquired');
      } catch (e) {
        ttsWarn('[KeepAwake] Native failed to acquire: ' + String(e));
      }
    }
    return;
  }

  // Web path
  isKeptAwake = true;
  await acquireScreenWakeLock();
  startSilentAudio();
  startMediaSession();
}

/**
 * Release wake lock — call when TTS stops.
 */
export async function releaseWakeLock(): Promise<void> {
  if (!isKeptAwake) return;

  if (isNative()) {
    const mod = await getModule();
    if (mod) {
      try {
        await mod.KeepAwake.allowSleep();
        isKeptAwake = false;
        ttsLog('[KeepAwake] Native wake lock released');
      } catch (e) {
        ttsWarn('[KeepAwake] Native failed to release: ' + String(e));
      }
    }
    return;
  }

  // Web path
  isKeptAwake = false;
  await releaseScreenWakeLock();
  stopSilentAudio();
  stopMediaSession();
}
