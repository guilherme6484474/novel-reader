/**
 * Piper TTS — free offline neural TTS running via WebAssembly in the browser.
 * Uses @mintplex-labs/piper-tts-web (ONNX Runtime + Piper models).
 * Models are downloaded once and cached in Origin Private File System.
 *
 * Optimizations:
 * - Lazy module pre-loading when engine is selected (not on first speak)
 * - Pre-buffering: synthesizes next chunk while current audio plays
 */
import { ttsLog, ttsError } from '@/lib/tts-debug-log';

// Available Piper voices — multi-language selection
export const PIPER_VOICES = [
  // Portuguese - Brazil
  { id: 'pt_BR-faber-medium', label: '🇧🇷 Faber (PT-BR)', lang: 'pt-BR' },
  { id: 'pt_BR-edresson-low', label: '🇧🇷 Edresson (PT-BR)', lang: 'pt-BR' },
  { id: 'pt_BR-cadu-medium', label: '🇧🇷 Cadu (PT-BR)', lang: 'pt-BR' },
  // Portuguese - Portugal
  { id: 'pt_PT-tugão-medium', label: '🇵🇹 Tugão (PT-PT)', lang: 'pt-PT' },
  // English US
  { id: 'en_US-hfc_female-medium', label: '🇺🇸 Female (EN-US)', lang: 'en-US' },
  { id: 'en_US-lessac-medium', label: '🇺🇸 Lessac (EN-US)', lang: 'en-US' },
  { id: 'en_US-amy-medium', label: '🇺🇸 Amy (EN-US)', lang: 'en-US' },
  { id: 'en_US-danny-low', label: '🇺🇸 Danny (EN-US)', lang: 'en-US' },
  { id: 'en_US-joe-medium', label: '🇺🇸 Joe (EN-US)', lang: 'en-US' },
  { id: 'en_US-ryan-medium', label: '🇺🇸 Ryan (EN-US)', lang: 'en-US' },
  { id: 'en_US-kusal-medium', label: '🇺🇸 Kusal (EN-US)', lang: 'en-US' },
  // English GB
  { id: 'en_GB-alba-medium', label: '🇬🇧 Alba (EN-GB)', lang: 'en-GB' },
  { id: 'en_GB-jenny_dioco-medium', label: '🇬🇧 Jenny (EN-GB)', lang: 'en-GB' },
  { id: 'en_GB-northern_english_male-medium', label: '🇬🇧 Northern Male (EN-GB)', lang: 'en-GB' },
  // Spanish
  { id: 'es_ES-sharvard-medium', label: '🇪🇸 Sharvard (ES)', lang: 'es-ES' },
  { id: 'es_ES-davefx-medium', label: '🇪🇸 Dave (ES)', lang: 'es-ES' },
  { id: 'es_MX-ald-medium', label: '🇲🇽 Ald (ES-MX)', lang: 'es-MX' },
  // French
  { id: 'fr_FR-siwis-medium', label: '🇫🇷 Siwis (FR)', lang: 'fr-FR' },
  { id: 'fr_FR-upmc-medium', label: '🇫🇷 UPMC (FR)', lang: 'fr-FR' },
  // German
  { id: 'de_DE-thorsten-medium', label: '🇩🇪 Thorsten (DE)', lang: 'de-DE' },
  { id: 'de_DE-eva_k-x_low', label: '🇩🇪 Eva (DE)', lang: 'de-DE' },
  // Italian
  { id: 'it_IT-riccardo-x_low', label: '🇮🇹 Riccardo (IT)', lang: 'it-IT' },
  // Russian
  { id: 'ru_RU-ruslan-medium', label: '🇷🇺 Ruslan (RU)', lang: 'ru-RU' },
  // Dutch
  { id: 'nl_NL-mls-medium', label: '🇳🇱 MLS (NL)', lang: 'nl-NL' },
  // Norwegian
  { id: 'no_NO-talesyntese-medium', label: '🇳🇴 Talesyntese (NO)', lang: 'no-NO' },
  // Polish
  { id: 'pl_PL-gosia-medium', label: '🇵🇱 Gosia (PL)', lang: 'pl-PL' },
  // Ukrainian
  { id: 'uk_UA-lada-x_low', label: '🇺🇦 Lada (UK)', lang: 'uk-UA' },
] as const;

