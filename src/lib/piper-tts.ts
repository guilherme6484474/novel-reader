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

// Available Piper voices (subset — Portuguese + English)
export const PIPER_VOICES = [
  { id: 'pt_BR-faber-medium', label: '🇧🇷 Faber (PT-BR)', lang: 'pt-BR' },
  { id: 'en_US-hfc_female-medium', label: '🇺🇸 Female (EN-US)', lang: 'en-US' },
  { id: 'en_US-lessac-medium', label: '🇺🇸 Lessac (EN-US)', lang: 'en-US' },
  { id: 'en_GB-alba-medium', label: '🇬🇧 Alba (EN-GB)', lang: 'en-GB' },
  { id: 'es_ES-sharvard-medium', label: '🇪🇸 Sharvard (ES)', lang: 'es-ES' },
  { id: 'fr_FR-siwis-medium', label: '🇫🇷 Siwis (FR)', lang: 'fr-FR' },
  { id: 'de_DE-thorsten-medium', label: '🇩🇪 Thorsten (DE)', lang: 'de-DE' },
] as const;

export type PiperVoiceId = (typeof PIPER_VOICES)[number]['id'];

type PiperModule = typeof import('@mintplex-labs/piper-tts-web');
type PiperSession = Awaited<ReturnType<PiperModule['TtsSession']['create']>>;

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

let ttsModule: PiperModule | null = null;
let modulePromise: Promise<PiperModule> | null = null;
let sessionPromise: Promise<PiperSession> | null = null;
let sessionVoiceId: PiperVoiceId | null = null;
let downloadingVoice: string | null = null;

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
  getModule().catch(e => ttsError(`Piper pre-load failed: ${e}`));
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

// ─── Audio playback with pre-buffering ───

// Current audio element for stop control
let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;

// Pre-buffered next chunk
let preBufferedBlob: Blob | null = null;
let preBufferedBlobUrl: string | null = null;
let preBufferPromise: Promise<Blob | null> | null = null;

/**
 * Synthesize text to a WAV Blob without playing it.
 * Used for pre-buffering the next chunk.
 */
export async function piperSynthesize(
  text: string,
  voiceId?: string,
): Promise<Blob> {
  const vid = (voiceId || getPiperVoice()) as PiperVoiceId;
  const session = await getSession(vid);
  ttsLog(`Piper synthesize (pre-buffer): ${text.length} chars`);
  return await session.predict(text);
}

/**
 * Start pre-buffering the next chunk text in the background.
 * Call this right after starting playback of the current chunk.
 */
export function piperPreBuffer(text: string, voiceId?: string): void {
  // Clear any previous pre-buffer
  clearPreBuffer();
  preBufferPromise = piperSynthesize(text, voiceId)
    .then(blob => {
      preBufferedBlob = blob;
      ttsLog(`Pre-buffered ${text.length} chars ready`);
      return blob;
    })
    .catch(e => {
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
}

/**
 * Speak text using Piper TTS. Returns a promise that resolves when speech ends.
 * If a pre-buffered blob is available for this text, uses it instantly.
 */
export async function piperSpeak(
  text: string,
  voiceId?: string,
): Promise<{ engine: string }> {
  const vid = (voiceId || getPiperVoice()) as PiperVoiceId;
  let wav: Blob;

  // Check if we have a pre-buffered result
  if (preBufferedBlob && preBufferPromise) {
    const buffered = await preBufferPromise;
    if (buffered && preBufferedBlob === buffered) {
      ttsLog('Using pre-buffered audio (instant)');
      wav = buffered;
      preBufferedBlob = null;
      preBufferPromise = null;
    } else {
      wav = await synthesizeFresh(text, vid);
    }
  } else {
    wav = await synthesizeFresh(text, vid);
  }

  // Clean up previous blob
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  currentBlobUrl = URL.createObjectURL(wav);
  const audio = new Audio(currentBlobUrl);
  currentAudio = audio;

  return new Promise<{ engine: string }>((resolve, reject) => {
    audio.onended = () => {
      cleanup();
      resolve({ engine: `piper:${vid}` });
    };
    audio.onerror = (e) => {
      cleanup();
      reject(new Error(`Piper audio playback error: ${e}`));
    };
    audio.play().catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

async function synthesizeFresh(text: string, vid: PiperVoiceId): Promise<Blob> {
  const session = await getSession(vid);
  ttsLog(`Piper predict: ${text.length} chars, voice=${vid}`);
  return await session.predict(text);
}

function cleanup() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  currentAudio = null;
}

/** Stop current Piper playback */
export function piperStop() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    cleanup();
  }
  clearPreBuffer();
}

/** Check if Piper TTS is supported in this browser */
export function isPiperSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof window !== 'undefined';
}
