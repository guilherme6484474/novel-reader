/**
 * Piper TTS — free offline neural TTS running via WebAssembly in the browser.
 * Uses @mintplex-labs/piper-tts-web (ONNX Runtime + Piper models).
 * Models are downloaded once and cached in Origin Private File System.
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
let sessionPromise: Promise<PiperSession> | null = null;
let sessionVoiceId: PiperVoiceId | null = null;
let downloadingVoice: string | null = null;

// Lazy-load the Piper module
async function getModule() {
  if (ttsModule) return ttsModule;
  ttsLog('Loading Piper TTS WASM module...');
  ttsModule = await import('@mintplex-labs/piper-tts-web');
  ttsLog('Piper TTS WASM module loaded');
  return ttsModule;
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

// Current audio element for stop control
let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;

/**
 * Speak text using Piper TTS. Returns a promise that resolves when speech ends.
 */
export async function piperSpeak(
  text: string,
  voiceId?: string,
): Promise<{ engine: string }> {
  const vid = (voiceId || getPiperVoice()) as PiperVoiceId;
  const session = await getSession(vid);

  ttsLog(`Piper predict: ${text.length} chars, voice=${vid}`);
  const wav = await session.predict(text);

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
}

/** Check if Piper TTS is supported in this browser */
export function isPiperSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof window !== 'undefined';
}