export type PiperVoiceId = (typeof PIPER_VOICES)[number]['id'];

type PiperModule = typeof import('@mintplex-labs/piper-tts-web');
type PiperSession = Awaited<ReturnType<PiperModule['TtsSession']['create']>>;
type PiperSpeakOptions = {
  nextText?: string;
  rate?: number;   // playback speed (0.5–4.0, default 1)
  pitch?: number;  // pitch factor (0.5–2.0, default 1)
};

const ORT_WASM_MJS_PATH = '/wasm/ort-wasm-simd-threaded.jsep.mjs';
const ORT_WASM_BINARY_PATH = '/wasm/ort-wasm-simd-threaded.jsep.wasm';
const PIPER_PHONEMIZE_WASM_PATH = '/wasm/piper_phonemize.wasm';
const PIPER_PHONEMIZE_DATA_PATH = '/wasm/piper_phonemize.data';

const PIPER_RUNTIME_PATHS = {
  onnxWasm: {
    mjs: ORT_WASM_MJS_PATH,
    wasm: ORT_WASM_BINARY_PATH,
  } as unknown as string,
  piperData: PIPER_PHONEMIZE_DATA_PATH,
  piperWasm: PIPER_PHONEMIZE_WASM_PATH,
};

const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBkFAAAAAAD/+1DEAAAHAAGf9AAAIMAAMO/4AAQAAAAANIAAAAADSA0gNIDSA0mf/6TQDSA0gNIDSA0gNJn/5MgNIDSA0gNIDSA0mf/lMgNIDSA0gNIDSBpMgNIDSA0gNIDSA0gNID/+xDELgPAAAGkAAAAIAAANIAAAAQSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIA=';

let ttsModule: PiperModule | null = null;
let modulePromise: Promise<PiperModule> | null = null;
let sessionPromise: Promise<PiperSession> | null = null;
let sessionVoiceId: PiperVoiceId | null = null;
let downloadingVoice: string | null = null;

function getPreBufferKey(text: string, voiceId: PiperVoiceId): string {
  return `${voiceId}::${text}`;
}

// Lazy-load the Piper module (cached after first call)
async function getModule(): Promise<PiperModule> {
  if (ttsModule) return ttsModule;
  if (modulePromise) return modulePromise;
  ttsLog('Loading Piper TTS WASM module...');
  modulePromise = import('@mintplex-labs/piper-tts-web').then(mod => {
    ttsModule = mod;
    ttsLog('Piper TTS WASM module loaded');
    return mod;
  });
  return modulePromise;
}

/**
 * Pre-load the WASM module in the background (call when user selects Piper engine).
 * Does not create a session — just downloads and compiles the WASM.
 */
export function preloadPiperModule(): void {
  if (ttsModule || modulePromise) return;
  ttsLog('Pre-loading Piper WASM module in background...');
  getModule()
    .then(() => {
      // Also warm the selected voice session in background
      const vid = getPiperVoice();
      ttsLog(`Pre-warming Piper voice session: ${vid}`);
      return getSession(vid);
    })
    .catch(e => ttsError(`Piper pre-load failed: ${e}`));
}

/** Warm the selected voice session so first playback starts faster. */
export async function warmPiperVoice(voiceId?: string): Promise<void> {
  const vid = (voiceId || getPiperVoice()) as PiperVoiceId;
  ttsLog(`Warming Piper voice session for ${vid}`);
  await getSession(vid);
  ttsLog(`Piper voice ready: ${vid}`);
}

async function getSession(voiceId: PiperVoiceId): Promise<PiperSession> {
  const mod = await getModule();

  if (sessionPromise && sessionVoiceId === voiceId) {
    return sessionPromise;
  }

  sessionVoiceId = voiceId;
  mod.TtsSession._instance = null;

  ttsLog(`Creating Piper session with local runtime assets for ${voiceId}`);

  sessionPromise = mod.TtsSession.create({
    voiceId,
    wasmPaths: PIPER_RUNTIME_PATHS as any,
    logger: (msg) => ttsLog(`[Piper] ${msg}`),
  }).catch((error) => {
    sessionPromise = null;
    sessionVoiceId = null;
    throw error;
  });

  return sessionPromise;
}

