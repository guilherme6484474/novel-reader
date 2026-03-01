/**
 * Cloud TTS client — calls the cloud-tts edge function and plays audio.
 * Supports two playback modes:
 *   - 'htmlaudio': HTML <audio> element (better Android compatibility)
 *   - 'audiocontext': Web Audio API AudioContext (original, may have issues on Android)
 *
 * Implements pre-buffering: fetches the next chunk while the current one plays
 * to eliminate pauses between segments.
 */
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';
import { supabase } from '@/integrations/supabase/client';

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const CLOUD_TTS_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/cloud-tts`;

// ─── Audio playback mode ───
export type AudioPlaybackMode = 'htmlaudio' | 'audiocontext';

let playbackMode: AudioPlaybackMode = (localStorage.getItem('nr-audioMode') as AudioPlaybackMode) || 'htmlaudio';

export function getAudioMode(): AudioPlaybackMode { return playbackMode; }
export function setAudioMode(mode: AudioPlaybackMode) {
  playbackMode = mode;
  localStorage.setItem('nr-audioMode', mode);
  ttsLog(`[CloudTTS] Audio mode set to: ${mode}`);
}

// ─── Cloud voice setting ───
export type CloudVoiceId = string;

export interface CloudVoiceOption {
  id: string;
  name: string;
  lang: string;
  gender: string;
}

export const CLOUD_VOICES: CloudVoiceOption[] = [
  // Portuguese
  { id: 'pt-BR-Standard-A', name: 'Fernanda (BR)', lang: 'pt-BR', gender: 'FEMALE' },
  { id: 'pt-BR-Standard-B', name: 'Ricardo (BR)', lang: 'pt-BR', gender: 'MALE' },
  { id: 'pt-BR-Wavenet-A', name: 'Fernanda HD (BR)', lang: 'pt-BR', gender: 'FEMALE' },
  { id: 'pt-BR-Wavenet-B', name: 'Ricardo HD (BR)', lang: 'pt-BR', gender: 'MALE' },
  { id: 'pt-PT-Standard-A', name: 'Maria (PT)', lang: 'pt-PT', gender: 'FEMALE' },
  { id: 'pt-PT-Standard-B', name: 'João (PT)', lang: 'pt-PT', gender: 'MALE' },
  // English
  { id: 'en-US-Standard-C', name: 'Emily (US)', lang: 'en-US', gender: 'FEMALE' },
  { id: 'en-US-Standard-D', name: 'James (US)', lang: 'en-US', gender: 'MALE' },
  { id: 'en-US-Wavenet-F', name: 'Emily HD (US)', lang: 'en-US', gender: 'FEMALE' },
  { id: 'en-US-Wavenet-D', name: 'James HD (US)', lang: 'en-US', gender: 'MALE' },
  { id: 'en-GB-Standard-A', name: 'Sophie (UK)', lang: 'en-GB', gender: 'FEMALE' },
  { id: 'en-GB-Standard-B', name: 'Oliver (UK)', lang: 'en-GB', gender: 'MALE' },
  // Spanish
  { id: 'es-ES-Standard-A', name: 'Lucía (ES)', lang: 'es-ES', gender: 'FEMALE' },
  { id: 'es-ES-Standard-B', name: 'Carlos (ES)', lang: 'es-ES', gender: 'MALE' },
  { id: 'es-US-Standard-A', name: 'María (US)', lang: 'es-US', gender: 'FEMALE' },
  { id: 'es-US-Standard-B', name: 'Miguel (US)', lang: 'es-US', gender: 'MALE' },
  // French
  { id: 'fr-FR-Standard-A', name: 'Claire (FR)', lang: 'fr-FR', gender: 'FEMALE' },
  { id: 'fr-FR-Standard-B', name: 'Pierre (FR)', lang: 'fr-FR', gender: 'MALE' },
  { id: 'fr-FR-Wavenet-A', name: 'Claire HD (FR)', lang: 'fr-FR', gender: 'FEMALE' },
  // Japanese
  { id: 'ja-JP-Standard-A', name: 'Yuki (JP)', lang: 'ja-JP', gender: 'FEMALE' },
  { id: 'ja-JP-Standard-B', name: 'Takeshi (JP)', lang: 'ja-JP', gender: 'MALE' },
  { id: 'ja-JP-Wavenet-A', name: 'Yuki HD (JP)', lang: 'ja-JP', gender: 'FEMALE' },
  // Korean
  { id: 'ko-KR-Standard-A', name: 'Seo-yeon (KR)', lang: 'ko-KR', gender: 'FEMALE' },
  { id: 'ko-KR-Standard-B', name: 'Min-jun (KR)', lang: 'ko-KR', gender: 'MALE' },
  // Chinese
  { id: 'cmn-CN-Standard-A', name: 'Xiaowei (CN)', lang: 'cmn-CN', gender: 'FEMALE' },
  { id: 'cmn-CN-Standard-B', name: 'Haoran (CN)', lang: 'cmn-CN', gender: 'MALE' },
  { id: 'cmn-CN-Wavenet-A', name: 'Xiaowei HD (CN)', lang: 'cmn-CN', gender: 'FEMALE' },
  // German
  { id: 'de-DE-Standard-A', name: 'Anna (DE)', lang: 'de-DE', gender: 'FEMALE' },
  { id: 'de-DE-Standard-B', name: 'Lukas (DE)', lang: 'de-DE', gender: 'MALE' },
  // Italian
  { id: 'it-IT-Standard-A', name: 'Giulia (IT)', lang: 'it-IT', gender: 'FEMALE' },
  { id: 'it-IT-Standard-C', name: 'Marco (IT)', lang: 'it-IT', gender: 'MALE' },
  // Russian
  { id: 'ru-RU-Standard-A', name: 'Ekaterina (RU)', lang: 'ru-RU', gender: 'FEMALE' },
  { id: 'ru-RU-Standard-B', name: 'Dmitry (RU)', lang: 'ru-RU', gender: 'MALE' },
  // Arabic
  { id: 'ar-XA-Standard-A', name: 'Fatima (AR)', lang: 'ar-XA', gender: 'FEMALE' },
  { id: 'ar-XA-Standard-B', name: 'Ahmed (AR)', lang: 'ar-XA', gender: 'MALE' },
  // Hindi
  { id: 'hi-IN-Standard-A', name: 'Priya (IN)', lang: 'hi-IN', gender: 'FEMALE' },
  { id: 'hi-IN-Standard-B', name: 'Arjun (IN)', lang: 'hi-IN', gender: 'MALE' },
];

let selectedCloudVoice: string = localStorage.getItem('nr-cloudVoice') || '';
export function getCloudVoice(): string { return selectedCloudVoice; }
export function setCloudVoice(voiceId: string) {
  selectedCloudVoice = voiceId;
  localStorage.setItem('nr-cloudVoice', voiceId);
}

// ─── AudioContext state (for 'audiocontext' mode) ───
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

// ─── HTML Audio state (for 'htmlaudio' mode) ───
let currentAudioEl: HTMLAudioElement | null = null;
let warmedAudioEl: HTMLAudioElement | null = null; // Pre-warmed during user gesture

let isPlaying = false;

// ─── Pre-buffer cache ───
let preBufferCache: Map<string, ArrayBuffer> = new Map();

function ensureAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    ttsLog('[CloudTTS] AudioContext created, state=' + audioCtx.state);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export interface CloudTTSOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  engine?: 'elevenlabs' | 'google' | 'edge';
  voiceName?: string; // Google Cloud TTS voice name (e.g. 'pt-BR-Wavenet-A')
  onEnd?: () => void;
  onError?: (error: string) => void;
}

/**
 * MUST be called synchronously from a user gesture (click/tap) to unlock
 * audio playback on Android WebView / mobile browsers.
 * Creates a "warm" audio element by playing a tiny silent clip.
 */
export function initCloudAudio(): void {
  try {
    if (playbackMode === 'audiocontext') {
      ensureAudioContext();
    }
    // Warm up an HTML Audio element during the user gesture to unlock playback.
    // Android WebView blocks audio.play() if not initiated from a gesture context.
    if (!warmedAudioEl) {
      const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBkFAAAAAAD/+1DEAAAHAAGf9AAAIMAAMO/4AAQAAAAANIAAAAADSA0gNIDSA0mf/6TQDSA0gNIDSA0gNJn/5MgNIDSA0gNIDSA0mf/lMgNIDSA0gNIDSBpMgNIDSA0gNIDSA0gNID/+xDELgPAAAGkAAAAIAAANIAAAAQSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIDSA0gNIA=';
      warmedAudioEl = new Audio(SILENT_MP3);
      warmedAudioEl.volume = 0.01;
      const p = warmedAudioEl.play();
      if (p) p.catch(() => {}); // Ignore autoplay errors — the gesture unlocks it
      ttsLog('[CloudTTS] Audio element warmed during user gesture');
    }
    ttsLog(`[CloudTTS] Audio pre-initialized (mode=${playbackMode})`);
  } catch (e) {
    ttsWarn('[CloudTTS] Failed to pre-init: ' + String(e));
  }
}

/**
 * Pre-fetch audio for a text chunk so it's ready when needed.
 */
export async function preBufferChunk(options: Omit<CloudTTSOptions, 'onEnd' | 'onError'>): Promise<void> {
  const cacheKey = `${options.text.slice(0, 50)}_${options.lang}_${options.rate}_${options.voiceName || ''}`;
  if (preBufferCache.has(cacheKey)) return;

  try {
    const buffer = await fetchTTSAudio(options);
    preBufferCache.set(cacheKey, buffer);
    ttsLog(`[CloudTTS] Pre-buffered chunk (${buffer.byteLength} bytes)`);
    // Keep cache small
    if (preBufferCache.size > 3) {
      const first = preBufferCache.keys().next().value;
      if (first) preBufferCache.delete(first);
    }
  } catch (e) {
    ttsWarn('[CloudTTS] Pre-buffer failed: ' + String(e));
  }
}

/**
 * Fetch TTS audio from edge function. Returns raw ArrayBuffer.
 */
async function fetchTTSAudio(options: Omit<CloudTTSOptions, 'onEnd' | 'onError'>): Promise<ArrayBuffer> {
  let authToken: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    authToken = data.session?.access_token || null;
  } catch { /* ignore */ }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const body: Record<string, any> = {
    text: options.text,
    lang: options.lang || 'pt-BR',
    rate: options.rate || 1,
    pitch: options.pitch || 1,
    engine: options.engine,
  };

  // Add voice name for Google Cloud TTS
  const voiceName = options.voiceName || selectedCloudVoice;
  if (voiceName) {
    body.voiceName = voiceName;
  }

  const response = await fetch(CLOUD_TTS_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMsg: string;
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || `HTTP ${response.status}`;
      if (errorData.details) errorMsg += ': ' + errorData.details.join('; ');
    } catch {
      errorMsg = `HTTP ${response.status}: ${await response.text()}`;
    }
    throw new Error(errorMsg);
  }

  return response.arrayBuffer();
}

/**
 * Play audio using HTML <audio> element.
 * Reuses the warmed audio element (created during user gesture) to avoid
 * autoplay blocking on Android WebView.
 */
function playWithHtmlAudio(arrayBuffer: ArrayBuffer, options: CloudTTSOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    // Reuse warmed element if available (avoids Android autoplay block)
    let audio: HTMLAudioElement;
    if (warmedAudioEl) {
      audio = warmedAudioEl;
      warmedAudioEl = null; // consumed — next call creates fresh
      audio.pause();
      audio.volume = 1;
    } else {
      audio = new Audio();
    }
    audio.src = url;
    currentAudioEl = audio;
    isPlaying = true;

    // Set playback rate on the audio element for faster playback
    const extraSpeed = (options.rate && options.rate > 1.5) ? Math.min(options.rate / 1.5, 2.0) : 1.0;
    audio.playbackRate = extraSpeed;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudioEl = null;
      isPlaying = false;
      options.onEnd?.();
      resolve();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudioEl = null;
      isPlaying = false;
      const msg = 'HTML Audio playback error';
      options.onError?.(msg);
      reject(new Error(msg));
    };

    audio.play().catch((e) => {
      URL.revokeObjectURL(url);
      currentAudioEl = null;
      isPlaying = false;
      const msg = `Audio play failed: ${e.message}`;
      options.onError?.(msg);
      reject(new Error(msg));
    });
  });
}

/**
 * Play audio using AudioContext (Web Audio API).
 */
function playWithAudioContext(arrayBuffer: ArrayBuffer, options: CloudTTSOptions): Promise<void> {
  const ctx = ensureAudioContext();
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(
      arrayBuffer,
      (audioBuffer) => {
        ttsLog(`[CloudTTS] Audio decoded: ${audioBuffer.duration.toFixed(1)}s`);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentSource = source;
        isPlaying = true;

        source.onended = () => {
          currentSource = null;
          isPlaying = false;
          options.onEnd?.();
          resolve();
        };

        source.start(0);
        ttsLog('[CloudTTS] Playing via AudioContext...');
      },
      (decodeError) => {
        const msg = `Audio decode error: ${decodeError?.message || 'unknown'}`;
        ttsWarn(`[CloudTTS] ${msg}`);
        currentSource = null;
        isPlaying = false;
        options.onError?.(msg);
        reject(new Error(msg));
      }
    );
  });
}

/**
 * Speak text using cloud TTS.
 */
export async function cloudSpeak(options: CloudTTSOptions): Promise<{ engine: string }> {
  ttsLog(`[CloudTTS] Requesting: textLen=${options.text.length} lang=${options.lang} rate=${options.rate} mode=${playbackMode} voice=${options.voiceName || selectedCloudVoice || 'default'}`);

  cloudStop();

  // Check pre-buffer cache
  const cacheKey = `${options.text.slice(0, 50)}_${options.lang}_${options.rate}_${options.voiceName || selectedCloudVoice || ''}`;
  let arrayBuffer: ArrayBuffer;

  if (preBufferCache.has(cacheKey)) {
    arrayBuffer = preBufferCache.get(cacheKey)!;
    preBufferCache.delete(cacheKey);
    ttsLog('[CloudTTS] Using pre-buffered audio');
  } else {
    arrayBuffer = await fetchTTSAudio(options);
  }

  ttsLog(`[CloudTTS] Got ${arrayBuffer.byteLength} bytes, playing with ${playbackMode}...`);

  if (playbackMode === 'htmlaudio') {
    await playWithHtmlAudio(arrayBuffer, options);
    // Pre-warm a new audio element for the next chunk (reuses gesture context chain)
    if (!warmedAudioEl) {
      try {
        warmedAudioEl = new Audio();
        warmedAudioEl.volume = 0.01;
      } catch { /* ignore */ }
    }
  } else {
    await playWithAudioContext(arrayBuffer, options);
  }

  return { engine: `cloud:google` };
}

export function cloudStop() {
  if (currentSource) {
    ttsLog('[CloudTTS] Stopping AudioContext source');
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  if (currentAudioEl) {
    ttsLog('[CloudTTS] Stopping HTML Audio');
    try {
      currentAudioEl.pause();
      currentAudioEl.src = '';
    } catch { /* ignore */ }
    currentAudioEl = null;
  }
  isPlaying = false;
}

export function isCloudPlaying(): boolean {
  return isPlaying;
}

export function clearPreBufferCache() {
  preBufferCache.clear();
}
