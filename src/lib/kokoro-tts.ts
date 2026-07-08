/**
 * Kokoro TTS (local, browser-side) via kokoro-js.
 *
 * - Runs 100% in the browser using WebAssembly / WebGPU (ONNX Runtime).
 * - Downloads the 82M-parameter multilingual model on first use (~80–160 MB
 *   depending on dtype). Cached by the browser, instant on subsequent loads.
 * - Free, no API key, no server cost. Supports background playback because
 *   the output is a normal HTMLAudioElement (MP3-equivalent WAV blob).
 *
 * pt-BR voices come from the official multilingual checkpoint:
 *   `onnx-community/Kokoro-82M-v1.0-ONNX`
 *
 * Reference: https://github.com/hexgrad/kokoro
 */
import type { TTSVoice } from '@/hooks/use-tts';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// Curated subset of Kokoro v1.0 voices. The full catalog has ~50 voices;
// we list the languages this app cares about. The `voiceURI` carries the
// `kokoro:` prefix so the engine router can detect Kokoro voices.
export const KOKORO_VOICES: TTSVoice[] = [
  // NOTA: kokoro-js@1.2.1 só suporta phonemização en-us/en-gb.
  // As vozes pt-BR do checkpoint (pf_dora, pm_alex, pm_santa) existem no
  // modelo, mas a lib rejeita na validação e o fonemizador não conhece
  // português — o áudio sairia ilegível. Mantemos só as vozes funcionais.
  // Inglês (US) — qualidade A/A-
  { name: '🧠 Kokoro: Heart (en-US, feminina)', lang: 'en-US', localService: true, voiceURI: 'kokoro:af_heart' },
  { name: '🧠 Kokoro: Bella (en-US, feminina)', lang: 'en-US', localService: true, voiceURI: 'kokoro:af_bella' },
  { name: '🧠 Kokoro: Nicole (en-US, feminina)', lang: 'en-US', localService: true, voiceURI: 'kokoro:af_nicole' },
  { name: '🧠 Kokoro: Michael (en-US, masculina)', lang: 'en-US', localService: true, voiceURI: 'kokoro:am_michael' },
  { name: '🧠 Kokoro: Fenrir (en-US, masculina)', lang: 'en-US', localService: true, voiceURI: 'kokoro:am_fenrir' },
  // Inglês (UK)
  { name: '🧠 Kokoro: Emma (en-GB, feminina)', lang: 'en-GB', localService: true, voiceURI: 'kokoro:bf_emma' },
  { name: '🧠 Kokoro: George (en-GB, masculina)', lang: 'en-GB', localService: true, voiceURI: 'kokoro:bm_george' },
];

export function isKokoroVoice(voiceURI: string | undefined): boolean {
  return !!voiceURI && voiceURI.startsWith('kokoro:');
}

export function kokoroVoiceId(voiceURI: string | undefined): string {
  if (!voiceURI) return 'af_heart';
  return voiceURI.startsWith('kokoro:') ? voiceURI.slice('kokoro:'.length) : voiceURI;
}

// Lazy singleton — building the TTS pipeline is expensive (model download +
// WASM initialization). We cache the promise so concurrent callers share it.
let ttsPromise: Promise<KokoroPipeline> | null = null;
let loadingProgressCb: ((pct: number) => void) | null = null;

// Subset of the kokoro-js KokoroTTS shape we depend on.
interface KokoroPipeline {
  generate(text: string, opts: { voice: string }): Promise<{
    toBlob(): Blob;
    audio: Float32Array;
    sampling_rate: number;
  }>;
  list_voices?: () => Record<string, unknown>;
}

export function onKokoroLoadProgress(cb: ((pct: number) => void) | null) {
  loadingProgressCb = cb;
}

async function getPipeline(): Promise<KokoroPipeline> {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    const { KokoroTTS } = await import('kokoro-js');
    // q8 is the best size/quality tradeoff in WASM. Total download ~85 MB.
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info: { status: string; progress?: number }) => {
        if (info?.status === 'progress' && typeof info.progress === 'number') {
          loadingProgressCb?.(info.progress);
        }
      },
    } as unknown as Parameters<typeof KokoroTTS.from_pretrained>[1]);
    return tts as unknown as KokoroPipeline;
  })().catch((err) => {
    // Reset so the next attempt can retry
    ttsPromise = null;
    throw err;
  });
  return ttsPromise;
}

/**
 * Generate audio for `text` with the given Kokoro voice.
 * Returns a Blob URL that can be assigned to an <audio> element.
 */
export async function fetchKokoroTtsAudio(opts: {
  text: string;
  voice: string; // either a raw id ("pf_dora") or "kokoro:pf_dora"
}): Promise<string> {
  const tts = await getPipeline();
  const voiceId = kokoroVoiceId(opts.voice);
  const result = await tts.generate(opts.text, { voice: voiceId });
  const blob = result.toBlob();
  return URL.createObjectURL(blob);
}

export function isKokoroLoaded(): boolean {
  return ttsPromise !== null;
}

/**
 * Kick off the Kokoro pipeline download/initialization in the background.
 * Safe to call multiple times — the singleton promise is reused. Errors are
 * swallowed so a failed preload never surfaces as an unhandled rejection.
 */
export function preloadKokoro(): void {
  void getPipeline().catch(() => { /* silent — the next real call will retry */ });
}