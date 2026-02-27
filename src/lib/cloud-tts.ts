/**
 * Cloud TTS client — calls the cloud-tts edge function and plays audio.
 * Used as fallback when local Android TTS engines fail.
 */
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const CLOUD_TTS_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/cloud-tts`;

let currentAudio: HTMLAudioElement | null = null;

export interface CloudTTSOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  engine?: 'elevenlabs' | 'google' | 'edge';
  onEnd?: () => void;
  onError?: (error: string) => void;
}

/**
 * Speak text using cloud TTS. Returns a promise that resolves when audio starts playing.
 * The audio plays asynchronously; use onEnd callback for completion.
 */
export async function cloudSpeak(options: CloudTTSOptions): Promise<{ engine: string }> {
  ttsLog(`[CloudTTS] Requesting: textLen=${options.text.length} lang=${options.lang} engine=${options.engine || 'auto'}`);

  // Stop any currently playing cloud audio
  cloudStop();

  const response = await fetch(CLOUD_TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({
      text: options.text,
      lang: options.lang || 'pt-BR',
      rate: options.rate || 1,
      pitch: options.pitch || 1,
      engine: options.engine,
    }),
  });

  if (!response.ok) {
    let errorMsg: string;
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || `HTTP ${response.status}`;
      if (errorData.details) {
        errorMsg += ': ' + errorData.details.join('; ');
      }
    } catch {
      errorMsg = `HTTP ${response.status}: ${await response.text()}`;
    }
    ttsWarn(`[CloudTTS] Failed: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const engine = response.headers.get('X-TTS-Engine') || 'cloud';
  ttsLog(`[CloudTTS] Got audio from engine: ${engine}`);

  // Convert response to blob URL and play
  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);

  return new Promise<{ engine: string }>((resolve, reject) => {
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    audio.oncanplay = () => {
      ttsLog(`[CloudTTS] Audio ready, playing...`);
      resolve({ engine: `cloud:${engine}` });
    };

    audio.onended = () => {
      ttsLog(`[CloudTTS] Audio playback ended`);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      options.onEnd?.();
    };

    audio.onerror = (e) => {
      const msg = `Audio playback error: ${audio.error?.message || 'unknown'}`;
      ttsWarn(`[CloudTTS] ${msg}`);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      options.onError?.(msg);
      reject(new Error(msg));
    };

    audio.play().catch((e) => {
      const msg = `Audio play() failed: ${e.message}`;
      ttsWarn(`[CloudTTS] ${msg}`);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      reject(new Error(msg));
    });
  });
}

/**
 * Stop cloud audio playback.
 */
export function cloudStop() {
  if (currentAudio) {
    ttsLog('[CloudTTS] Stopping playback');
    currentAudio.pause();
    currentAudio.currentTime = 0;
    try {
      const src = currentAudio.src;
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    } catch {}
    currentAudio = null;
  }
}

/**
 * Check if cloud audio is currently playing.
 */
export function isCloudPlaying(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}
