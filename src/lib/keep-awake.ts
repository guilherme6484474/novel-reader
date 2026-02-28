/**
 * Keep-awake utility — prevents the device from suspending during TTS playback.
 *
 * Native (Capacitor): Uses @capacitor-community/keep-awake plugin.
 * Web: Uses Screen Wake Lock API + silent audio loop to keep JS alive
 *      even when the screen is off or the tab is in background.
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

// Re-acquire on visibility change (the lock is lost when tab goes background)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isKeptAwake) {
      acquireScreenWakeLock();
    }
  });
}

// ─── Web: Silent audio loop ───
// Playing a near-silent audio keeps the browser process alive
// even with screen off on mobile browsers (Chrome, Firefox, Safari).
let silentAudioCtx: AudioContext | null = null;
let silentOscillator: OscillatorNode | null = null;
let silentGain: GainNode | null = null;
let silentAudioActive = false;

function startSilentAudio() {
  if (silentAudioActive) return;
  try {
    silentAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    silentOscillator = silentAudioCtx.createOscillator();
    silentGain = silentAudioCtx.createGain();

    // Emit a 1Hz tone at nearly zero volume — inaudible but keeps audio session alive
    silentOscillator.frequency.setValueAtTime(1, silentAudioCtx.currentTime);
    silentGain.gain.setValueAtTime(0.001, silentAudioCtx.currentTime);

    silentOscillator.connect(silentGain);
    silentGain.connect(silentAudioCtx.destination);
    silentOscillator.start();

    silentAudioActive = true;
    ttsLog('[KeepAwake] Silent audio loop started');
  } catch (e) {
    ttsWarn('[KeepAwake] Silent audio failed: ' + String(e));
  }
}

function stopSilentAudio() {
  if (!silentAudioActive) return;
  try {
    silentOscillator?.stop();
    silentOscillator?.disconnect();
    silentGain?.disconnect();
    silentAudioCtx?.close();
  } catch {
    // ignore cleanup errors
  }
  silentOscillator = null;
  silentGain = null;
  silentAudioCtx = null;
  silentAudioActive = false;
  ttsLog('[KeepAwake] Silent audio loop stopped');
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
}