/** Get stored Piper voice preference */
export function getPiperVoice(): PiperVoiceId {
  const stored = localStorage.getItem('nr-piperVoice');
  if (stored && PIPER_VOICES.some(v => v.id === stored)) return stored as PiperVoiceId;
  return 'pt_BR-faber-medium';
}

/** Set stored Piper voice preference */
export function setPiperVoice(voiceId: PiperVoiceId) {
  localStorage.setItem('nr-piperVoice', voiceId);
}

/** Download a voice model (with progress callback). Cached in OPFS after first download. */
export async function downloadPiperVoice(
  voiceId: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (downloadingVoice === voiceId) return;
  downloadingVoice = voiceId;
  try {
    const mod = await getModule();
    ttsLog(`Downloading Piper voice: ${voiceId}`);
    await mod.download(voiceId, (progress) => {
      const pct = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
      onProgress?.(pct);
    });
    ttsLog(`Piper voice downloaded: ${voiceId}`);
  } catch (e) {
    ttsError(`Failed to download Piper voice ${voiceId}: ${e}`);
    throw e;
  } finally {
    downloadingVoice = null;
  }
}

// ─── Pitch shifting via OfflineAudioContext ───

let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

/** Encode an AudioBuffer back to a WAV Blob */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const bps = 16;
  const blockAlign = numCh * (bps / 8);
  const dataLen = buffer.length * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);

  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true);
  v.setUint16(34, bps, true); w(36, 'data'); v.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Shift pitch of a WAV blob by pitchFactor (e.g. 1.2 = 20% higher).
 * Uses OfflineAudioContext to render at modified rate, then re-encodes to WAV.
 * The output has the same duration as the original (speed is preserved).
 */
async function pitchShiftBlob(wav: Blob, pitchFactor: number): Promise<Blob> {
  const ctx = getAudioContext();
  const arrayBuf = await wav.arrayBuffer();
  const audioBuf = await ctx.decodeAudioData(arrayBuf);

  // Render at modified playback rate → changes pitch AND duration
  const newLength = Math.ceil(audioBuf.length / pitchFactor);
  const offline = new OfflineAudioContext(
    audioBuf.numberOfChannels,
    newLength,
    audioBuf.sampleRate,
  );
  const src = offline.createBufferSource();
  src.buffer = audioBuf;
  src.playbackRate.value = pitchFactor;
  src.connect(offline.destination);
  src.start();

  const rendered = await offline.startRendering();
  // Re-encode to WAV so HTMLAudioElement can play it with preservesPitch=true
  return audioBufferToWav(rendered);
}

// ─── Audio playback with pre-buffering and synthesis cache ───

// Current audio element for stop control
let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;
let currentReject: ((reason: Error) => void) | null = null;
let playbackToken = 0;
let sharedPlaybackAudio: HTMLAudioElement | null = null;
let playbackAudioPrimed = false;

function getPlaybackAudio(): HTMLAudioElement {
  if (!sharedPlaybackAudio) {
    sharedPlaybackAudio = new Audio();
    sharedPlaybackAudio.preload = 'auto';
    (sharedPlaybackAudio as any).playsInline = true;
  }
  return sharedPlaybackAudio;
}

/** Prime the shared audio element during a user gesture for better Android WebView reliability. */
export function initPiperAudio(): void {
  if (typeof window === 'undefined' || playbackAudioPrimed) return;

  try {
    const audio = getPlaybackAudio();
    audio.loop = false;
    audio.volume = 0.01;
    audio.src = SILENT_MP3;

    const playPromise = audio.play();
    if (playPromise) {
      playPromise
        .then(() => {
          playbackAudioPrimed = true;
          ttsLog('Piper audio element primed');
        })
        .catch((error) => {
          playbackAudioPrimed = false;
          ttsError(`Piper audio warm-up failed: ${error}`);
        });
    } else {
      playbackAudioPrimed = true;
    }
  } catch (error) {
    playbackAudioPrimed = false;
    ttsError(`Piper audio warm-up threw: ${error}`);
  }
}

