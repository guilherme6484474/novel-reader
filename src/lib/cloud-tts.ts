/**
 * Cloud TTS client — calls the cloud-tts edge function and plays audio.
 * Used as fallback when local Android TTS engines fail.
 *
 * FIX #8: Uses AudioContext instead of new Audio() to avoid Android WebView
 * autoplay restrictions that block audio playback outside user gesture context.
 */
import { ttsLog, ttsWarn } from '@/lib/tts-debug-log';
import { supabase } from '@/integrations/supabase/client';

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const CLOUD_TTS_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/cloud-tts`;

// Persistent AudioContext — created once on first user gesture, reused for all chunks
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let isPlaying = false;

/**
 * Ensure AudioContext exists. Must be called from a user gesture the first time.
 * Subsequent calls can be from async callbacks since the context is already unlocked.
 */
function ensureAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    ttsLog('[CloudTTS] AudioContext created, state=' + audioCtx.state);
  }
  // Resume if suspended (happens on Android until user gesture)
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
  onEnd?: () => void;
  onError?: (error: string) => void;
}

/**
 * Pre-initialize AudioContext from a user gesture context.
 * Call this when the user clicks "Ouvir" so the AudioContext is unlocked
 * before async operations start.
 */
export function initCloudAudio(): void {
  try {
    ensureAudioContext();
    ttsLog('[CloudTTS] AudioContext pre-initialized from user gesture');
  } catch (e) {
    ttsWarn('[CloudTTS] Failed to pre-init AudioContext: ' + String(e));
  }
}

/**
 * Speak text using cloud TTS. Returns a promise that resolves when audio finishes playing.
 */
export async function cloudSpeak(options: CloudTTSOptions): Promise<{ engine: string }> {
  ttsLog(`[CloudTTS] Requesting: textLen=${options.text.length} lang=${options.lang} engine=${options.engine || 'auto'}`);

  // Stop any currently playing cloud audio
  cloudStop();

  // Get auth token for usage tracking
  let authToken: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    authToken = data.session?.access_token || null;
  } catch { /* ignore */ }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(CLOUD_TTS_URL, {
    method: 'POST',
    headers,
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

  // Decode audio using AudioContext (works on Android WebView without user gesture)
  const arrayBuffer = await response.arrayBuffer();
  const ctx = ensureAudioContext();

  return new Promise<{ engine: string }>((resolve, reject) => {
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
          ttsLog(`[CloudTTS] Audio playback ended`);
          currentSource = null;
          isPlaying = false;
          options.onEnd?.();
          resolve({ engine: `cloud:${engine}` });
        };

        source.start(0);
        ttsLog(`[CloudTTS] Audio playing via AudioContext...`);
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
 * Stop cloud audio playback.
 */
export function cloudStop() {
  if (currentSource) {
    ttsLog('[CloudTTS] Stopping playback');
    try {
      currentSource.stop();
    } catch { /* already stopped */ }
    currentSource = null;
  }
  isPlaying = false;
}

/**
 * Check if cloud audio is currently playing.
 */
export function isCloudPlaying(): boolean {
  return isPlaying;
}