function ensureActivePlayback(token: number) {
  if (token !== playbackToken) {
    throw new Error('Piper playback cancelled');
  }
}

// ─── Synthesis cache (avoids re-synthesizing on resume) ───
const synthCache = new Map<string, Blob>();
const SYNTH_CACHE_MAX = 6;

function getSynthCacheKey(text: string, voiceId: PiperVoiceId): string {
  return `${voiceId}::${text}`;
}

function cacheSynthResult(key: string, blob: Blob) {
  synthCache.set(key, blob);
  // Evict oldest entries
  if (synthCache.size > SYNTH_CACHE_MAX) {
    const first = synthCache.keys().next().value;
    if (first) synthCache.delete(first);
  }
}

// Pre-buffered next chunk
let preBufferedBlob: Blob | null = null;
let preBufferedBlobUrl: string | null = null;
let preBufferPromise: Promise<Blob | null> | null = null;
let preBufferedKey: string | null = null;

/**
 * Synthesize text to a WAV Blob without playing it.
 * Used for pre-buffering the next chunk.
 */
export async function piperSynthesize(
  text: string,
  voiceId?: string,
): Promise<Blob> {
  const vid = (voiceId || getPiperVoice()) as PiperVoiceId;
  const cacheKey = getSynthCacheKey(text, vid);

  // Check synthesis cache first
  const cached = synthCache.get(cacheKey);
  if (cached) {
    ttsLog(`Piper synth cache hit: ${text.length} chars`);
    return cached;
  }

  const session = await getSession(vid);
  ttsLog(`Piper synthesize: ${text.length} chars`);
  const blob = await session.predict(text);
  cacheSynthResult(cacheKey, blob);
  return blob;
}

/**
 * Start pre-buffering the next chunk text in the background.
 * Call this right after starting playback of the current chunk.
 */
export function piperPreBuffer(text: string, voiceId?: string): void {
  if (!text.trim()) return;

  const vid = (voiceId || getPiperVoice()) as PiperVoiceId;
  const key = getPreBufferKey(text, vid);

  if (preBufferedKey === key && preBufferPromise) {
    return;
  }

  clearPreBuffer();
  preBufferedKey = key;
  preBufferPromise = piperSynthesize(text, vid)
    .then(blob => {
      if (preBufferedKey !== key) return null;
      preBufferedBlob = blob;
      ttsLog(`Pre-buffered ${text.length} chars ready`);
      return blob;
    })
    .catch(e => {
      if (preBufferedKey === key) {
        preBufferedKey = null;
        preBufferedBlob = null;
        preBufferPromise = null;
      }
      ttsError(`Pre-buffer failed: ${e}`);
      return null;
    });
}

function clearPreBuffer() {
  if (preBufferedBlobUrl) {
    URL.revokeObjectURL(preBufferedBlobUrl);
    preBufferedBlobUrl = null;
  }
  preBufferedBlob = null;
  preBufferPromise = null;
  preBufferedKey = null;
}

/**
 * Speak text using Piper TTS. Returns a promise that resolves when speech ends.
 * Supports independent speed (rate) and pitch control.
 * - rate: playback speed via HTMLAudioElement.playbackRate (preservesPitch=true)
 * - pitch: offline pitch-shifting via OfflineAudioContext + WAV re-encoding
 */
export async function piperSpeak(
  text: string,
  voiceId?: string,
  options?: PiperSpeakOptions,
): Promise<{ engine: string }> {
  const token = ++playbackToken;
  const vid = (voiceId || getPiperVoice()) as PiperVoiceId;
  const requestedKey = getPreBufferKey(text, vid);
  const nextText = options?.nextText?.trim() ? options.nextText : undefined;
  const rate = options?.rate ?? 1;
  const pitch = options?.pitch ?? 1;
  let wav: Blob;
  const synthCacheKey = getSynthCacheKey(text, vid);

  // Priority 1: Check pre-buffer (synthesized in background during previous chunk)
  if (preBufferedKey === requestedKey && preBufferPromise) {
    const buffered = await preBufferPromise;
    ensureActivePlayback(token);
    if (buffered && preBufferedKey === requestedKey) {
      ttsLog('Using pre-buffered audio (instant)');
      wav = buffered;
      cacheSynthResult(synthCacheKey, wav);
      preBufferedBlob = null;
      preBufferPromise = null;
      preBufferedKey = null;
    } else {
      wav = await synthesizeWithCache(text, vid);
    }
  }
  // Priority 2: Check synthesis cache (e.g. resume after pause)
  else if (synthCache.has(synthCacheKey)) {
    wav = synthCache.get(synthCacheKey)!;
    ttsLog('Using cached synthesis (instant resume)');
  }
  // Priority 3: Fresh synthesis
  else {
    wav = await synthesizeWithCache(text, vid);
  }

  ensureActivePlayback(token);

  // Apply pitch shifting if needed (offline rendering)
  const needsPitchShift = Math.abs(pitch - 1) > 0.05;
  if (needsPitchShift) {
    ttsLog(`Applying pitch shift: ${pitch.toFixed(2)}x`);
    wav = await pitchShiftBlob(wav, pitch);
    ensureActivePlayback(token);
  }

  // Clean up previous blob
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  currentBlobUrl = URL.createObjectURL(wav);
  const audio = getPlaybackAudio();
  audio.pause();
  audio.onended = null;
  audio.onerror = null;
  audio.onplaying = null;
  audio.loop = false;
  audio.volume = 1;
  audio.src = currentBlobUrl;
  audio.currentTime = 0;
  currentAudio = audio;
  playbackAudioPrimed = true;

  ensureActivePlayback(token);

  // Apply speed control (independent from pitch thanks to pitch-shifted WAV)
  audio.playbackRate = rate;
  (audio as any).preservesPitch = true;
  (audio as any).mozPreservesPitch = true;
  (audio as any).webkitPreservesPitch = true;

  let queuedNextChunk = false;
  const queueNextChunk = () => {
    if (queuedNextChunk) return;
    queuedNextChunk = true;
    if (nextText) {
      piperPreBuffer(nextText, vid);
    }
  };

  return new Promise<{ engine: string }>((resolve, reject) => {
    currentReject = reject;
    audio.onplaying = () => {
      queueNextChunk();
    };
    audio.onended = () => {
      currentReject = null;
      cleanup();
      resolve({ engine: `piper:${vid}` });
    };
    audio.onerror = (e) => {
      currentReject = null;
      cleanup();
      reject(new Error(`Piper audio playback error: ${e}`));
    };
    audio.play().catch((err) => {
      currentReject = null;
      cleanup();
      reject(err);
    });
    queueMicrotask(queueNextChunk);
  });
}

async function synthesizeWithCache(text: string, vid: PiperVoiceId): Promise<Blob> {
  const cacheKey = getSynthCacheKey(text, vid);
  const cached = synthCache.get(cacheKey);
  if (cached) {
    ttsLog(`Piper cache hit: ${text.length} chars`);
    return cached;
  }
  const session = await getSession(vid);
  ttsLog(`Piper predict: ${text.length} chars, voice=${vid}`);
  const blob = await session.predict(text);
  cacheSynthResult(cacheKey, blob);
  return blob;
}

function cleanup() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  currentAudio = null;
}

/** Stop current Piper playback. preservePreBuffer=true keeps pre-buffered next chunk (for pause). */
export function piperStop(preservePreBuffer = false) {
  playbackToken++;

  // Reject pending promise first so the caller's await unblocks immediately
  const rejectFn = currentReject;
  currentReject = null;

  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.onplaying = null;
    currentAudio.pause();
    currentAudio.currentTime = 0;
    cleanup();
  }

  if (!preservePreBuffer) {
    clearPreBuffer();
  }

  // Reject after cleanup to avoid re-entrant issues
  if (rejectFn) {
    rejectFn(new Error('Piper playback stopped by user'));
  }
}

/** Check if Piper TTS is supported in this browser */
export function isPiperSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof window !== 'undefined';
}
